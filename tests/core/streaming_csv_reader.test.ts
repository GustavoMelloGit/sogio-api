import { describe, expect, it } from "bun:test";
import {
  readCsvRecordStream,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FIELD_BYTES,
} from "../../src/core/infra/http/csv/streaming_csv_reader";
import {
  ImportRejectedError,
  MAX_IMPORT_COLUMNS,
} from "../../src/core/application/import/import_failure";
import type { SourceRecord } from "../../src/core/application/import/source_record";

function streamFrom(
  text: string,
  chunkSize?: number
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const size = chunkSize ?? Math.max(bytes.length, 1);
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + size, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

async function collect(
  text: string,
  requiredColumns: readonly string[],
  chunkSize?: number
): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  for await (const record of readCsvRecordStream(
    streamFrom(text, chunkSize),
    requiredColumns
  )) {
    records.push(record);
  }
  return records;
}

async function collectRejection(
  text: string,
  requiredColumns: readonly string[],
  chunkSize?: number
): Promise<ImportRejectedError> {
  try {
    const iterator = readCsvRecordStream(
      streamFrom(text, chunkSize),
      requiredColumns
    )[Symbol.asyncIterator]();
    let result = await iterator.next();
    while (!result.done) {
      result = await iterator.next();
    }
  } catch (error) {
    if (error instanceof ImportRejectedError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected readCsvRecordStream to reject, but it completed");
}

describe("readCsvRecordStream — quoting", () => {
  it("treats a quote as opening quoted mode only when it is the first byte of the field", async () => {
    const records = await collect('a,b\nab"cd,val2\n', ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: 'ab"cd', b: "val2" });
  });

  it("decodes a doubled quote inside a quoted field as a single literal quote", async () => {
    const records = await collect('a,b\n"say ""hi""",val2\n', ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: 'say "hi"', b: "val2" });
  });

  it("treats commas and an embedded newline inside a quoted field as literal characters", async () => {
    const records = await collect('a,b\n"line1\nline2,and,commas",val2\n', [
      "a",
      "b",
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({
      a: "line1\nline2,and,commas",
      b: "val2",
    });
  });

  it("treats a CR inside a quoted field as a literal character", async () => {
    const records = await collect('a,b\n"a\rb",val2\r\n', ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "a\rb", b: "val2" });
  });
});

describe("readCsvRecordStream — line endings", () => {
  it("parses records terminated by CRLF", async () => {
    const records = await collect("a,b\r\n1,2\r\n", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "1", b: "2" });
  });

  it("parses records terminated by a bare LF", async () => {
    const records = await collect("a,b\n1,2\n", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "1", b: "2" });
  });

  it("keeps a lone CR not followed by LF as a literal byte in the field", async () => {
    const records = await collect("a,b\nx\ry,2\n", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "x\ry", b: "2" });
  });

  it("closes the final record at EOF when the file has no trailing newline", async () => {
    const records = await collect("a,b\n1,2", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "1", b: "2" });
  });
});

describe("readCsvRecordStream — record shape", () => {
  it("fills a missing trailing cell in a short row with an empty string, never undefined", async () => {
    const records = await collect("a,b,c\n1,2\n", ["a", "b", "c"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values.c).toBe("");
    expect("c" in (records[0]?.values ?? {})).toBe(true);
  });

  it("ignores an unknown column instead of treating it as an error", async () => {
    const records = await collect("a,b,extra\n1,2,3\n", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ a: "1", b: "2", extra: "3" });
  });

  it("assigns 1-based rows counting the header as row 1", async () => {
    const records = await collect("a,b\n1,2\n3,4\n", ["a", "b"]);

    expect(records.map(r => r.row)).toEqual([2, 3]);
  });
});

describe("readCsvRecordStream — missing required columns", () => {
  it("rejects with one failure per missing column, all at row 1, and reports only the columns that are missing", async () => {
    const error = await collectRejection("a,c\n1,2\n", ["a", "b", "c", "d"]);

    expect(error.report.truncated).toBe(false);
    expect(error.report.failures).toHaveLength(2);
    expect(error.report.failures.every(f => f.row === 1)).toBe(true);
    expect(error.report.failures.map(f => f.field).sort()).toEqual(["b", "d"]);
  });

  it("rejects with a single failure when exactly one required column is missing", async () => {
    const error = await collectRejection("a,c\n1,2\n", ["a", "b", "c"]);

    expect(error.report.failures).toEqual([
      { row: 1, field: "b", message: expect.any(String) },
    ]);
  });

  it("does not reject when every required column is present, regardless of order", async () => {
    const records = await collect("b,a\n1,2\n", ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values).toEqual({ b: "1", a: "2" });
  });
});

describe("readCsvRecordStream — size limits", () => {
  it("rejects immediately when a single field exceeds MAX_IMPORT_FIELD_BYTES, with field: null and truncated: false", async () => {
    const oversizedField = "x".repeat(MAX_IMPORT_FIELD_BYTES + 1);
    const error = await collectRejection(`a,b\n${oversizedField},val2\n`, [
      "a",
      "b",
    ]);

    expect(error.report.truncated).toBe(false);
    expect(error.report.failures).toHaveLength(1);
    expect(error.report.failures[0]?.field).toBeNull();
  });

  it("rejects a header exceeding MAX_IMPORT_COLUMNS, with field: null and truncated: false", async () => {
    const header = ["a", "b"]
      .concat(Array.from({ length: MAX_IMPORT_COLUMNS - 1 }, (_, i) => `c${i}`))
      .join(",");
    const error = await collectRejection(`${header}\n`, ["a", "b"]);

    expect(error.report.truncated).toBe(false);
    expect(error.report.failures).toHaveLength(1);
    expect(error.report.failures[0]?.field).toBeNull();
  });

  it("allows a header of exactly MAX_IMPORT_COLUMNS columns", async () => {
    const columns = ["a", "b"].concat(
      Array.from({ length: MAX_IMPORT_COLUMNS - 2 }, (_, i) => `c${i}`)
    );
    const row = columns.map(() => "v").join(",");
    const records = await collect(`${columns.join(",")}\n${row}\n`, ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]?.values ?? {})).toHaveLength(
      MAX_IMPORT_COLUMNS
    );
  });

  it("allows a field of exactly MAX_IMPORT_FIELD_BYTES bytes", async () => {
    const maxField = "x".repeat(MAX_IMPORT_FIELD_BYTES);
    const records = await collect(`a,b\n${maxField},val2\n`, ["a", "b"]);

    expect(records).toHaveLength(1);
    expect(records[0]?.values.a).toHaveLength(MAX_IMPORT_FIELD_BYTES);
  });

  it("rejects immediately when the total input exceeds MAX_IMPORT_BYTES, with field: null and truncated: false", async () => {
    const rowFieldSize = 50_000;
    const row = `${"x".repeat(rowFieldSize)},${"y".repeat(rowFieldSize)}\n`;
    const rowsNeeded = Math.ceil(MAX_IMPORT_BYTES / row.length) + 5;
    const body = "a,b\n" + row.repeat(rowsNeeded);

    const error = await collectRejection(body, ["a", "b"]);

    expect(error.report.truncated).toBe(false);
    expect(error.report.failures).toHaveLength(1);
    expect(error.report.failures[0]?.field).toBeNull();
  });
});

describe("readCsvRecordStream — chunk boundaries", () => {
  it("parses correctly when the stream delivers input one byte at a time, across a CRLF boundary and an escaped quote", async () => {
    const text = 'a,b\r\n"say ""hi""",val2\r\n1,2\n';

    const chunked = await collect(text, ["a", "b"], 1);
    const whole = await collect(text, ["a", "b"]);

    expect(chunked).toEqual(whole);
    expect(chunked).toHaveLength(2);
    expect(chunked[0]?.values).toEqual({ a: 'say "hi"', b: "val2" });
    expect(chunked[1]?.values).toEqual({ a: "1", b: "2" });
  });

  it("rejects a missing required column the same way regardless of chunk size", async () => {
    const chunkedError = await collectRejection("a\n1\n", ["a", "b"], 1);
    const wholeError = await collectRejection("a\n1\n", ["a", "b"]);

    expect(chunkedError.report).toEqual(wholeError.report);
  });
});

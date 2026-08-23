import type { ImportRecordStream } from "../../../application/import/source_record";
import {
  ImportRejectedError,
  MAX_IMPORT_COLUMNS,
} from "../../../application/import/import_failure";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_FIELD_BYTES = 64 * 1024;

const COMMA = 0x2c;
const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

function buildRecordValues(
  header: string[],
  record: string[]
): Record<string, string> {
  const values: Record<string, string> = {};
  header.forEach((name, index) => {
    values[name] = record[index] ?? "";
  });
  return values;
}

export async function* readCsvRecordStream(
  body: ReadableStream<Uint8Array>,
  requiredColumns: readonly string[]
): ImportRecordStream {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  let header: string[] | null = null;
  let currentRow = 1;
  let totalBytes = 0;

  let fields: string[] = [];
  let fieldBytes: number[] = [];
  let quoted = false;
  let quotePending = false;
  let crPending = false;

  const activeRow = (): number => (header === null ? 1 : currentRow + 1);

  const rejectBatch = (field: string | null, message: string): never => {
    throw new ImportRejectedError({
      failures: [{ row: activeRow(), field, message }],
      truncated: false,
    });
  };

  const rejectMissingColumns = (parsedHeader: string[]): never => {
    const missing = requiredColumns.filter(
      column => !parsedHeader.includes(column)
    );
    throw new ImportRejectedError({
      failures: missing.map(column => ({
        row: 1,
        field: column,
        message: `Missing required column: ${column}`,
      })),
      truncated: false,
    });
  };

  const pushByte = (byte: number): void => {
    if (fieldBytes.length + 1 > MAX_IMPORT_FIELD_BYTES) {
      rejectBatch(
        null,
        `A field exceeds the maximum size of ${MAX_IMPORT_FIELD_BYTES} bytes`
      );
    }
    fieldBytes.push(byte);
  };

  const finalizeField = (): void => {
    if (fields.length + 1 > MAX_IMPORT_COLUMNS) {
      rejectBatch(
        null,
        `A row exceeds the maximum of ${MAX_IMPORT_COLUMNS} columns`
      );
    }
    fields.push(decoder.decode(Uint8Array.from(fieldBytes)));
    fieldBytes = [];
  };

  const finalizeRecord = (): string[] => {
    finalizeField();
    const record = fields;
    fields = [];
    return record;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      for (const byte of value) {
        totalBytes++;
        if (totalBytes > MAX_IMPORT_BYTES) {
          rejectBatch(
            null,
            `Import exceeds the maximum size of ${MAX_IMPORT_BYTES} bytes`
          );
        }

        if (crPending) {
          crPending = false;
          if (byte !== LF) {
            pushByte(CR);
          }
        }

        if (quotePending) {
          quotePending = false;
          if (byte === QUOTE) {
            pushByte(QUOTE);
            continue;
          }
          quoted = false;
        }

        if (quoted) {
          if (byte === QUOTE) {
            quotePending = true;
          } else {
            pushByte(byte);
          }
          continue;
        }

        if (byte === QUOTE) {
          if (fieldBytes.length === 0) {
            quoted = true;
          } else {
            pushByte(byte);
          }
          continue;
        }

        if (byte === COMMA) {
          finalizeField();
          continue;
        }

        if (byte === CR) {
          crPending = true;
          continue;
        }

        if (byte === LF) {
          const record = finalizeRecord();
          if (header === null) {
            const parsedHeader = record;
            header = parsedHeader;
            if (
              requiredColumns.some(column => !parsedHeader.includes(column))
            ) {
              rejectMissingColumns(parsedHeader);
            }
          } else {
            currentRow++;
            yield {
              row: currentRow,
              values: buildRecordValues(header, record),
            };
          }
          continue;
        }

        pushByte(byte);
      }
    }

    if (crPending) {
      pushByte(CR);
      crPending = false;
    }
    quotePending = false;
    quoted = false;

    if (header === null) {
      if (fieldBytes.length > 0 || fields.length > 0) {
        const parsedHeader = finalizeRecord();
        header = parsedHeader;
        if (requiredColumns.some(column => !parsedHeader.includes(column))) {
          rejectMissingColumns(parsedHeader);
        }
      } else if (requiredColumns.length > 0) {
        rejectMissingColumns([]);
      }
    } else if (fieldBytes.length > 0 || fields.length > 0) {
      const record = finalizeRecord();
      currentRow++;
      yield { row: currentRow, values: buildRecordValues(header, record) };
    }
  } finally {
    await reader.cancel();
  }
}

import { describe, expect, it, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import {
  ImportRunner,
  type ApplyImportRecord,
  type ImportMode,
} from "../../src/core/application/import/import_runner";
import {
  ImportRejectedError,
  MAX_IMPORT_ROWS,
  MAX_REPORTED_ERRORS,
  type ImportFailure,
} from "../../src/core/application/import/import_failure";
import type {
  ImportRecordStream,
  SourceRecord,
} from "../../src/core/application/import/source_record";
import type { TransactionRunner } from "../../src/core/application/transaction/transaction_runner";
import { DrizzleTransactionRunner } from "../../src/core/infra/database/drizzle/drizzle_transaction_runner";
import { currentExecutor } from "../../src/core/infra/database/drizzle/transaction_context";
import { db } from "../../src/core/infra/database/drizzle/database";
import { usersTable } from "../../src/core/infra/database/drizzle/schema";
import { truncate } from "../helpers/database";

class InlineTransactionRunner implements TransactionRunner {
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function streamOf(count: number): ImportRecordStream {
  async function* generator() {
    for (let i = 0; i < count; i++) {
      yield { row: i + 2, values: {} } satisfies SourceRecord;
    }
  }
  return generator();
}

type Call = { row: number; mode: ImportMode };

function spyApply(shouldFail: (row: number) => boolean): {
  apply: ApplyImportRecord;
  calls: Call[];
} {
  const calls: Call[] = [];
  const apply: ApplyImportRecord = async (record, mode) => {
    calls.push({ row: record.row, mode });
    if (shouldFail(record.row)) {
      return {
        row: record.row,
        field: null,
        message: `row ${record.row} rejected`,
      };
    }
    return null;
  };
  return { apply, calls };
}

async function expectRejection(
  runner: ImportRunner,
  stream: ImportRecordStream,
  apply: ApplyImportRecord
): Promise<ImportRejectedError> {
  try {
    await runner.run(stream, apply);
  } catch (error) {
    if (error instanceof ImportRejectedError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected ImportRunner.run to reject, but it resolved");
}

describe("ImportRunner — accepted batch", () => {
  it("applies every record in write mode and returns the imported count", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const { apply, calls } = spyApply(() => false);

    const outcome = await runner.run(streamOf(5), apply);

    expect(outcome).toEqual({ imported: 5 });
    expect(calls).toHaveLength(5);
    expect(calls.every(c => c.mode === "write")).toBe(true);
  });
});

describe("ImportRunner — failure accumulation and mode switching", () => {
  it("switches from write to validate mode on the first failure and keeps accumulating failures", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const { apply, calls } = spyApply(row => row === 3 || row === 5);

    const failures: ImportFailure[] = [];
    try {
      await runner.run(streamOf(6), apply);
    } catch (error) {
      if (!(error instanceof ImportRejectedError)) throw error;
      failures.push(...error.report.failures);
    }

    expect(failures.map(f => f.row)).toEqual([3, 5]);
    expect(calls).toHaveLength(6);
    expect(calls.filter(c => c.mode === "write").map(c => c.row)).toEqual([
      2, 3,
    ]);
    expect(calls.filter(c => c.mode === "validate").map(c => c.row)).toEqual([
      4, 5, 6, 7,
    ]);
  });

  it("rejects with truncated: false when fewer failures than MAX_REPORTED_ERRORS accumulate by the end of the stream", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const { apply } = spyApply(row => row === 4 || row === 6 || row === 8);

    const error = await expectRejection(runner, streamOf(10), apply);

    expect(error.report.failures).toHaveLength(3);
    expect(error.report.truncated).toBe(false);
  });
});

describe("ImportRunner — MAX_REPORTED_ERRORS", () => {
  it("stops reading the stream and rejects with truncated: true once MAX_REPORTED_ERRORS failures accumulate", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const { apply, calls } = spyApply(() => true);

    const error = await expectRejection(
      runner,
      streamOf(MAX_REPORTED_ERRORS + 50),
      apply
    );

    expect(error.report.failures).toHaveLength(MAX_REPORTED_ERRORS);
    expect(error.report.truncated).toBe(true);
    expect(calls).toHaveLength(MAX_REPORTED_ERRORS);
  });
});

describe("ImportRunner — MAX_IMPORT_ROWS", () => {
  it("rejects once the row count exceeds MAX_IMPORT_ROWS without applying the exceeding record", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const { apply, calls } = spyApply(() => false);

    const error = await expectRejection(
      runner,
      streamOf(MAX_IMPORT_ROWS + 1),
      apply
    );

    expect(calls).toHaveLength(MAX_IMPORT_ROWS);
    expect(error.report.truncated).toBe(false);
    expect(error.report.failures).toHaveLength(1);
    expect(error.report.failures[0]?.field).toBeNull();
    expect(error.report.failures[0]?.row).toBe(MAX_IMPORT_ROWS + 2);
  });
});

describe("ImportRunner — batch failures thrown by apply()", () => {
  it("propagates an error thrown by apply() directly, instead of converting it into an ImportFailure", async () => {
    const runner = new ImportRunner(new InlineTransactionRunner());
    const batchError = new Error("simulated batch-level failure");
    const calls: Call[] = [];

    const apply: ApplyImportRecord = async (record, mode) => {
      calls.push({ row: record.row, mode });
      if (record.row === 4) {
        throw batchError;
      }
      return null;
    };

    await expect(runner.run(streamOf(6), apply)).rejects.toBe(batchError);
    expect(calls).toHaveLength(3);
  });
});

describe("ImportRunner — rollback (IM-5)", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  it("leaves no trace of writes made before a later failure once the batch is rejected", async () => {
    const runner = new ImportRunner(new DrizzleTransactionRunner());
    const marker = `import-runner-rollback-${crypto.randomUUID()}@sogio.dev`;

    const apply: ApplyImportRecord = async record => {
      if (record.row === 2) {
        await currentExecutor().insert(usersTable).values({
          name: "Rollback Probe",
          email: marker,
          password: "irrelevant-hash",
        });
        return null;
      }

      return { row: record.row, field: null, message: "forced failure" };
    };

    await expect(runner.run(streamOf(2), apply)).rejects.toBeInstanceOf(
      ImportRejectedError
    );

    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, marker));

    expect(rows).toHaveLength(0);
  });
});

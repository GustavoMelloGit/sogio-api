import { type TransactionRunner } from "../transaction/transaction_runner";
import { type ImportRecordStream, type SourceRecord } from "./source_record";
import {
  ImportRejectedError,
  MAX_IMPORT_ROWS,
  MAX_REPORTED_ERRORS,
  type ImportFailure,
} from "./import_failure";

export type ImportMode = "write" | "validate";

export type ApplyImportRecord = (
  record: SourceRecord,
  mode: ImportMode
) => Promise<ImportFailure | null>;

export type ImportOutcome = {
  imported: number;
};

export class ImportRunner {
  constructor(private readonly transactionRunner: TransactionRunner) {}

  async run(
    stream: ImportRecordStream,
    apply: ApplyImportRecord
  ): Promise<ImportOutcome> {
    return this.transactionRunner.run(async () => {
      const failures: ImportFailure[] = [];
      let imported = 0;
      let rowCount = 0;
      let collecting = false;

      for await (const record of stream) {
        rowCount++;

        if (rowCount > MAX_IMPORT_ROWS) {
          failures.push({
            row: record.row,
            field: null,
            message: `Import exceeds the maximum of ${MAX_IMPORT_ROWS} rows. Split the file and import it again`,
          });
          throw new ImportRejectedError({ failures, truncated: false });
        }

        const mode: ImportMode = collecting ? "validate" : "write";
        const failure = await apply(record, mode);

        if (failure === null) {
          if (!collecting) {
            imported++;
          }
          continue;
        }

        collecting = true;
        failures.push(failure);

        if (failures.length >= MAX_REPORTED_ERRORS) {
          throw new ImportRejectedError({ failures, truncated: true });
        }
      }

      if (failures.length > 0) {
        throw new ImportRejectedError({ failures, truncated: false });
      }

      return { imported };
    });
  }
}

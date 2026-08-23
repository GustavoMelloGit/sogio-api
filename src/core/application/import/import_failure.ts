export const MAX_IMPORT_ROWS = 1000;
export const MAX_REPORTED_ERRORS = 100;
export const MAX_MCP_IMPORT_RECORDS = 100;
export const MAX_IMPORT_COLUMNS = 200;

export type ImportFailure = {
  row: number;
  field: string | null;
  message: string;
};

export type ImportReport = {
  failures: ImportFailure[];
  truncated: boolean;
};

export class ImportRejectedError extends Error {
  readonly report: ImportReport;

  constructor(report: ImportReport) {
    super(`Import rejected: ${report.failures.length} invalid rows`);
    this.name = "ImportRejectedError";
    this.report = report;
  }
}

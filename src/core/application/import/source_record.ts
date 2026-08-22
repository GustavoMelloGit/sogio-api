export type SourceRecord = {
  row: number;
  values: Record<string, string>;
};

export type ImportRecordStream = AsyncIterable<SourceRecord>;

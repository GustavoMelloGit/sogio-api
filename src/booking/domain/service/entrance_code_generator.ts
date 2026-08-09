export type EntranceCodeAlphabet = "numeric" | "alphanumeric";

export interface EntranceCodeOptions {
  length?: number;
  alphabet?: EntranceCodeAlphabet;
}

export interface EntranceCodeGenerator {
  generate(options?: EntranceCodeOptions): string;
}

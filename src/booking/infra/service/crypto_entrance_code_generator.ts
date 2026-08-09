import crypto from "crypto";
import type {
  EntranceCodeAlphabet,
  EntranceCodeGenerator,
  EntranceCodeOptions,
} from "../../domain/service/entrance_code_generator";

const DEFAULT_LENGTH = 7;
const DEFAULT_ALPHABET: EntranceCodeAlphabet = "numeric";

const ALPHABET_CHARS: Record<EntranceCodeAlphabet, string> = {
  numeric: "0123456789",
  alphanumeric: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
};

export class CryptoEntranceCodeGenerator implements EntranceCodeGenerator {
  generate(options?: EntranceCodeOptions): string {
    const length = options?.length ?? DEFAULT_LENGTH;
    const chars = ALPHABET_CHARS[options?.alphabet ?? DEFAULT_ALPHABET];

    let code = "";

    for (let i = 0; i < length; i++) {
      code += chars[crypto.randomInt(0, chars.length)];
    }

    return code;
  }
}

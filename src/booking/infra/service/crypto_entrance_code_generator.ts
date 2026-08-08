import crypto from "crypto";
import type { EntranceCodeGenerator } from "../../domain/service/entrance_code_generator";

const ENTRANCE_CODE_LENGTH = 7;

export class CryptoEntranceCodeGenerator implements EntranceCodeGenerator {
  generate(): string {
    let code = "";

    for (let i = 0; i < ENTRANCE_CODE_LENGTH; i++) {
      code += crypto.randomInt(0, 10).toString();
    }

    return code;
  }
}

import crypto from "crypto";
import type {
  DelegatedSecretService,
  GeneratedSecret,
} from "../../domain/service/delegated_secret_service";

const SECRET_BYTE_LENGTH = 32;

export class CryptoDelegatedSecretService implements DelegatedSecretService {
  generate(): GeneratedSecret {
    const secret = crypto.randomBytes(SECRET_BYTE_LENGTH).toString("base64url");

    return { secret, digest: this.digest(secret) };
  }

  digest(secret: string): string {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }
}

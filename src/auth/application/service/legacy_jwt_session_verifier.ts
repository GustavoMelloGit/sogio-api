import jwt from "jsonwebtoken";
import { env } from "../../../core/infra/config/environments";

export type LegacySession = {
  userId: string;
  issuedAt: Date;
};

export class LegacyJwtSessionVerifier {
  verify(token: string): LegacySession | null {
    const acceptedUntil = env.LEGACY_JWT_ACCEPTED_UNTIL;

    if (!acceptedUntil || Date.now() > acceptedUntil.getTime()) {
      return null;
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      if (
        typeof decoded !== "object" ||
        !("userId" in decoded) ||
        typeof decoded.userId !== "string" ||
        typeof decoded.iat !== "number"
      ) {
        return null;
      }

      return { userId: decoded.userId, issuedAt: new Date(decoded.iat * 1000) };
    } catch {
      return null;
    }
  }
}

import { describe, it, expect } from "bun:test";
import { parseGoogleIdTokenClaims } from "../../src/auth/infra/identity_provider/google_id_token_claims";
import { env } from "../../src/core/infra/config/environments";

const CLIENT_ID = env.GOOGLE_CLIENT_ID!;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function buildIdToken(payload: Record<string, unknown>): string {
  const header = encodeSegment({ alg: "RS256", typ: "JWT" });
  const body = encodeSegment(payload);
  return `${header}.${body}.signature`;
}

function omit(
  payload: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const clone = { ...payload };
  delete clone[key];
  return clone;
}

function validPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    sub: "1234567890",
    email: "user@gmail.com",
    email_verified: true,
    name: "Ada Lovelace",
    nonce: "nonce-value",
    ...overrides,
  };
}

describe("parseGoogleIdTokenClaims (DA-15)", () => {
  it("yields the attested identity for a valid token", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload()),
      CLIENT_ID
    );

    expect(identity).toEqual({
      subject: "1234567890",
      email: "user@gmail.com",
      email_verified: true,
      name: "Ada Lovelace",
      nonce: "nonce-value",
    });
  });

  it("rejects a wrong iss", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ iss: "https://evil.example" })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a missing iss", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(omit(validPayload(), "iss")),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a different aud", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ aud: "some-other-client-id" })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects an aud list that does not contain the client id", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ aud: ["other-client-1", "other-client-2"] })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects an aud list containing the client id when azp diverges", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(
        validPayload({
          aud: [CLIENT_ID, "other-client"],
          azp: "other-client",
        })
      ),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("accepts an aud list containing the client id when azp matches", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(
        validPayload({
          aud: [CLIENT_ID, "other-client"],
          azp: CLIENT_ID,
        })
      ),
      CLIENT_ID
    );

    expect(identity).not.toBeNull();
  });

  it("rejects an expired token", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ exp: nowSeconds - 10 })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects iat beyond the clock skew tolerance", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ iat: nowSeconds + 120 })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a missing sub", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(omit(validPayload(), "sub")),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects an empty sub", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ sub: "" })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a sub longer than 255 characters", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ sub: "a".repeat(256) })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects an invalid email", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ email: "not-an-email" })),
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("reads email_verified as the string 'true' as unverified, without failing", () => {
    const identity = parseGoogleIdTokenClaims(
      buildIdToken(validPayload({ email_verified: "true" })),
      CLIENT_ID
    );

    expect(identity?.email_verified).toBe(false);
  });

  it("rejects a token with fewer than three segments", () => {
    const [header, payload] = buildIdToken(validPayload()).split(".");
    const identity = parseGoogleIdTokenClaims(
      `${header}.${payload}`,
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a payload segment that is not valid base64url", () => {
    const [header] = buildIdToken(validPayload()).split(".");
    const identity = parseGoogleIdTokenClaims(
      `${header}.@@@not-base64url@@@.signature`,
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a payload segment that decodes to invalid JSON", () => {
    const [header] = buildIdToken(validPayload()).split(".");
    const invalidJson = Buffer.from("not valid json").toString("base64url");
    const identity = parseGoogleIdTokenClaims(
      `${header}.${invalidJson}.signature`,
      CLIENT_ID
    );

    expect(identity).toBeNull();
  });

  it("rejects a token larger than the maximum length", () => {
    const oversized = "a".repeat(9000);

    expect(parseGoogleIdTokenClaims(oversized, CLIENT_ID)).toBeNull();
  });

  describe("authoritative google email (IA-2)", () => {
    it("trusts a verified @gmail.com email with no hd", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({ email: "user@gmail.com", email_verified: true })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(true);
    });

    it("trusts a verified @GMAIL.COM email regardless of domain casing", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({ email: "user@GMAIL.COM", email_verified: true })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(true);
    });

    it("trusts a verified email on another domain when hd is a non-empty string", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({
            email: "user@company.com",
            email_verified: true,
            hd: "company.com",
          })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(true);
    });

    it("distrusts a verified email on another domain with no hd, without failing the token", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({ email: "user@outlook.com", email_verified: true })
        ),
        CLIENT_ID
      );

      expect(identity).not.toBeNull();
      expect(identity?.email_verified).toBe(false);
    });

    it("treats an empty hd as absent, without failing the token", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({
            email: "user@outlook.com",
            email_verified: true,
            hd: "",
          })
        ),
        CLIENT_ID
      );

      expect(identity).not.toBeNull();
      expect(identity?.email_verified).toBe(false);
    });

    it("treats a numeric hd as absent, without failing the token", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({
            email: "user@outlook.com",
            email_verified: true,
            hd: 12345,
          })
        ),
        CLIENT_ID
      );

      expect(identity).not.toBeNull();
      expect(identity?.email_verified).toBe(false);
    });

    it("treats an object hd as absent, without failing the token", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({
            email: "user@outlook.com",
            email_verified: true,
            hd: { domain: "outlook.com" },
          })
        ),
        CLIENT_ID
      );

      expect(identity).not.toBeNull();
      expect(identity?.email_verified).toBe(false);
    });

    it("distrusts a lookalike domain that merely ends differently, gmail.com.evil.com", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({
            email: "user@gmail.com.evil.com",
            email_verified: true,
          })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(false);
    });

    it("distrusts a lookalike domain that merely contains gmail, notgmail.com", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({ email: "user@notgmail.com", email_verified: true })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(false);
    });

    it("keeps email_verified false for @gmail.com when Google reports it unverified", () => {
      const identity = parseGoogleIdTokenClaims(
        buildIdToken(
          validPayload({ email: "user@gmail.com", email_verified: false })
        ),
        CLIENT_ID
      );

      expect(identity?.email_verified).toBe(false);
    });
  });
});

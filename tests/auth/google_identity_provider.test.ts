import { describe, it, expect, afterEach } from "bun:test";
import { GoogleIdentityProvider } from "../../src/auth/infra/identity_provider/google_identity_provider";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

describe("GoogleIdentityProvider.exchangeCode redirect handling", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("never follows a redirect from the token endpoint, and the redirect target is never reached", async () => {
    let targetWasHit = false;

    const targetServer = Bun.serve({
      port: 0,
      fetch() {
        targetWasHit = true;
        return new Response("should never be reached", { status: 200 });
      },
    });

    const redirectingServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, {
          status: 307,
          headers: {
            Location: `http://localhost:${targetServer.port}/`,
          },
        });
      },
    });

    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (input === GOOGLE_TOKEN_ENDPOINT) {
        return originalFetch(
          `http://localhost:${redirectingServer.port}/`,
          init
        );
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const provider = new GoogleIdentityProvider(
        "fake-client-id",
        "fake-client-secret"
      );

      const result = await provider.exchangeCode({
        code: "authorization-code",
        code_verifier: "code-verifier",
        redirect_uri: "http://localhost:4000/auth/google/callback",
      });

      expect(result).toEqual({
        ok: false,
        failure: { reason: "token_exchange_failed" },
      });
      expect(targetWasHit).toBe(false);
    } finally {
      redirectingServer.stop();
      targetServer.stop();
    }
  });
});

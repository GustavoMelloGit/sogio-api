import { describe, expect, it } from "bun:test";
import { resolveCallerIp } from "../../src/core/infra/rate_limit/caller_ip_resolver";

describe("resolveCallerIp", () => {
  it("uses the real peer IP and ignores X-Forwarded-For when no trusted proxy is configured", () => {
    const request = new Request("http://localhost/", {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });

    const ip = resolveCallerIp(request, "127.0.0.1", false);

    expect(ip).toBe("127.0.0.1");
  });

  it("falls back to a constant key when there's no peer IP and no trusted proxy", () => {
    const request = new Request("http://localhost/");

    const ip = resolveCallerIp(request, null, false);

    expect(ip).toBe("unknown");
  });

  it("uses X-Forwarded-For's first hop when a trusted proxy is configured", () => {
    const request = new Request("http://localhost/", {
      headers: { "X-Forwarded-For": "203.0.113.9, 10.0.0.1" },
    });

    const ip = resolveCallerIp(request, "10.0.0.1", true);

    expect(ip).toBe("203.0.113.9");
  });

  it("falls back to the peer IP when trusted but the header is absent", () => {
    const request = new Request("http://localhost/");

    const ip = resolveCallerIp(request, "127.0.0.1", true);

    expect(ip).toBe("127.0.0.1");
  });
});

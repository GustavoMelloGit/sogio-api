import { describe, it, expect } from "bun:test";
import { serializeExternalSignInCookie } from "../../src/auth/presentation/http/external_sign_in_cookie";

function cookieDeclaration(serialized: string): string {
  return serialized.split(";")[0] ?? "";
}

describe("serializeExternalSignInCookie", () => {
  it("production branch: __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age, and no Domain", () => {
    const local = serializeExternalSignInCookie("verifier-value", 600, true);
    const production = serializeExternalSignInCookie(
      "verifier-value",
      600,
      false
    );

    expect(cookieDeclaration(production)).toBe(
      `__Host-${cookieDeclaration(local)}`
    );
    expect(production).toContain("Secure");
    expect(production).toContain("HttpOnly");
    expect(production).toContain("SameSite=Lax");
    expect(production).toContain("Path=/");
    expect(production).toContain("Max-Age=600");
    expect(production).not.toContain("Domain=");
  });

  it("local branch: no __Host- prefix and no Secure", () => {
    const local = serializeExternalSignInCookie("verifier-value", 600, true);

    expect(cookieDeclaration(local).startsWith("__Host-")).toBe(false);
    expect(local).not.toContain("Secure");
    expect(local).toContain("HttpOnly");
    expect(local).toContain("SameSite=Lax");
    expect(local).toContain("Path=/");
    expect(local).toContain("Max-Age=600");
    expect(local).not.toContain("Domain=");
  });

  it("cleared cookie: Max-Age=0 in both branches", () => {
    expect(serializeExternalSignInCookie("", 0, true)).toContain("Max-Age=0");
    expect(serializeExternalSignInCookie("", 0, false)).toContain("Max-Age=0");
  });
});

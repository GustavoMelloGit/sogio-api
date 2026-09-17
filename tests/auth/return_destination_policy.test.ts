import { describe, it, expect } from "bun:test";
import { isAcceptableReturnDestination } from "../../src/auth/domain/service/return_destination_policy";

describe("isAcceptableReturnDestination (DA-12)", () => {
  it("accepts a plain relative path", () => {
    expect(isAcceptableReturnDestination("/app")).toBe(true);
  });

  it("accepts a relative path with a query string", () => {
    expect(
      isAcceptableReturnDestination("/connect/authorize?request_id=abc")
    ).toBe(true);
  });

  it("rejects a protocol-relative URL", () => {
    expect(isAcceptableReturnDestination("//evil.com")).toBe(false);
  });

  it("rejects a backslash right after the leading slash", () => {
    expect(isAcceptableReturnDestination("/\\evil.com")).toBe(false);
  });

  it("rejects an absolute URL", () => {
    expect(isAcceptableReturnDestination("https://evil.com")).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    expect(isAcceptableReturnDestination("javascript:alert(1)")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAcceptableReturnDestination("")).toBe(false);
  });

  it("rejects a path without a leading slash", () => {
    expect(isAcceptableReturnDestination("app")).toBe(false);
  });

  it("rejects a backslash anywhere in the path", () => {
    expect(isAcceptableReturnDestination("/app/some\\where")).toBe(false);
  });

  it("rejects a newline character", () => {
    expect(isAcceptableReturnDestination("/app\n")).toBe(false);
  });

  it("rejects a tab character", () => {
    expect(isAcceptableReturnDestination("/app\t")).toBe(false);
  });

  it("rejects a path longer than 512 characters", () => {
    const path = "/" + "a".repeat(512);
    expect(isAcceptableReturnDestination(path)).toBe(false);
  });

  it("accepts a path exactly at the 512 character limit", () => {
    const path = "/" + "a".repeat(511);
    expect(isAcceptableReturnDestination(path)).toBe(true);
  });
});

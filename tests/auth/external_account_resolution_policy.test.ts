import { describe, it, expect } from "bun:test";
import { resolveExternalAccount } from "../../src/auth/domain/service/external_account_resolution_policy";

describe("resolveExternalAccount (DA-3)", () => {
  it("a linked sub always signs in as its owner", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: "user-a",
      email_verified: true,
      accounts_with_email: [],
    });

    expect(result).toEqual({ outcome: "signed_in", user_id: "user-a" });
  });

  it("a linked sub signs in even when email_verified is false", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: "user-a",
      email_verified: false,
      accounts_with_email: [],
    });

    expect(result).toEqual({ outcome: "signed_in", user_id: "user-a" });
  });

  it("an unlinked sub with an unverified email is denied, regardless of matching accounts", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: null,
      email_verified: false,
      accounts_with_email: [{ user_id: "user-b", has_linked_identity: false }],
    });

    expect(result).toEqual({
      outcome: "denied",
      reason: "email_not_verified",
    });
  });

  it("an unlinked, verified sub with no matching account creates one", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: null,
      email_verified: true,
      accounts_with_email: [],
    });

    expect(result).toEqual({ outcome: "account_created" });
  });

  it("an unlinked, verified sub with exactly one matching account without a Google identity links to it", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: null,
      email_verified: true,
      accounts_with_email: [{ user_id: "user-b", has_linked_identity: false }],
    });

    expect(result).toEqual({ outcome: "linked", user_id: "user-b" });
  });

  it("an unlinked, verified sub with exactly one matching account that already has a Google identity is a conflict", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: null,
      email_verified: true,
      accounts_with_email: [{ user_id: "user-b", has_linked_identity: true }],
    });

    expect(result).toEqual({ outcome: "denied", reason: "account_conflict" });
  });

  it("an unlinked, verified sub with more than one matching account is a conflict", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: null,
      email_verified: true,
      accounts_with_email: [
        { user_id: "user-b", has_linked_identity: false },
        { user_id: "user-c", has_linked_identity: false },
      ],
    });

    expect(result).toEqual({ outcome: "denied", reason: "account_conflict" });
  });

  it("a sub linked to A whose email now matches B still signs in as A, and B is never touched", () => {
    const result = resolveExternalAccount({
      linked_identity_user_id: "user-a",
      email_verified: true,
      accounts_with_email: [{ user_id: "user-b", has_linked_identity: false }],
    });

    expect(result).toEqual({ outcome: "signed_in", user_id: "user-a" });
  });
});

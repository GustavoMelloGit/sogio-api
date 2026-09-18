export type ExternalAccountCandidate = {
  user_id: string;
  has_linked_identity: boolean;
};

export type ExternalAccountResolutionFacts = {
  linked_identity_user_id: string | null;
  email_verified: boolean;
  accounts_with_email: ExternalAccountCandidate[];
};

export type ExternalAccountResolution =
  | { outcome: "signed_in"; user_id: string }
  | { outcome: "linked"; user_id: string }
  | { outcome: "account_created" }
  | { outcome: "denied"; reason: "email_not_verified" | "account_conflict" };

export function resolveExternalAccount(
  facts: ExternalAccountResolutionFacts
): ExternalAccountResolution {
  if (facts.linked_identity_user_id !== null) {
    return { outcome: "signed_in", user_id: facts.linked_identity_user_id };
  }

  if (!facts.email_verified) {
    return { outcome: "denied", reason: "email_not_verified" };
  }

  if (facts.accounts_with_email.length === 0) {
    return { outcome: "account_created" };
  }

  if (facts.accounts_with_email.length > 1) {
    return { outcome: "denied", reason: "account_conflict" };
  }

  const [account] = facts.accounts_with_email;

  if (!account || account.has_linked_identity) {
    return { outcome: "denied", reason: "account_conflict" };
  }

  return { outcome: "linked", user_id: account.user_id };
}

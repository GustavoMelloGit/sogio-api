import { ExternalSignInRequest } from "../../domain/entity/external_sign_in_request";
import { LinkedIdentity } from "../../domain/entity/linked_identity";
import { User } from "../../domain/entity/user";
import { IdentityLinkedEvent } from "../../domain/event/identity_linked_event";
import { UserCreatedEvent } from "../../domain/event/user_created_event";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { ExternalSignInRequestRepository } from "../../domain/repository/external_sign_in_request_repository";
import type { LinkedIdentityRepository } from "../../domain/repository/linked_identity_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { resolveExternalAccount } from "../../domain/service/external_account_resolution_policy";
import { verifyPkceS256 } from "../../domain/service/pkce_policy";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import type { TransactionRunner } from "../../../core/application/transaction/transaction_runner";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { ExternalIdentityProvider } from "../service/external_identity_provider";
import type { ISessionManager } from "../service/session_manager";

const MAX_ACCOUNT_NAME_LENGTH = 100;

export type CompleteExternalSignInInput = {
  query: Record<string, string> | null;
  code_verifier: string | undefined;
};

export type CompleteExternalSignInDeniedReason =
  | "binding_mismatch"
  | "provider_error"
  | "token_exchange_failed"
  | "claims_invalid"
  | "nonce_mismatch";

export type CompleteExternalSignInDeniedError =
  | "expired"
  | "canceled"
  | "unavailable"
  | "email_not_verified"
  | "account_conflict";

export type CompleteExternalSignInResult =
  | {
      outcome: "signed_in" | "linked" | "account_created";
      user_id: string;
      token: string;
      return_to: string | null;
    }
  | {
      outcome: "denied";
      error: CompleteExternalSignInDeniedError;
      reason?: CompleteExternalSignInDeniedReason;
      return_to: string | null;
    };

function deriveAccountName(name: string | null, email: string): string {
  const trimmed = name?.trim() ?? "";
  const source = trimmed.length > 0 ? trimmed : (email.split("@")[0] ?? email);
  return source.slice(0, MAX_ACCOUNT_NAME_LENGTH);
}

export class CompleteExternalSignInUseCase
  implements UseCase<CompleteExternalSignInInput, CompleteExternalSignInResult>
{
  constructor(
    private readonly identityProvider: ExternalIdentityProvider | null,
    private readonly externalSignInRequestRepository: ExternalSignInRequestRepository,
    private readonly linkedIdentityRepository: LinkedIdentityRepository,
    private readonly authRepository: AuthRepository,
    private readonly sessionManager: ISessionManager,
    private readonly transactionRunner: TransactionRunner,
    private readonly eventDispatcher: EventDispatcher,
    private readonly secretService: DelegatedSecretService,
    private readonly redirectUri: string
  ) {}

  async execute(
    input: CompleteExternalSignInInput
  ): Promise<CompleteExternalSignInResult> {
    if (!this.identityProvider) {
      return this.#denied("unavailable", null);
    }
    const identityProvider = this.identityProvider;

    if (input.query === null) {
      return this.#denied("expired", null);
    }
    const query = input.query;

    const state = query.state;
    if (!state) {
      return this.#denied("expired", null);
    }

    let claimed: ExternalSignInRequest | null;
    try {
      claimed = await this.externalSignInRequestRepository.claim(
        this.secretService.digest(state)
      );
    } catch {
      return this.#denied("unavailable", null);
    }

    if (!claimed) {
      return this.#denied("expired", null);
    }

    const returnTo = claimed.return_to ?? null;

    try {
      return await this.#continueAfterClaim(
        identityProvider,
        query,
        input.code_verifier,
        claimed,
        returnTo
      );
    } catch {
      return this.#denied("unavailable", returnTo);
    }
  }

  async #continueAfterClaim(
    identityProvider: ExternalIdentityProvider,
    query: Record<string, string>,
    codeVerifier: string | undefined,
    claimed: ExternalSignInRequest,
    returnTo: string | null
  ): Promise<CompleteExternalSignInResult> {
    if (
      !codeVerifier ||
      !verifyPkceS256(codeVerifier, claimed.code_challenge)
    ) {
      return this.#denied("expired", returnTo, "binding_mismatch");
    }

    const providerError = query.error;
    if (providerError) {
      return providerError === "access_denied"
        ? this.#denied("canceled", returnTo)
        : this.#denied("unavailable", returnTo, "provider_error");
    }

    const code = query.code;
    if (!code) {
      return this.#denied("unavailable", returnTo);
    }

    const exchangeResult = await identityProvider.exchangeCode({
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.redirectUri,
    });

    if (!exchangeResult.ok) {
      return this.#denied(
        "unavailable",
        returnTo,
        exchangeResult.failure.reason
      );
    }

    const identity = exchangeResult.identity;

    if (
      identity.nonce === null ||
      this.secretService.digest(identity.nonce) !== claimed.nonce_digest
    ) {
      return this.#denied("unavailable", returnTo, "nonce_mismatch");
    }

    const linked = await this.linkedIdentityRepository.findByProviderAndSubject(
      claimed.provider,
      identity.subject
    );

    const accountsWithEmail =
      linked || !identity.email_verified
        ? []
        : await this.authRepository.findUsersByEmailCaseInsensitive(
            identity.email
          );

    const candidates = await Promise.all(
      accountsWithEmail.map(async account => ({
        user_id: account.id,
        has_linked_identity:
          await this.linkedIdentityRepository.existsForUserAndProvider(
            account.id,
            claimed.provider
          ),
      }))
    );

    const decision = resolveExternalAccount({
      linked_identity_user_id: linked?.user_id ?? null,
      email_verified: identity.email_verified,
      accounts_with_email: candidates,
    });

    if (decision.outcome === "denied") {
      return this.#denied(decision.reason, returnTo);
    }

    if (decision.outcome === "signed_in") {
      const token = await this.sessionManager.createSession(decision.user_id);
      return {
        outcome: "signed_in",
        user_id: decision.user_id,
        token,
        return_to: returnTo,
      };
    }

    if (decision.outcome === "linked") {
      await this.linkedIdentityRepository.create(
        LinkedIdentity.create({
          user_id: decision.user_id,
          provider: claimed.provider,
          subject: identity.subject,
        })
      );

      await this.eventDispatcher.dispatch(
        new IdentityLinkedEvent(decision.user_id, claimed.provider)
      );

      const token = await this.sessionManager.createSession(decision.user_id);
      return {
        outcome: "linked",
        user_id: decision.user_id,
        token,
        return_to: returnTo,
      };
    }

    const name = deriveAccountName(identity.name, identity.email);

    const userId = await this.transactionRunner.run(async () => {
      const user = User.create({
        name,
        email: identity.email,
        password: null,
      });
      const savedUser = await this.authRepository.addUser(user);
      await this.linkedIdentityRepository.create(
        LinkedIdentity.create({
          user_id: savedUser.id,
          provider: claimed.provider,
          subject: identity.subject,
        })
      );
      return savedUser.id;
    });

    await this.eventDispatcher.dispatch(new UserCreatedEvent(userId));
    const token = await this.sessionManager.createSession(userId);

    return {
      outcome: "account_created",
      user_id: userId,
      token,
      return_to: returnTo,
    };
  }

  #denied(
    error: CompleteExternalSignInDeniedError,
    returnTo: string | null,
    reason?: CompleteExternalSignInDeniedReason
  ): CompleteExternalSignInResult {
    return { outcome: "denied", error, reason, return_to: returnTo };
  }
}

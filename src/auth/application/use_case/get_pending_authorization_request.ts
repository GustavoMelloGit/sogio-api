import type { AuthorizationRequest } from "../../domain/entity/delegated_access/authorization_request";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import type { AuthorizationRequestRepository } from "../../domain/repository/delegated_access/authorization_request_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { describeScope } from "../../domain/service/oauth_scope_policy";
import type { UseCase } from "../../../core/application/use_case/use_case";

export type GetPendingAuthorizationRequestInput = {
  identifier: string;
  /**
   * The caller identified by whatever session the controller happened to
   * resolve — optional because this consult is reachable before login
   * (see the class doc). Never used to look up consent across users, only
   * ever for this one identified caller.
   */
  userId: string | undefined;
};

export type GetPendingAuthorizationRequestResult =
  | { found: false }
  | {
      found: true;
      appDisplayName: string;
      appDisplayNameVerified: false;
      redirectHost: string;
      scopeDescription: string;
      hasExistingConsent: boolean;
    };

/**
 * Display-only lookup of a Pending Authorization Request by its opaque
 * identifier (task 10, contract step 4). The response never carries an
 * OAuth parameter — no `redirect_uri`, `code_challenge`, `state`, or raw
 * `client_id` — only what the consent screen renders:
 *
 * - the app's self-declared, untrusted name (`appDisplayNameVerified` is
 *   always `false` — there is no verification path in this subdomain, and
 *   the contract keeps that explicit rather than letting the front infer
 *   it);
 * - the redirect's destination *host*, in ASCII/punycode form (E6). `new
 *   URL(...).hostname` already returns the ASCII/punycode form for an IDN
 *   host per the WHATWG URL standard — a homograph host is indistinguishable
 *   in Unicode but unmistakable as `xn--…`, so no manual conversion is
 *   implemented here;
 * - a human-readable description of the v1 scope being requested;
 * - whether the identified caller already has an unrevoked Consent for
 *   this app — the flag that drives the reconnection shortcut.
 *
 * The opaque identifier proves nothing about *who* is asking — it is a
 * bearer value handed to whoever the client's browser was redirected to.
 * `userId` is therefore optional, resolved by the controller from
 * whatever session the caller happens to have (the plan's contract
 * consults *before* login), and this use case only ever answers the
 * consent question for that one identified caller — never "has anyone
 * consented" — so it can never leak another user's consent state.
 *
 * A request that's missing, expired, or already consumed is `found:
 * false` (E2 Mode A). The controller turns this into a generic "not
 * found" with no redirect data of any kind: a dead request is no longer
 * proof that `/authorize`'s validation ever happened.
 */
export class GetPendingAuthorizationRequestUseCase
  implements
    UseCase<
      GetPendingAuthorizationRequestInput,
      GetPendingAuthorizationRequestResult
    >
{
  constructor(
    private readonly authorizationRequestRepository: AuthorizationRequestRepository,
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly consentRepository: ConsentRepository,
    private readonly secretService: DelegatedSecretService
  ) {}

  async execute(
    input: GetPendingAuthorizationRequestInput
  ): Promise<GetPendingAuthorizationRequestResult> {
    const request =
      await this.authorizationRequestRepository.findByIdentifierDigest(
        this.secretService.digest(input.identifier)
      );

    if (!this.#isLive(request)) {
      return { found: false };
    }

    const appRegistration = await this.appRegistrationRepository.findById(
      request.app_registration_id
    );
    if (!appRegistration) {
      return { found: false };
    }

    return {
      found: true,
      appDisplayName: appRegistration.client_name,
      appDisplayNameVerified: false,
      redirectHost: new URL(request.redirect_uri).hostname,
      scopeDescription: describeScope(request.scope),
      hasExistingConsent: await this.#hasUnrevokedConsent(
        input.userId,
        appRegistration.id
      ),
    };
  }

  #isLive(
    request: AuthorizationRequest | null
  ): request is AuthorizationRequest {
    if (!request) {
      return false;
    }
    if (request.consumed_at) {
      return false;
    }
    return request.expires_at.getTime() > Date.now();
  }

  async #hasUnrevokedConsent(
    userId: string | undefined,
    appRegistrationId: string
  ): Promise<boolean> {
    if (!userId) {
      return false;
    }

    const consent = await this.consentRepository.findByUserAndApp(
      userId,
      appRegistrationId
    );
    return consent !== null && !consent.revoked_at;
  }
}

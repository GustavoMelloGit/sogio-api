import { ExternalSignInRequest } from "../../domain/entity/external_sign_in_request";
import type { ExternalSignInRequestRepository } from "../../domain/repository/external_sign_in_request_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";
import { computeS256Challenge } from "../../domain/service/pkce_policy";
import { isAcceptableReturnDestination } from "../../domain/service/return_destination_policy";
import type { ExternalIdentityProvider } from "../service/external_identity_provider";
import type { UseCase } from "../../../core/application/use_case/use_case";

const EXTERNAL_SIGN_IN_REQUEST_TTL_MS = 10 * 60 * 1000;

export type StartExternalSignInInput = {
  return_to?: string;
};

export type StartExternalSignInResult =
  | { outcome: "unavailable" }
  | {
      outcome: "redirect";
      authorization_url: string;
      code_verifier: string;
      expires_at: Date;
    };

export class StartExternalSignInUseCase
  implements UseCase<StartExternalSignInInput, StartExternalSignInResult>
{
  constructor(
    private readonly identityProvider: ExternalIdentityProvider | null,
    private readonly externalSignInRequestRepository: ExternalSignInRequestRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly redirectUri: string
  ) {}

  async execute(
    input: StartExternalSignInInput
  ): Promise<StartExternalSignInResult> {
    if (!this.identityProvider) {
      return { outcome: "unavailable" };
    }

    const returnTo =
      input.return_to !== undefined &&
      isAcceptableReturnDestination(input.return_to)
        ? input.return_to
        : undefined;

    const { secret: state, digest: stateDigest } =
      this.secretService.generate();
    const { secret: codeVerifier } = this.secretService.generate();
    const { secret: nonce, digest: nonceDigest } =
      this.secretService.generate();
    const codeChallenge = computeS256Challenge(codeVerifier);
    const expiresAt = new Date(Date.now() + EXTERNAL_SIGN_IN_REQUEST_TTL_MS);

    await this.externalSignInRequestRepository.create(
      ExternalSignInRequest.create({
        provider: "google",
        state_digest: stateDigest,
        code_challenge: codeChallenge,
        nonce_digest: nonceDigest,
        return_to: returnTo,
        expires_at: expiresAt,
      })
    );

    const authorizationUrl = this.identityProvider.buildAuthorizationUrl({
      state,
      nonce,
      code_challenge: codeChallenge,
      redirect_uri: this.redirectUri,
    });

    return {
      outcome: "redirect",
      authorization_url: authorizationUrl,
      code_verifier: codeVerifier,
      expires_at: expiresAt,
    };
  }
}

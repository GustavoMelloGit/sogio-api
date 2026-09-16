import type { ExternalSignInRequest } from "../entity/external_sign_in_request";

export interface ExternalSignInRequestRepository {
  create(input: ExternalSignInRequest): Promise<ExternalSignInRequest>;
  claim(stateDigest: string): Promise<ExternalSignInRequest | null>;
  deleteExpired(before: Date): Promise<number>;
}

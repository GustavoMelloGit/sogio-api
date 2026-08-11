import type {
  CredentialVerifier,
  Requester,
} from "../../../auth/application/service/credential_verifier";
import { UnauthorizedError } from "../../application/error/unauthorized_error";

/**
 * Transport-level credential gate for `/mcp`. Depends on a single
 * abstraction exposed by the Auth BC — `CredentialVerifier` — never on
 * OAuth or JWT directly (Decisão Arquitetural 2): this class only knows how
 * to pull a bearer token out of the header and hand it to whatever
 * implementation `MiddlewareDi` wires up.
 *
 * The JWT-based check this class used to perform
 * (`SessionManager.verifySession` + `AuthRepository.findUserById`) is gone
 * — not disabled by configuration, deleted (task 13 / Decisão Arquitetural
 * 10). There is no environment branch here and none should ever be added:
 * a single verification mechanism, with a single implementation.
 */
export class McpIdentityResolver {
  constructor(private readonly credentialVerifier: CredentialVerifier) {}

  async resolveRequester(
    authorizationHeader: string | undefined
  ): Promise<Requester> {
    const token = authorizationHeader?.split(" ")[1];

    if (!token) {
      throw new UnauthorizedError("Unauthorized");
    }

    return this.credentialVerifier.verify(token);
  }
}

import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import type {
  CredentialVerifier,
  Requester,
} from "../../application/service/credential_verifier";
import type { AuthRepository } from "../../domain/repository/auth_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import type { DelegatedSecretService } from "../../domain/service/delegated_secret_service";

/**
 * Única implementação de `CredentialVerifier` (task 13): a credencial OAuth
 * opaca do subdomínio Acesso Delegado (task 5). Verifica pelo digest do
 * access token (E10, mesmo caminho que o `/token` já usa para o código e a
 * renovação) e recusa nos quatro motivos do plano — nesta ordem, mas o
 * resultado é sempre o mesmo `UnauthorizedError` genérico, nunca
 * distinguível entre eles:
 *
 * 1. **Não existe** — nenhuma credencial com este digest.
 * 2. **Expirou** — `access_token_expires_at` no passado.
 * 3. **Foi revogada** — `revoked_at` na própria credencial cobre as três
 *    formas de revogação (individual via `revokeById`, por família via
 *    `revokeFamily`, e por cascata do Consentimento via
 *    `revokeAllByConsent`): todas gravam a mesma coluna na linha da
 *    credencial, então checá-la aqui já cobre as três. O `revoked_at` do
 *    próprio Consentimento é checado como defesa em profundidade — pela
 *    ordem em que `RevokeConsentUseCase` grava as duas tabelas (task 12),
 *    nunca deveria haver uma janela em que o Consentimento leia como
 *    revogado e a credencial ainda não, mas o inverso (credencial já
 *    revogada, Consentimento ainda não) é seguro e seria pego pelo
 *    primeiro `revoked_at` de qualquer forma.
 * 4. **Audiência errada** — `resource` da credencial não é a URL canônica
 *    do `/mcp` (RFC 8707 / Decisão Arquitetural 9), ainda que autorização e
 *    verificação rodem no mesmo processo.
 *
 * `expectedResource` chega pelo construtor, montado pelo container de DI
 * (`MiddlewareDi`) a partir de `apiBaseUrl`/`MCP_RESOURCE_PATH` — esta
 * classe nunca importa nada de `presentation/`.
 *
 * Em sucesso, registra o último uso do Consentimento
 * (`ConsentRepository.touchLastUsedAt`) — o dado que a tela de aplicativos
 * conectados (task 14) exibe — e devolve o `Requester` (usuário + aplicativo
 * + escopo), não só o `User`.
 */
export class OAuthCredentialVerifier implements CredentialVerifier {
  constructor(
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly consentRepository: ConsentRepository,
    private readonly authRepository: AuthRepository,
    private readonly secretService: DelegatedSecretService,
    private readonly expectedResource: string
  ) {}

  async verify(accessToken: string): Promise<Requester> {
    const digest = this.secretService.digest(accessToken);
    const credential =
      await this.issuedCredentialRepository.findByAccessTokenDigest(digest);

    if (!credential) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (credential.access_token_expires_at.getTime() <= Date.now()) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (credential.revoked_at) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (credential.resource !== this.expectedResource) {
      throw new UnauthorizedError("Unauthorized");
    }

    const consent = await this.consentRepository.findById(
      credential.consent_id
    );

    if (!consent || consent.revoked_at) {
      throw new UnauthorizedError("Unauthorized");
    }

    const user = await this.authRepository.findUserById(consent.user_id);

    if (!user) {
      throw new UnauthorizedError("Unauthorized");
    }

    await this.consentRepository.touchLastUsedAt(consent.id);

    return {
      user,
      appRegistrationId: consent.app_registration_id,
      scope: consent.scope,
    };
  }
}

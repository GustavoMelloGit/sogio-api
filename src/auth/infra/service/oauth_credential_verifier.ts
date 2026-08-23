import { UnauthorizedError } from "../../../core/application/error/unauthorized_error";
import type { ConsentCascade } from "../../application/service/consent_cascade";
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
 *    credencial, então checá-la aqui já cobre as três credenciais que
 *    *existiam* no momento da cascata. **O `revoked_at`/E9 do próprio
 *    Consentimento (via `Consent#isUsable`, abaixo) não é redundante — é
 *    necessário.** Uma versão anterior deste comentário afirmava que a
 *    janela inversa (Consentimento já lendo como revogado, credencial ainda
 *    não) "nunca deveria" existir por causa da ordem em que
 *    `revokeConsentCascade` grava as duas tabelas; é falso, porque essa
 *    ordem só garante o que acontece com credenciais que já existem no
 *    instante da cascata. `revokeAllByConsent` varre uma foto do banco; uma
 *    credencial que nasce *durante* essa varredura — pela troca de um
 *    código de autorização ainda vivo (E4, TTL de 60s) correndo em
 *    paralelo, ou pela renovação de um refresh token — nunca é visitada por
 *    ela, e chega ao mundo já órfã: com `revoked_at` próprio sempre nulo,
 *    sob um Consentimento cujo `revoked_at` acabou de ser gravado. Sem esta
 *    checagem, essa credencial ficaria válida até o seu próprio
 *    `access_token_expires_at`, minutos ou horas depois de o usuário ter
 *    desconectado o aplicativo. `ExchangeAuthorizationCodeUseCase` e
 *    `RefreshAccessTokenUseCase` agora também reavaliam `Consent#isUsable`
 *    antes de emitir — o que estreita a janela, mas não a fecha (é uma
 *    corrida de verdade entre processos, sem transação cruzando os dois
 *    casos de uso): esta checagem continua sendo o backstop de fato.
 * 4. **Audiência errada** — `resource` da credencial não é a URL canônica
 *    do `/mcp` (RFC 8707 / Decisão Arquitetural 9), ainda que autorização e
 *    verificação rodem no mesmo processo.
 * 5. **Consentimento expirado (E9)** — vida absoluta ou inatividade
 *    vencidas, avaliado junto do passo 3 por `Consent#isUsable`, o
 *    predicado único do agregado (Achado 3 da revisão pós-implementação).
 *    Avaliado aqui, no caminho de verificação, porque o projeto não tem
 *    scheduler (ver `RegisterAppUseCase`): a regra precisa valer na
 *    *próxima* chamada de um agente ainda ativo, não apenas quando alguma
 *    faxina periódica rodar — que não existe. Ao detectar, revoga de
 *    verdade (`revokeConsentCascadeIfNotAlreadyRevoked`, a mesma cascata de
 *    `RevokeConsentUseCase`) em vez de só rejeitar, para que o estado fique
 *    persistido e a checagem seja autocurativa: uma segunda chamada não
 *    paga o custo de reavaliar a expiração, só encontra `revoked_at` já
 *    setado no passo 3.
 *
 * `expectedResource` chega pelo construtor, montado pelo container de DI
 * (`MiddlewareDi`) a partir de `apiBaseUrl`/`MCP_RESOURCE_PATH` — esta
 * classe nunca importa nada de `presentation/`. `consentAbsoluteLifetimeMs`/
 * `consentInactivityTtlMs` chegam da mesma forma, a partir de
 * `environments.ts`.
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
    private readonly expectedResource: string,
    private readonly consentAbsoluteLifetimeMs: number,
    private readonly consentInactivityTtlMs: number,
    private readonly consentCascade: ConsentCascade
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

    if (!consent) {
      throw new UnauthorizedError("Unauthorized");
    }

    if (
      !consent.isUsable(
        this.consentAbsoluteLifetimeMs,
        this.consentInactivityTtlMs
      )
    ) {
      await this.consentCascade.revokeIfNotAlreadyRevoked(consent);
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

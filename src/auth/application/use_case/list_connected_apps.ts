import type { Logger } from "../../../core/application/logger/logger";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { AppRegistration } from "../../domain/entity/delegated_access/app_registration";
import type { Consent } from "../../domain/entity/delegated_access/consent";
import type { User } from "../../domain/entity/user";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import type { AuthorizationCodeRepository } from "../../domain/repository/delegated_access/authorization_code_repository";
import type { AuthorizationRequestRepository } from "../../domain/repository/delegated_access/authorization_request_repository";
import type { ConsentRepository } from "../../domain/repository/delegated_access/consent_repository";
import type { IssuedCredentialRepository } from "../../domain/repository/delegated_access/issued_credential_repository";
import { redirectUriDisplayAnchor } from "../../domain/service/redirect_uri_policy";
import { revokeConsentCascadeIfNotAlreadyRevoked } from "../service/consent_cascade";

export type ConnectedApp = {
  consentId: string;
  appDisplayName: string;
  appDisplayNameVerified: false;
  redirectHosts: string[];
  grantedAt: Date;
  lastUsedAt: Date;
};

/**
 * "Aplicativos conectados" (task 14, contrato com o sogio-front #1 e #3).
 *
 * **Escopo por usuário.** `user.id` vem exclusivamente do middleware de
 * autenticação da sessão do app — nunca de um parâmetro que o cliente
 * controla — e `ConsentRepository.findActiveByUser` já filtra por ele e
 * por `revoked_at IS NULL`. Não existe caminho, nesta classe ou na
 * consulta que ela chama, para alcançar o consentimento de outro usuário
 * por id: a invariante de autorização vive no repositório, não num filtro
 * que este use case pudesse esquecer de aplicar.
 *
 * **Hosts em punycode, todos eles (E6, Achado 2 da revisão pós-implementação).**
 * `redirectUriDisplayAnchor` (o mesmo helper da tela de consentimento, task 10)
 * cobre os dois casos em que `new URL(uri).hostname` sozinho falha: ausência
 * total de authority (forma nativa do RFC 8252 §7.1, host viraria string
 * vazia) e esquema customizado com host IDN (WHATWG só aplica IDNA aos
 * esquemas especiais, então um host homógrafo nunca virava `xn--…`). Como o
 * Consentimento em si não guarda qual `redirect_uri` foi usado numa
 * autorização específica (isso vive nas entidades efêmeras Pedido/Código,
 * já apagadas), esta tela mostra **todos** os `redirect_uris` **registrados**
 * do aplicativo (no máximo `MAX_REDIRECT_URIS`, 10) — não mais só o
 * primeiro, que a revisão classificou como arbitrário e não representativo
 * exatamente na tela onde o usuário decide revogar. Diferente da tela de
 * consentimento (task 10), que sempre mostra o host efetivamente usado
 * naquela autorização, porque aqui não há uma autorização específica para
 * apontar.
 *
 * **E9 avaliado aqui também, não só na verificação da credencial.** A vida
 * absoluta e a inatividade têm que valer mesmo para um aplicativo que o
 * usuário nunca mais deixou chamar `/mcp` — é exatamente esse "aplicativo
 * testado e largado" que a regra de inatividade existe para limpar, e sem
 * tráfego no `/mcp` o `OAuthCredentialVerifier` nunca roda para acioná-la.
 * Esta tela é a outra rota que um usuário efetivamente visita para este
 * dado, então é o segundo — e, para um app já abandonado, o único — lugar
 * onde a checagem dispara: mesmo predicado do agregado (`Consent#isUsable`),
 * mesma cascata (`revokeConsentCascadeIfNotAlreadyRevoked`), e o item
 * expirado é excluído do resultado em vez de devolvido como "conectado".
 *
 * **Expurgo de linhas mortas (E9), best-effort a partir deste tráfego** —
 * o mesmo padrão que `RegisterAppUseCase` já estabeleceu para registros
 * não usados: o projeto não tem scheduler, então a faxina de pedidos de
 * autorização expirados, códigos de autorização mortos e credenciais
 * expiradas/revogadas faz piggyback na visita do usuário a esta tela. Uma
 * falha aqui nunca derruba a listagem.
 */
export class ListConnectedAppsUseCase implements UseCase<void, ConnectedApp[]> {
  constructor(
    private readonly consentRepository: ConsentRepository,
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly issuedCredentialRepository: IssuedCredentialRepository,
    private readonly authorizationRequestRepository: AuthorizationRequestRepository,
    private readonly authorizationCodeRepository: AuthorizationCodeRepository,
    private readonly consentAbsoluteLifetimeMs: number,
    private readonly consentInactivityTtlMs: number,
    private readonly logger: Logger
  ) {}

  async execute(_input: void, user: User): Promise<ConnectedApp[]> {
    const consents = await this.consentRepository.findActiveByUser(user.id);

    const apps = await Promise.all(
      consents.map(consent => this.#toConnectedAppOrNull(consent))
    );

    await this.#purgeDeadRows();

    return apps.filter((app): app is ConnectedApp => app !== null);
  }

  async #toConnectedAppOrNull(consent: Consent): Promise<ConnectedApp | null> {
    if (
      !consent.isUsable(
        this.consentAbsoluteLifetimeMs,
        this.consentInactivityTtlMs
      )
    ) {
      await revokeConsentCascadeIfNotAlreadyRevoked(
        consent,
        this.consentRepository,
        this.issuedCredentialRepository
      );
      return null;
    }

    const appRegistration = await this.appRegistrationRepository.findById(
      consent.app_registration_id
    );

    if (!appRegistration) {
      return null;
    }

    return {
      consentId: consent.id,
      appDisplayName: appRegistration.client_name,
      appDisplayNameVerified: false,
      redirectHosts: this.#redirectHosts(appRegistration),
      grantedAt: consent.granted_at,
      lastUsedAt: consent.last_used_at,
    };
  }

  #redirectHosts(appRegistration: AppRegistration): string[] {
    return appRegistration.redirect_uris.map(redirectUriDisplayAnchor);
  }

  async #purgeDeadRows(): Promise<void> {
    const now = new Date();

    try {
      await Promise.all([
        this.authorizationRequestRepository.deleteExpired(now),
        this.authorizationCodeRepository.deleteExpired(now),
        this.issuedCredentialRepository.deleteExpiredOrRevoked(now),
      ]);
    } catch {
      this.logger.error("Failed to purge dead delegated-access rows", {
        endpoint: "list_connected_apps",
      });
    }
  }
}

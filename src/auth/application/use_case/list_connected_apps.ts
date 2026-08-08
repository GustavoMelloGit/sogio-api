import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
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
import { isConsentExpired } from "../../domain/service/consent_expiry_policy";
import { revokeConsentCascade } from "../service/consent_cascade";

export type ConnectedApp = {
  consentId: string;
  appDisplayName: string;
  appDisplayNameVerified: false;
  redirectHost: string;
  grantedAt: Date;
  lastUsedAt: Date;
};

/**
 * "Aplicativos conectados" (task 14, contrato com o stayhub-front #1 e #3).
 *
 * **Escopo por usuário.** `user.id` vem exclusivamente do middleware de
 * autenticação da sessão do app — nunca de um parâmetro que o cliente
 * controla — e `ConsentRepository.findActiveByUser` já filtra por ele e
 * por `revoked_at IS NULL`. Não existe caminho, nesta classe ou na
 * consulta que ela chama, para alcançar o consentimento de outro usuário
 * por id: a invariante de autorização vive no repositório, não num filtro
 * que este use case pudesse esquecer de aplicar.
 *
 * **Host em punycode (E6).** Mesma abordagem da task 10:
 * `new URL(uri).hostname` já devolve a forma ASCII/punycode de um host IDN
 * — nenhuma biblioteca nova. Como o Consentimento em si não guarda qual
 * `redirect_uri` foi usado numa autorização específica (isso vive nas
 * entidades efêmeras Pedido/Código, já apagadas), o host exibido vem do
 * primeiro `redirect_uri` **registrado** do aplicativo — estável, porque
 * `redirect_uris` é imutável após o registro (invariante do agregado
 * Registro de Aplicativo). Um registro com múltiplos `redirect_uris`
 * mostra só o primeiro; ver o relatório da task 14 para o Arquiteto/
 * Analista de Segurança sobre essa simplificação.
 *
 * **E9 avaliado aqui também, não só na verificação da credencial.** A vida
 * absoluta e a inatividade têm que valer mesmo para um aplicativo que o
 * usuário nunca mais deixou chamar `/mcp` — é exatamente esse "aplicativo
 * testado e largado" que a regra de inatividade existe para limpar, e sem
 * tráfego no `/mcp` o `OAuthCredentialVerifier` nunca roda para acioná-la.
 * Esta tela é a outra rota que um usuário efetivamente visita para este
 * dado, então é o segundo — e, para um app já abandonado, o único — lugar
 * onde a checagem dispara: mesma política (`isConsentExpired`), mesma
 * cascata (`revokeConsentCascade`), e o item expirado é excluído do
 * resultado em vez de devolvido como "conectado".
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
      isConsentExpired(
        consent,
        this.consentAbsoluteLifetimeMs,
        this.consentInactivityTtlMs
      )
    ) {
      await revokeConsentCascade(
        consent.id,
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
      redirectHost: this.#primaryRedirectHost(appRegistration),
      grantedAt: consent.granted_at,
      lastUsedAt: consent.last_used_at,
    };
  }

  #primaryRedirectHost(appRegistration: AppRegistration): string {
    const [primaryRedirectUri] = appRegistration.redirect_uris;

    if (!primaryRedirectUri) {
      throw new IllegalStateError(
        "App registration has no redirect_uris despite the schema invariant"
      );
    }

    return new URL(primaryRedirectUri).hostname;
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

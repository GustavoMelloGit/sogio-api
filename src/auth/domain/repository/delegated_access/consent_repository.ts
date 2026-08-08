import type { Consent } from "../../entity/delegated_access/consent";

export interface ConsentRepository {
  create(input: Consent): Promise<Consent>;
  findById(id: string): Promise<Consent | null>;
  /**
   * Achado 1 da revisão pós-implementação: `(user_id, app_registration_id)`
   * agora tem um índice único (Consentimento é a relação no singular) — esta
   * consulta sempre devolve, no máximo, uma linha por combinação.
   */
  findByUserAndApp(
    userId: string,
    appRegistrationId: string
  ): Promise<Consent | null>;
  /**
   * Aplicativos conectados do usuário (task 14): apenas consentimentos não
   * revogados. Um consentimento revogado nunca aparece na tela de
   * aplicativos conectados — filtrado aqui, não no use case, pela mesma
   * razão de "invariante de autorização, não filtro de UI" já aplicada a
   * `RevokeConsentUseCase`.
   */
  findActiveByUser(userId: string): Promise<Consent[]>;
  /**
   * Atalho de reconexão (task 10): registra o momento de uso de um
   * Consentimento já existente e não revogado. Nunca toca `granted_at` nem
   * `scope` — esses descrevem a concessão original, não esta reconexão.
   */
  touchLastUsedAt(id: string): Promise<void>;
  /**
   * Revogação explícita (ação do usuário) ou por expiração (E9). A cascata
   * sobre as credenciais derivadas é responsabilidade do repositório de
   * Credencial Emitida (`revokeAllByConsent`), acionado pelo caso de uso.
   */
  revoke(id: string): Promise<void>;
  /**
   * Achado 1 da revisão pós-implementação: revive a linha existente de
   * `(user, app)` como uma concessão nova, em vez de inserir uma segunda —
   * o índice único que este achado introduziu rejeitaria esse insert de
   * qualquer forma. Usado por `DecideAuthorizationRequestUseCase#resolveConsent`
   * quando o Consentimento existente foi revogado ou já não é utilizável
   * (E9): limpa `revoked_at`, e redefine `granted_at`/`last_used_at` para
   * `grantedAt` — a primeira autorização após uma revogação ou uma
   * expiração tem que ser, ela própria, uma concessão nova e explícita, não
   * uma reconexão silenciosa.
   */
  revive(id: string, scope: string, grantedAt: Date): Promise<void>;
}

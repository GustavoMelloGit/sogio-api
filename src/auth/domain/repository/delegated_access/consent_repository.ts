import type { Consent } from "../../entity/delegated_access/consent";

export interface ConsentRepository {
  create(input: Consent): Promise<Consent>;
  findById(id: string): Promise<Consent | null>;
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
}

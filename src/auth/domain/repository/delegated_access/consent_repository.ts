import type { Consent } from "../../entity/delegated_access/consent";

export interface ConsentRepository {
  create(input: Consent): Promise<Consent>;
  findById(id: string): Promise<Consent | null>;
  findByUserAndApp(
    userId: string,
    appRegistrationId: string
  ): Promise<Consent | null>;
  /**
   * Revogação explícita (ação do usuário) ou por expiração (E9). A cascata
   * sobre as credenciais derivadas é responsabilidade do repositório de
   * Credencial Emitida (`revokeAllByConsent`), acionado pelo caso de uso.
   */
  revoke(id: string): Promise<void>;
}

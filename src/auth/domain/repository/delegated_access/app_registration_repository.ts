import type { AppRegistration } from "../../entity/delegated_access/app_registration";

export interface AppRegistrationRepository {
  create(input: AppRegistration): Promise<AppRegistration>;
  findById(id: string): Promise<AppRegistration | null>;
  /**
   * Expurgo (E9): remove registros criados antes de `threshold` que nunca
   * receberam nenhum Consentimento. Retorna o número de linhas removidas.
   */
  deleteUnusedRegisteredBefore(threshold: Date): Promise<number>;
}

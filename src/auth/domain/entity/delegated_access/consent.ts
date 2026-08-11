import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";
import { isConsentExpired } from "../../service/consent_expiry_policy";

export const consentSchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  app_registration_id: z.uuidv4(),
  scope: z.string().min(1).max(255),
  granted_at: z.date(),
  last_used_at: z.date(),
  revoked_at: z.date().nullable().optional(),
});

export type ConsentData = z.infer<typeof consentSchema>;
type ConsentInputData = z.input<typeof consentSchema>;

/**
 * @kind Entity
 *
 * Consentimento — a relação (usuário, aplicativo) que o usuário concede e
 * revoga. Ponto único de revogação por ação explícita do usuário; a
 * revogação por reuso de credencial é escopada à família (ver Credencial
 * Emitida), não a este agregado.
 */
export class Consent {
  readonly #data: ConsentData;

  private constructor(data: ConsentData) {
    this.#data = consentSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(data: WithoutBaseEntity<ConsentInputData>): Consent {
    return new Consent({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as ConsentData);
  }

  public static reconstitute(data: ConsentData): Consent {
    return new Consent(data);
  }

  /**
   * Achado 3 da revisão pós-implementação: o único predicado de vigência do
   * agregado, consumido pelos seis caminhos que hoje avaliavam
   * `revoked_at`/E9 de forma inconsistente (verificação de credencial,
   * listagem de aplicativos conectados, consulta e decisão do pedido
   * pendente, troca de código e renovação). Nunca revogado **e** nem
   * vencido por vida absoluta nem por inatividade (E9,
   * `isConsentExpired`).
   */
  public isUsable(
    absoluteLifetimeMs: number,
    inactivityTtlMs: number,
    now: Date = new Date()
  ): boolean {
    if (this.#data.revoked_at) {
      return false;
    }
    return !isConsentExpired(
      this.#data,
      absoluteLifetimeMs,
      inactivityTtlMs,
      now
    );
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get app_registration_id() {
    return this.#data.app_registration_id;
  }

  get scope() {
    return this.#data.scope;
  }

  get granted_at() {
    return this.#data.granted_at;
  }

  get last_used_at() {
    return this.#data.last_used_at;
  }

  get revoked_at() {
    return this.#data.revoked_at;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at;
  }
}

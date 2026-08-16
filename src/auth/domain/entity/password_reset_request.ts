import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";

export const passwordResetRequestSchema = baseEntitySchema.extend({
  user_id: z.uuidv4(),
  token_digest: z.string().length(64),
  expires_at: z.date(),
  consumed_at: z.date().nullable().optional(),
});

export type PasswordResetRequestData = z.infer<
  typeof passwordResetRequestSchema
>;
type PasswordResetRequestInputData = z.input<typeof passwordResetRequestSchema>;

/**
 * @kind Entity
 *
 * Pedido de Recuperação de Senha — comprovante de uso único e vida curta de
 * que alguém solicitou a recuperação de acesso de uma conta, no mesmo molde
 * de `AuthorizationCode`. Deliberadamente sem o email do usuário (§2.3 do
 * plano) — apenas `user_id`.
 */
export class PasswordResetRequest {
  readonly #data: PasswordResetRequestData;

  private constructor(data: PasswordResetRequestData) {
    this.#data = passwordResetRequestSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<PasswordResetRequestInputData>
  ): PasswordResetRequest {
    return new PasswordResetRequest({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as PasswordResetRequestData);
  }

  public static reconstitute(
    data: PasswordResetRequestData
  ): PasswordResetRequest {
    return new PasswordResetRequest(data);
  }

  get id() {
    return this.#data.id;
  }

  get user_id() {
    return this.#data.user_id;
  }

  get token_digest() {
    return this.#data.token_digest;
  }

  get expires_at() {
    return this.#data.expires_at;
  }

  get consumed_at() {
    return this.#data.consumed_at;
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

import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";

export const appRegistrationSchema = baseEntitySchema.extend({
  client_name: z.string().min(1).max(255),
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1),
  token_endpoint_auth_method: z.literal("none").default("none"),
});

export type AppRegistrationData = z.infer<typeof appRegistrationSchema>;
type AppRegistrationInputData = z.input<typeof appRegistrationSchema>;

/**
 * @kind Entity
 *
 * Registro de Aplicativo — cadastro autodeclarado de um cliente MCP.
 * URIs de retorno são imutáveis após o registro; alterar exige novo registro.
 */
export class AppRegistration {
  readonly #data: AppRegistrationData;

  private constructor(data: AppRegistrationData) {
    this.#data = appRegistrationSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<AppRegistrationInputData>
  ): AppRegistration {
    return new AppRegistration({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as AppRegistrationData);
  }

  public static reconstitute(data: AppRegistrationData): AppRegistration {
    return new AppRegistration(data);
  }

  get id() {
    return this.#data.id;
  }

  get client_name() {
    return this.#data.client_name;
  }

  get redirect_uris() {
    return this.#data.redirect_uris;
  }

  get token_endpoint_auth_method() {
    return this.#data.token_endpoint_auth_method;
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

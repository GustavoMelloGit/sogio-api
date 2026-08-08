import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";
import { hasUnsafeDisplayNameCharacters } from "../../service/app_display_name_policy";

/** RFC 7591 registration limits (E9's "limites de tamanho e cardinalidade"). */
export const MAX_CLIENT_NAME_LENGTH = 255;
export const MAX_REDIRECT_URI_LENGTH = 2048;
export const MAX_REDIRECT_URIS = 10;

export const appRegistrationSchema = baseEntitySchema.extend({
  client_name: z
    .string()
    .min(1)
    .max(MAX_CLIENT_NAME_LENGTH)
    .refine(name => !hasUnsafeDisplayNameCharacters(name), {
      message: "client_name contains disallowed characters",
    }),
  redirect_uris: z
    .array(z.string().min(1).max(MAX_REDIRECT_URI_LENGTH))
    .min(1)
    .max(MAX_REDIRECT_URIS),
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

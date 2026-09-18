import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { z } from "zod";
import { IDENTITY_PROVIDERS } from "./linked_identity";

export const externalSignInRequestSchema = baseEntitySchema.extend({
  provider: z.enum(IDENTITY_PROVIDERS),
  state_digest: z.string().length(64),
  code_challenge: z.string().min(1).max(255),
  nonce_digest: z.string().length(64),
  return_to: z.string().max(512).nullable().optional(),
  expires_at: z.date(),
  consumed_at: z.date().nullable().optional(),
});

export type ExternalSignInRequestData = z.infer<
  typeof externalSignInRequestSchema
>;
type ExternalSignInRequestInputData = z.input<
  typeof externalSignInRequestSchema
>;

export class ExternalSignInRequest {
  readonly #data: ExternalSignInRequestData;

  private constructor(data: ExternalSignInRequestData) {
    this.#data = externalSignInRequestSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<ExternalSignInRequestInputData>
  ): ExternalSignInRequest {
    return new ExternalSignInRequest({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as ExternalSignInRequestData);
  }

  public static reconstitute(
    data: ExternalSignInRequestData
  ): ExternalSignInRequest {
    return new ExternalSignInRequest(data);
  }

  get id() {
    return this.#data.id;
  }

  get provider() {
    return this.#data.provider;
  }

  get state_digest() {
    return this.#data.state_digest;
  }

  get code_challenge() {
    return this.#data.code_challenge;
  }

  get nonce_digest() {
    return this.#data.nonce_digest;
  }

  get return_to() {
    return this.#data.return_to;
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

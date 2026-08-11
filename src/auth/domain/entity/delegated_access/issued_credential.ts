import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../../core/domain/entity/base_entity";
import { z } from "zod";

export const issuedCredentialSchema = baseEntitySchema.extend({
  consent_id: z.uuidv4(),
  family_id: z.uuidv4(),
  access_token_digest: z.string().length(64),
  access_token_expires_at: z.date(),
  refresh_token_digest: z.string().length(64),
  refresh_token_expires_at: z.date(),
  resource: z.string().min(1).max(512),
  /**
   * Digest of the authorization code that produced *this* credential — set
   * only on the first credential of a family (issued by `/token`'s
   * `authorization_code` grant), never on a successor produced by rotation.
   * The link `revokeFamily` on code reuse needs (E4): the code itself
   * doesn't record which family it minted, so replaying an
   * already-consumed code resolves to a family only by looking it up here,
   * by the digest the replay attempt is claiming against.
   */
  authorization_code_digest: z.string().length(64).nullable().optional(),
  rotated_at: z.date().nullable().optional(),
  successor_id: z.uuidv4().nullable().optional(),
  revoked_at: z.date().nullable().optional(),
});

export type IssuedCredentialData = z.infer<typeof issuedCredentialSchema>;
type IssuedCredentialInputData = z.input<typeof issuedCredentialSchema>;

/**
 * @kind Entity
 *
 * Credencial Emitida — um par acesso/renovação sob um Consentimento.
 * `family_id` é o identificador de cadeia herdado a cada rotação: reuso de
 * uma credencial de renovação já rotacionada revoga a família inteira, nunca
 * o Consentimento (E4). `rotated_at`/`successor_id` sustentam a janela de
 * graça da rotação.
 */
export class IssuedCredential {
  readonly #data: IssuedCredentialData;

  private constructor(data: IssuedCredentialData) {
    this.#data = issuedCredentialSchema.parse(data);
  }

  private static nextId(): string {
    return crypto.randomUUID();
  }

  public static create(
    data: WithoutBaseEntity<IssuedCredentialInputData>
  ): IssuedCredential {
    return new IssuedCredential({
      ...data,
      id: this.nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    } as IssuedCredentialData);
  }

  public static reconstitute(data: IssuedCredentialData): IssuedCredential {
    return new IssuedCredential(data);
  }

  get id() {
    return this.#data.id;
  }

  get consent_id() {
    return this.#data.consent_id;
  }

  get family_id() {
    return this.#data.family_id;
  }

  get access_token_digest() {
    return this.#data.access_token_digest;
  }

  get access_token_expires_at() {
    return this.#data.access_token_expires_at;
  }

  get refresh_token_digest() {
    return this.#data.refresh_token_digest;
  }

  get refresh_token_expires_at() {
    return this.#data.refresh_token_expires_at;
  }

  get resource() {
    return this.#data.resource;
  }

  get authorization_code_digest() {
    return this.#data.authorization_code_digest;
  }

  get rotated_at() {
    return this.#data.rotated_at;
  }

  get successor_id() {
    return this.#data.successor_id;
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

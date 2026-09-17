import {
  LinkedIdentity,
  type IdentityProvider,
} from "../../../src/auth/domain/entity/linked_identity";
import { LinkedIdentityPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/linked_identity_postgres_repository";

export async function createLinkedIdentityFixture(input: {
  userId: string;
  provider?: IdentityProvider;
  subject?: string;
}): Promise<LinkedIdentity> {
  const repository = new LinkedIdentityPostgresRepository();

  return repository.create(
    LinkedIdentity.create({
      user_id: input.userId,
      provider: input.provider ?? "google",
      subject: input.subject ?? `google-subject-${crypto.randomUUID()}`,
    })
  );
}

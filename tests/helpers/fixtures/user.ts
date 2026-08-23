import { User } from "../../../src/auth/domain/entity/user";
import { AuthPostgresRepository } from "../../../src/auth/infra/database/postgres_repository/auth_postgres_repository";
import { db } from "../../../src/core/infra/database/drizzle/database";
import { usersTable } from "../../../src/core/infra/database/drizzle/schema";
import { EnsureFreeSubscriptionUseCase } from "../../../src/billing/application/use_case/ensure_free_subscription";
import { PlanPostgresRepository } from "../../../src/billing/infra/database/postgres_repository/plan_postgres_repository";
import { SubscriptionPostgresRepository } from "../../../src/billing/infra/database/postgres_repository/subscription_postgres_repository";
import { inMemoryEventDispatcher } from "../../../src/core/infra/event/in_memory_event_dispatcher";

/**
 * Bypasses `RegisterUserUseCase`, so `UserCreatedEvent` is never dispatched —
 * the Free subscription is provisioned directly here instead, mirroring what
 * `StartFreeSubscriptionOnUserCreated` does in production, so a fixture user
 * behaves like a real one against the platform-access gate (DA-9).
 */
export async function createUserFixture(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: User; plainPassword: string }> {
  const hashedPassword = await Bun.password.hash(input.password);

  const entity = User.create({
    name: input.name,
    email: input.email,
    password: hashedPassword,
  });

  const repository = new AuthPostgresRepository();
  const user = await repository.addUser(entity);

  const ensureFreeSubscriptionUseCase = new EnsureFreeSubscriptionUseCase(
    new SubscriptionPostgresRepository(),
    new PlanPostgresRepository(),
    inMemoryEventDispatcher
  );
  await ensureFreeSubscriptionUseCase.execute({ user_id: user.id });

  return { user, plainPassword: input.password };
}

export async function createAdminFixture(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: User; plainPassword: string }> {
  const hashedPassword = await Bun.password.hash(input.password);

  const id = crypto.randomUUID();
  const now = new Date();

  const result = await db
    .insert(usersTable)
    .values({
      id,
      name: input.name,
      email: input.email,
      password: hashedPassword,
      role: "admin",
      created_at: now,
      updated_at: now,
    })
    .returning();

  const row = result[0];
  if (!row) {
    throw new Error("Failed to create admin fixture");
  }

  const user = User.reconstitute({
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role as "admin",
    locale: "pt-BR",
    time_zone: "America/Sao_Paulo",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  });

  return { user, plainPassword: input.password };
}

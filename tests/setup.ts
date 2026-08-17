import { afterAll } from "bun:test";
import { bunRoutes } from "../src/core/infra/http/routes/routes";
import { seedPlans } from "../src/billing/infra/database/seed_plans";

/** `db:push:test` applies the schema but never migration SQL (DA-12). */
await seedPlans();

const server = Bun.serve({
  port: 0,
  routes: bunRoutes,
});

export const baseUrl = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
});

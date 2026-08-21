import { afterAll } from "bun:test";
import { bunRoutes } from "../src/core/infra/http/routes/routes";
import { seedPlans } from "./helpers/fixtures/plan";

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

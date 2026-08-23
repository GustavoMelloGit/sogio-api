import { afterAll } from "bun:test";
import { bunServeOptions } from "../src/core/infra/http/routes/routes";
import { seedPlans } from "./helpers/fixtures/plan";

/** `db:push:test` applies the schema but never migration SQL (DA-12). */
await seedPlans();

const server = Bun.serve({
  ...bunServeOptions,
  port: 0,
});

export const baseUrl = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
});

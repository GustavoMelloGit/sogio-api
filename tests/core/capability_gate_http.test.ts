import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  HttpControllerMethod,
  type Controller,
} from "../../src/core/presentation/controller/controller";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";
import { Entitlement } from "../../src/billing/domain/value_object/entitlement";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { truncate } from "../helpers/database";
import {
  createAdminFixture,
  createUserFixture,
} from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";

class FakeEntitlementService implements EntitlementService {
  constructor(private readonly entitlement: Entitlement) {}

  async entitlementOf(): Promise<Entitlement> {
    return this.entitlement;
  }
}

const deniedEntitlementService = new FakeEntitlementService(
  Entitlement.of({
    has_platform_access: true,
    status: "active",
    capabilities: CapabilitySet.of({}),
    plan: null,
  })
);

const grantedEntitlementService = new FakeEntitlementService(
  Entitlement.of({
    has_platform_access: true,
    status: "active",
    capabilities: CapabilitySet.of({ export_reports: true }),
    plan: null,
  })
);

/**
 * Only exists to prove `requiredCapability` gates a route through
 * `BunHttpControllerAdapter` — never a real route.
 */
class FakeCapabilityGatedController implements Controller {
  path: string;
  method = HttpControllerMethod.GET;

  constructor(path: string) {
    this.path = path;
  }

  async handle() {
    return { ok: true };
  }
}

const deniedController = new FakeCapabilityGatedController(
  "/__test/capability/denied"
);
const grantedController = new FakeCapabilityGatedController(
  "/__test/capability/granted"
);

const server = Bun.serve({
  port: 0,
  routes: {
    [deniedController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        deniedController,
        true,
        deniedEntitlementService,
        false,
        false,
        "export_reports"
      ),
    },
    [grantedController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        grantedController,
        true,
        grantedEntitlementService,
        false,
        false,
        "export_reports"
      ),
    },
  },
});

const baseUrl = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
});

describe("requiredCapability gate through BunHttpControllerAdapter (D-5, D-6)", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  it("returns 403 when the resolved entitlement lacks the required access capability", async () => {
    const { user } = await createUserFixture({
      name: "Sem Capacidade",
      email: "capability.denied@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await fetch(`${baseUrl}${deniedController.path}`, {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(
      "Your current plan doesn't include report exports. Upgrade your plan to unlock it."
    );
  });

  it("returns 200 when the resolved entitlement grants the required access capability", async () => {
    const { user } = await createUserFixture({
      name: "Com Capacidade",
      email: "capability.granted@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await fetch(`${baseUrl}${grantedController.path}`, {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
  });

  it("lets an admin through a capability-gated route even when the entitlement would deny it", async () => {
    const { user } = await createAdminFixture({
      name: "Admin",
      email: "capability.admin@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id, "admin");

    const res = await fetch(`${baseUrl}${deniedController.path}`, {
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  HttpControllerMethod,
  type Controller,
} from "../../src/core/presentation/controller/controller";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";
import { Entitlement } from "../../src/billing/domain/value_object/entitlement";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { IllegalStateError } from "../../src/core/application/error/illegal_state_error";
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
    capabilities: CapabilitySet.of({
      export_reports: true,
      bulk_import: false,
    }),
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

describe("BunHttpControllerAdapter — requiredCapability configuration guard (C-2)", () => {
  it("throws at construction when requiredCapability is declared on a route that is neither authenticated nor adminOnly", () => {
    const controller = new FakeCapabilityGatedController(
      "/__test/capability/misconfigured-unauthenticated"
    );

    expect(() =>
      BunHttpControllerAdapter(
        controller,
        false,
        grantedEntitlementService,
        false,
        false,
        "export_reports"
      )
    ).toThrow();
  });

  it("throws at construction when requiredCapability is declared together with adminOnly", () => {
    const controller = new FakeCapabilityGatedController(
      "/__test/capability/misconfigured-admin-only"
    );

    expect(() =>
      BunHttpControllerAdapter(
        controller,
        true,
        grantedEntitlementService,
        true,
        false,
        "export_reports"
      )
    ).toThrow();
  });

  it("does not throw when requiredCapability is declared on an authenticated, non-admin route", () => {
    const controller = new FakeCapabilityGatedController(
      "/__test/capability/misconfigured-control"
    );

    expect(() =>
      BunHttpControllerAdapter(
        controller,
        true,
        grantedEntitlementService,
        false,
        false,
        "export_reports"
      )
    ).not.toThrow();
  });
});

class FakeIllegalStateController implements Controller {
  path = "/__test/capability/illegal-state";
  method = HttpControllerMethod.GET;

  async handle(): Promise<never> {
    throw new IllegalStateError(
      'Capability "max_properties" is a "limit" capability; use limitOf() instead of allows()'
    );
  }
}

const illegalStateController = new FakeIllegalStateController();

const illegalStateServer = Bun.serve({
  port: 0,
  routes: {
    [illegalStateController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        illegalStateController,
        true,
        grantedEntitlementService
      ),
    },
  },
});

const illegalStateBaseUrl = `http://localhost:${illegalStateServer.port}`;

afterAll(() => {
  illegalStateServer.stop();
});

describe("BunHttpControllerAdapter — IllegalStateError never leaks its message (C-4)", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  it("returns a generic message with status 500 instead of the developer-facing IllegalStateError message", async () => {
    const { user } = await createUserFixture({
      name: "Erro Interno",
      email: "illegal.state@sogio.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);

    const res = await fetch(
      `${illegalStateBaseUrl}${illegalStateController.path}`,
      {
        headers: { Authorization: "Bearer " + token },
      }
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Internal server error");
    expect(body.message).not.toContain("limitOf");
    expect(body.message).not.toContain("allows");
  });
});

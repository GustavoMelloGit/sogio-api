import { describe, it, expect, beforeEach } from "bun:test";
import { api } from "../helpers/server";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";

describe("RBAC — auth endpoints", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  describe("POST /auth/users (register)", () => {
    it("returns role: user on registration", async () => {
      const res = await api("/auth/users", {
        method: "POST",
        body: JSON.stringify({
          name: "Test User",
          email: "test@sogio.dev",
          password: "password123",
        }),
      });
      const body = (await res.json()) as {
        token: string;
        user: Record<string, unknown>;
      };

      expect(res.status).toBe(200);
      expect(body.user.role).toBe("user");
    });

    it("mass assignment blocked — role: admin in body is ignored", async () => {
      const res = await api("/auth/users", {
        method: "POST",
        body: JSON.stringify({
          name: "Would-be Admin",
          email: "attacker@sogio.dev",
          password: "password123",
          role: "admin",
        }),
      });
      const body = (await res.json()) as {
        token: string;
        user: Record<string, unknown>;
      };

      expect(res.status).toBe(200);
      expect(body.user.role).toBe("user");
    });
  });

  describe("POST /auth/sign-in", () => {
    it("returns role in output", async () => {
      const { user, plainPassword } = await createUserFixture({
        name: "Ada Lovelace",
        email: "ada@sogio.dev",
        password: "correct-horse-battery",
      });

      const res = await api("/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: user.email, password: plainPassword }),
      });
      const body = (await res.json()) as {
        token: string;
        user: Record<string, unknown>;
      };

      expect(res.status).toBe(200);
      expect(body.user.role).toBeDefined();
      expect(body.user.role).toBe("user");
    });
  });
});

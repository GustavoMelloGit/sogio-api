import { describe, it, expect, beforeEach } from "bun:test";
import { MiddlewareDi } from "../../src/auth/infra/di/middleware";
import { McpIdentityResolver } from "../../src/core/infra/mcp/identity_resolver";
import { UnauthorizedError } from "../../src/core/application/error/unauthorized_error";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createAuthToken } from "../helpers/fixtures/auth_token";

describe("McpIdentityResolver", () => {
  beforeEach(async () => {
    await truncate(["users"]);
  });

  function makeResolver(): McpIdentityResolver {
    const middlewareDi = new MiddlewareDi();
    return new McpIdentityResolver(
      middlewareDi.makeAuthRepository(),
      middlewareDi.makeSessionManager()
    );
  }

  it("resolves the correct user for a valid bearer token", async () => {
    const { user } = await createUserFixture({
      name: "Ada Lovelace",
      email: "ada@stayhub.dev",
      password: "password123",
    });
    const token = await createAuthToken(user.id);
    const resolver = makeResolver();

    const resolvedUser = await resolver.resolveUser(`Bearer ${token}`);

    expect(resolvedUser.id).toBe(user.id);
    expect(resolvedUser.email).toBe(user.email);
  });

  it("throws UnauthorizedError when the authorization header is missing", async () => {
    const resolver = makeResolver();

    await expect(resolver.resolveUser(undefined)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("throws UnauthorizedError when the authorization header has no token", async () => {
    const resolver = makeResolver();

    await expect(resolver.resolveUser("Bearer")).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("throws UnauthorizedError for an invalid or expired token", async () => {
    const resolver = makeResolver();

    await expect(
      resolver.resolveUser("Bearer invalid.token.value")
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws UnauthorizedError when the token is valid but the user no longer exists", async () => {
    const token = await createAuthToken(crypto.randomUUID());
    const resolver = makeResolver();

    await expect(
      resolver.resolveUser(`Bearer ${token}`)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

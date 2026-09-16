import {
  env,
  sessionAbsoluteTtlMs,
} from "../../../core/infra/config/environments";
import type { ControllerRequest } from "../../../core/presentation/controller/controller";

export const sessionCookieName = (): string =>
  isLocalEnvironment()
    ? env.SESSION_COOKIE_NAME
    : `__Secure-${env.SESSION_COOKIE_NAME}`;

function isLocalEnvironment(): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

export function buildSessionCookie(secret: string): string {
  return serialize(secret, Math.floor(sessionAbsoluteTtlMs / 1000));
}

export function buildClearedSessionCookie(): string {
  return serialize("", 0);
}

function serialize(value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${sessionCookieName()}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (env.SESSION_COOKIE_DOMAIN) {
    attributes.push(`Domain=${env.SESSION_COOKIE_DOMAIN}`);
  }

  if (!isLocalEnvironment()) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function readSessionSecret(
  request: ControllerRequest
): string | undefined {
  return request.sessionCredential?.secret;
}

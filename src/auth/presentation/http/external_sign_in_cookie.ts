import type { ControllerRequest } from "../../../core/presentation/controller/controller";
import { isLocalEnvironment } from "./session_cookie";

const COOKIE_NAME = "google_sign_in_verifier";

export function externalSignInCookieName(): string {
  return isLocalEnvironment() ? COOKIE_NAME : `__Host-${COOKIE_NAME}`;
}

export function buildExternalSignInCookie(
  codeVerifier: string,
  maxAgeSeconds: number
): string {
  return serialize(codeVerifier, maxAgeSeconds);
}

export function buildClearedExternalSignInCookie(): string {
  return serialize("", 0);
}

function serialize(value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${externalSignInCookieName()}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (!isLocalEnvironment()) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function readExternalSignInCookieVerifier(
  request: ControllerRequest
): string | undefined {
  return request.cookies[externalSignInCookieName()];
}

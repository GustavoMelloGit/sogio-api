import type { ControllerRequest } from "../../../core/presentation/controller/controller";
import { isLocalEnvironment } from "./session_cookie";

const COOKIE_NAME = "google_sign_in_verifier";

function cookieNameFor(isLocal: boolean): string {
  return isLocal ? COOKIE_NAME : `__Host-${COOKIE_NAME}`;
}

export function externalSignInCookieName(): string {
  return cookieNameFor(isLocalEnvironment());
}

export function buildExternalSignInCookie(
  codeVerifier: string,
  maxAgeSeconds: number
): string {
  return serializeExternalSignInCookie(
    codeVerifier,
    maxAgeSeconds,
    isLocalEnvironment()
  );
}

export function buildClearedExternalSignInCookie(): string {
  return serializeExternalSignInCookie("", 0, isLocalEnvironment());
}

export function serializeExternalSignInCookie(
  value: string,
  maxAgeSeconds: number,
  isLocal: boolean
): string {
  const attributes = [
    `${cookieNameFor(isLocal)}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (!isLocal) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function readExternalSignInCookieVerifier(
  request: ControllerRequest
): string | undefined {
  return request.cookies[externalSignInCookieName()];
}

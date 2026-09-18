export const GOOGLE_SIGN_IN_START_PATH = "/auth/google/start";
export const GOOGLE_SIGN_IN_CALLBACK_PATH = "/auth/google/callback";
export const GOOGLE_SIGN_IN_RESULT_PATH = "/login/google";

export function buildGoogleSignInResultUrl(
  frontBaseUrl: string,
  outcome: { status: string } | { error: string },
  returnTo: string | null
): string {
  const url = new URL(`${frontBaseUrl}${GOOGLE_SIGN_IN_RESULT_PATH}`);

  if ("status" in outcome) {
    url.searchParams.set("status", outcome.status);
  } else {
    url.searchParams.set("error", outcome.error);
  }

  if (returnTo) {
    url.searchParams.set("return_to", returnTo);
  }

  return url.toString();
}

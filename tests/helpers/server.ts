export { baseUrl } from "../setup";

export async function api(path: string, init?: RequestInit): Promise<Response> {
  const { baseUrl } = await import("../setup");
  return fetch(baseUrl + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export function readSetCookie(
  response: Response,
  name: string
): string | undefined {
  const header = response.headers.get("set-cookie");

  if (!header) {
    return undefined;
  }

  for (const cookie of header.split(",")) {
    const [pair] = cookie.split(";");
    const separator = pair?.indexOf("=") ?? -1;

    if (!pair || separator === -1) {
      continue;
    }

    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function readSetCookieAttributes(
  response: Response,
  name: string
): string | undefined {
  const header = response.headers.get("set-cookie");

  return header
    ?.split(",")
    .map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${name}=`));
}

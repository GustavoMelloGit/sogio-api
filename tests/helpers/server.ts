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

/**
 * Valor de um cookie numa resposta. `fetch` junta os `Set-Cookie` numa string
 * só, e nenhum atributo de cookie aceita vírgula sem aspas, então separar por
 * vírgula é seguro aqui.
 */
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

/** Atributos do `Set-Cookie` de um cookie, para conferir `HttpOnly` e afins. */
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

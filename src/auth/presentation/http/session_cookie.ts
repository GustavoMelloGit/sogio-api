import {
  env,
  sessionAbsoluteTtlMs,
} from "../../../core/infra/config/environments";
import type { ControllerRequest } from "../../../core/presentation/controller/controller";

/**
 * Monta o `Set-Cookie` da sessão do app.
 *
 * - `HttpOnly` é o ponto da mudança: o segredo deixa de ser legível por
 *   JavaScript, então um XSS não leva mais a sessão inteira embora.
 * - `SameSite=Lax` mantém o cookie nas navegações de topo — o
 *   `/authorize` do OAuth depende disso — e o retira dos `POST`
 *   cross-site, que é o vetor de CSRF.
 * - `Secure` fora de desenvolvimento, onde o front roda em `http://localhost`.
 * - `Domain` só quando configurado: sem ele o cookie fica preso ao host, o
 *   que em desenvolvimento vale para `localhost` em qualquer porta e basta
 *   para front e API locais se entenderem.
 * - `Max-Age` igual à vida absoluta da sessão, para o navegador descartar o
 *   cookie junto com a linha que o banco também já considera morta.
 */
export function buildSessionCookie(secret: string): string {
  return serialize(secret, Math.floor(sessionAbsoluteTtlMs / 1000));
}

/** Apaga o cookie: mesmo nome, mesmo escopo, `Max-Age=0`. */
export function buildClearedSessionCookie(): string {
  return serialize("", 0);
}

function serialize(value: string, maxAgeSeconds: number): string {
  const attributes = [
    `${env.SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (env.SESSION_COOKIE_DOMAIN) {
    attributes.push(`Domain=${env.SESSION_COOKIE_DOMAIN}`);
  }

  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

/**
 * Segredo da sessão que está fazendo esta requisição, venha ele do cookie ou
 * do header. Mesma precedência do `AuthMiddleware`: header primeiro.
 *
 * Existe para os casos em que o controller precisa da credencial em si, e não
 * só de quem ela representa — encerrar a própria sessão no logout, e poupá-la
 * na troca de senha.
 */
export function readSessionSecret(
  request: ControllerRequest
): string | undefined {
  const header = request.headers["authorization"];

  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice("Bearer ".length).trim();

    if (bearer) {
      return bearer;
    }
  }

  return request.cookies[env.SESSION_COOKIE_NAME];
}

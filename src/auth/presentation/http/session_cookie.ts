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
/**
 * Em ambiente publicado o nome ganha o prefixo `__Secure-`, que o navegador
 * só aceita de origem https e com `Secure`. Sem ele, com o cookie em
 * `.sogio.app`, qualquer subdomínio — inclusive um servido em http, ou
 * tomado por XSS — poderia sobrescrever a sessão e fixar a da vítima na
 * conta do atacante. `__Host-` seria melhor ainda, mas proíbe `Domain`, e o
 * apex e o `www` precisam compartilhar a sessão.
 *
 * O front deriva o mesmo nome; as duas pontas têm de concordar.
 */
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

/** Apaga o cookie: mesmo nome, mesmo escopo, `Max-Age=0`. */
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

/**
 * Segredo da sessão que está fazendo esta requisição.
 *
 * Lê o que o adapter já resolveu, em vez de reparsear header e cookie: a
 * decisão de aceitar cookie depende da política de CORS da rota, e só o
 * adapter a conhece. Reparsear aqui reintroduziria essa decisão no
 * controller, que é justamente o que a invariante 5 proíbe.
 *
 * Existe para os casos em que o controller precisa da credencial em si, e não
 * só de quem ela representa — encerrar a própria sessão no logout, e poupá-la
 * na troca de senha.
 */
export function readSessionSecret(
  request: ControllerRequest
): string | undefined {
  return request.sessionCredential?.secret;
}

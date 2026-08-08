import type { User } from "../../domain/entity/user";

/**
 * Solicitante — quem de fato chama o `/mcp`: um usuário **através de** um
 * aplicativo, com o escopo concedido pelo Consentimento sob o qual a
 * credencial foi emitida. Não é `User` sozinho (Linguagem Ubíqua do plano
 * de autorização OAuth do MCP, questionamento 16): o transporte ganha a
 * identidade do aplicativo para log e auditoria, algo que o JWT de sessão,
 * por definição, nunca poderia fornecer. As tools continuam recebendo só
 * `User` — é o transporte (`src/core/infra/mcp/routes.ts`) que lê o
 * `Requester` inteiro.
 */
export type Requester = {
  user: User;
  appRegistrationId: string;
  scope: string;
};

/**
 * Abstração de verificação de credencial exposta pelo BC Auth. O `/mcp`
 * (`src/core/infra/mcp`) depende só disto — nunca de OAuth ou de JWT
 * diretamente (Decisão Arquitetural 2) — e tem, hoje, uma única
 * implementação: `OAuthCredentialVerifier`
 * (`src/auth/infra/service/oauth_credential_verifier.ts`). `verify` recusa
 * lançando `UnauthorizedError` quando a credencial não existe, expirou, foi
 * revogada (individualmente, por família, ou por cascata do Consentimento —
 * invariante 5) ou foi emitida para uma audiência que não é o `/mcp`
 * (RFC 8707 / Decisão Arquitetural 9). Nunca distingue esses motivos na
 * exceção lançada: um só formato de rejeição, para não abrir oráculo sobre
 * por que uma credencial específica falhou (risco crítico 4, mesmo
 * raciocínio já aplicado a `/token`).
 */
export interface CredentialVerifier {
  verify(accessToken: string): Promise<Requester>;
}

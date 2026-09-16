import jwt from "jsonwebtoken";
import { env } from "../../../core/infra/config/environments";

/**
 * TEMPORÁRIO — remover uma release depois do deploy da sessão em cookie.
 *
 * Até esta mudança, a sessão do app era um JWT de 1 dia guardado no
 * `localStorage` do front. No deploy, todo mundo que estava logado tem um
 * desses na mão. Aceitá-lo por mais um dia é o que evita deslogar a base
 * inteira de uma vez; como o próprio JWT expira em 24h, no dia seguinte esta
 * classe não aceita mais nada e pode ser apagada junto com `JWT_SECRET` e a
 * dependência `jsonwebtoken`.
 *
 * Só vale para credencial vinda do header `Authorization`: cookie é coisa do
 * mundo novo, e o JWT antigo nunca viajou em um.
 */
export type LegacySession = {
  userId: string;
  /** Momento da emissão, para recusar token anterior à troca de senha. */
  issuedAt: Date;
};

export class LegacyJwtSessionVerifier {
  /**
   * Fechada por padrão: sem `LEGACY_JWT_ACCEPTED_UNTIL` no ambiente, nenhum
   * JWT é aceito. É o que impede a janela de compatibilidade de sobreviver
   * ao esquecimento — hoje a única barreira seria o `exp` do token, e uma
   * `JWT_SECRET` vazada no passado voltaria a valer para sempre.
   */
  verify(token: string): LegacySession | null {
    const acceptedUntil = env.LEGACY_JWT_ACCEPTED_UNTIL;

    if (!acceptedUntil || Date.now() > acceptedUntil.getTime()) {
      return null;
    }

    try {
      // `algorithms` fixo: o segredo é simétrico, e aceitar qualquer
      // algoritmo é a porta da confusão de algoritmo.
      const decoded = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      if (
        typeof decoded !== "object" ||
        !("userId" in decoded) ||
        typeof decoded.userId !== "string" ||
        typeof decoded.iat !== "number"
      ) {
        return null;
      }

      return { userId: decoded.userId, issuedAt: new Date(decoded.iat * 1000) };
    } catch {
      return null;
    }
  }
}

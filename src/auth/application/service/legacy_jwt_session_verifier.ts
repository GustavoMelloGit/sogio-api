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
export class LegacyJwtSessionVerifier {
  verify(token: string): { userId: string } | null {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET);

      if (
        typeof decoded !== "object" ||
        !("userId" in decoded) ||
        typeof decoded.userId !== "string"
      ) {
        return null;
      }

      return { userId: decoded.userId };
    } catch {
      return null;
    }
  }
}

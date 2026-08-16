import type { EmailMessage } from "../../../core/application/email/email_service";

const RESET_PASSWORD_FRONT_PATH = "/reset-password";

/**
 * Monta o email de recuperação de senha — conteúdo é linguagem de negócio de
 * Auth, por isso vive aqui e não em `core` (D6/§2.8 do plano). O token vai no
 * link do front, nunca em texto avulso — é o próprio front que o extrai e o
 * envia no corpo da chamada à API que consome o token (R9).
 */
export function composePasswordResetEmail(
  frontBaseUrl: string,
  email: string,
  token: string
): EmailMessage {
  const resetLink = `${frontBaseUrl}${RESET_PASSWORD_FRONT_PATH}?token=${encodeURIComponent(token)}`;

  return {
    to: email,
    subject: "Redefinição de senha - Sogio",
    body: [
      "Recebemos uma solicitação para redefinir a senha da sua conta Sogio.",
      "",
      `Para continuar, acesse: ${resetLink}`,
      "",
      "Se você não solicitou isso, ignore este email — sua senha continua a mesma. O link expira em breve.",
    ].join("\n"),
  };
}

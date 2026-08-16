import type { EmailMessage } from "../../../core/application/email/email_service";
import { escapeHtml } from "../../../core/infra/http/utils/escape_html";

const RESET_PASSWORD_FRONT_PATH = "/reset-password";

function renderHtml(params: {
  name: string;
  email: string;
  resetLink: string;
  expiryMinutes: number;
}): string {
  const name = escapeHtml(params.name);
  const email = escapeHtml(params.email);
  const resetLink = escapeHtml(params.resetLink);
  const expiryMinutes = params.expiryMinutes;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Redefinir senha</title>
<!--[if mso]>
<style type="text/css">
  body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<style type="text/css">
  @media only screen and (max-width: 620px) {
    .wrap { width: 100% !important; }
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 26px !important; line-height: 32px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#eceae4;">
<span style="display:none; visibility:hidden; opacity:0; color:transparent; height:0; width:0; max-height:0; max-width:0; overflow:hidden; mso-hide:all;">Redefina sua senha do Sogio com o link seguro deste email — ele expira em ${expiryMinutes} minutos.</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#eceae4;">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px; max-width:600px; background-color:#fbfaf7; border:1px solid #ddd9d0; border-radius:6px;">

        <tr>
          <td class="pad" style="padding:28px 40px 24px 40px; border-bottom:1px solid #e6e2d9;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="left" style="font-family:Georgia, 'Times New Roman', serif; font-size:19px; line-height:24px; mso-line-height-rule:exactly; letter-spacing:0.5px; color:#1f2420; font-weight:bold;">Sogio</td>
                <td align="right" style="font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:24px; mso-line-height-rule:exactly; letter-spacing:1.5px; text-transform:uppercase; color:#7b7768;">Segurança da conta</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="pad" style="padding:44px 40px 0 40px;">
            <h1 class="h1" style="margin:0 0 18px 0; font-family:Georgia, 'Times New Roman', serif; font-size:31px; line-height:38px; mso-line-height-rule:exactly; font-weight:normal; color:#1f2420;">Esqueceu sua senha?</h1>
            <p style="margin:0 0 16px 0; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#4a4c44;">Olá, ${name} — recebemos uma solicitação para redefinir a senha da conta associada a <span style="color:#1f2420; font-weight:bold;">${email}</span>. Escolha uma nova senha usando o botão abaixo.</p>
            <p style="margin:0 0 32px 0; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#4a4c44;">Este link funciona uma única vez e expira ${expiryMinutes} minutos após a solicitação.</p>
          </td>
        </tr>

        <tr>
          <td class="pad" align="left" style="padding:0 40px 32px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#2EAE9F" style="border-radius:4px;">
                  <a href="${resetLink}" style="display:block; padding:15px 34px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#fbfaf7; text-decoration:none; border-radius:4px; background-color:#2EAE9F;">Definir nova senha</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="pad" style="padding:0 40px 36px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f2efe8; border:1px solid #e6e2d9; border-radius:4px;">
              <tr>
                <td style="padding:18px 20px;">
                  <p style="margin:0 0 8px 0; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:18px; mso-line-height-rule:exactly; letter-spacing:1px; text-transform:uppercase; color:#7b7768;">O botão não está funcionando?</p>
                  <p style="margin:0; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:21px; mso-line-height-rule:exactly; color:#4a4c44; word-break:break-all;"><a href="${resetLink}" style="color:#2f5d4a; text-decoration:underline;">${resetLink}</a></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td class="pad" style="padding:0 40px 44px 40px; border-top:1px solid #e6e2d9;">
            <p style="margin:28px 0 0 0; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:23px; mso-line-height-rule:exactly; color:#6c6e64;">Não foi você quem pediu isso? Pode ignorar este email com segurança — sua senha continua a mesma. Se precisar de ajuda, responda esta mensagem ou escreva para <a href="mailto:contact@sogio.app" style="color:#2f5d4a; text-decoration:underline;">contact@sogio.app</a>.</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Monta o email de recuperação de senha — conteúdo é linguagem de negócio de
 * Auth, por isso vive aqui e não em `core` (D6/§2.8 do plano). O token vai no
 * link do front, nunca em texto avulso — é o próprio front que o extrai e o
 * envia no corpo da chamada à API que consome o token (R9).
 *
 * `name`/`email` são interpolados no HTML via `escapeHtml` — `name` é texto
 * livre do usuário (até 100 caracteres, sem restrição de caracteres) e não
 * pode quebrar a marcação nem sequestrar o link do botão.
 */
export function composePasswordResetEmail(
  frontBaseUrl: string,
  name: string,
  email: string,
  token: string,
  requestTtlMs: number
): EmailMessage {
  const resetLink = `${frontBaseUrl}${RESET_PASSWORD_FRONT_PATH}?token=${encodeURIComponent(token)}`;
  const expiryMinutes = Math.round(requestTtlMs / 60_000);

  return {
    to: email,
    subject: "Redefinição de senha - Sogio",
    text: [
      `Olá, ${name},`,
      "",
      "Recebemos uma solicitação para redefinir a senha da sua conta Sogio.",
      "",
      `Para continuar, acesse: ${resetLink}`,
      "",
      `Este link funciona uma única vez e expira ${expiryMinutes} minutos após a solicitação.`,
      "",
      "Se você não solicitou isso, ignore este email — sua senha continua a mesma.",
    ].join("\n"),
    html: renderHtml({ name, email, resetLink, expiryMinutes }),
  };
}

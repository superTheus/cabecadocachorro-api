import { readFileSync } from 'node:fs';

const logo = readFileSync(new URL('./assets/logo-verde.png', import.meta.url));

/** Table layout and inline styles keep the message usable in mail clients. */
export function confirmationEmail(escapedName: string, escapedLink: string) {
  return {
    attachments: [
      {
        filename: 'cabeca-do-cachorro.png',
        content: logo,
        contentType: 'image/png',
        cid: 'cabeca-logo',
        contentDisposition: 'inline' as const,
      },
    ],
    html: `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Bem-vindo à matilha</title></head>
<body style="margin:0;padding:0;background-color:#f3f0e7;font-family:Arial,Helvetica,sans-serif;color:#164b39;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">Sua conta na Cabeça do Cachorro está quase pronta. Confirme seu e-mail e venha fazer parte da matilha.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f0e7"><tr><td align="center" style="padding:28px 12px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #006843">
<tr><td style="padding:26px 28px;background-color:#ffbf16;border-bottom:2px solid #006843"><img src="cid:cabeca-logo" width="190" alt="Cabeça do Cachorro" style="display:block;width:190px;max-width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:36px 28px 34px;background-color:#005b3e">
<p style="margin:0 0 16px;color:#ffce45;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">TEM GENTE NOVA NA MATILHA</p>
<h1 style="margin:0;color:#ffffff;font-size:38px;line-height:43px;letter-spacing:-1px;font-weight:800">Bem-vindo à<br><span style="color:#ffce45">matilha.</span></h1>
<p style="margin:20px 0 0;color:#e2eee6;font-size:16px;line-height:25px">Sua conta está quase pronta.<br>Falta só um passo para começar.</p>
</td></tr>
<tr><td style="padding:32px 28px 28px">
<p style="margin:0 0 14px;font-size:19px;line-height:27px;font-weight:bold">Olá, ${escapedName}!</p>
<p style="margin:0 0 25px;font-size:16px;line-height:26px;color:#465c51">Que bom ter você por aqui. Confirme seu e-mail para ativar sua conta na <strong style="color:#005b3e">Cabeça do Cachorro</strong> e explorar a nossa coleção.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" bgcolor="#ffbf16" style="border:1px solid #006843;border-bottom:4px solid #006843">
<a href="${escapedLink}" style="display:block;padding:19px 12px;font-size:14px;line-height:20px;letter-spacing:0.6px;font-weight:bold;color:#005b3e;text-align:center;text-decoration:none;mso-padding-alt:0"><!--[if mso]><i style="mso-font-width:200%;mso-text-raise:28pt" hidden>&emsp;</i><span style="mso-text-raise:14pt"><![endif]-->CONFIRMAR MEU E-MAIL &rarr;<!--[if mso]></span><i style="mso-font-width:200%" hidden>&emsp;&#8203;</i><![endif]--></a>
</td></tr></table>
<p style="margin:15px 0 28px;font-size:12px;line-height:19px;color:#65766c;text-align:center">Link de uso único, válido por 24 horas.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6ef;border-left:3px solid #00834c"><tr><td style="padding:18px 20px">
<p style="margin:0 0 6px;font-size:13px;line-height:20px;font-weight:bold;color:#005b3e">E depois?</p>
<p style="margin:0;font-size:14px;line-height:23px;color:#465c51">É só voltar ao site e entrar com seu e-mail e senha. A gente te encontra por lá.</p>
</td></tr></table>
<p style="margin:27px 0 8px;font-size:12px;line-height:19px;color:#65766c">O botão não abriu? Copie e cole este link no navegador:</p>
<p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere"><a href="${escapedLink}" style="color:#006843;text-decoration:underline;word-break:break-all">${escapedLink}</a></p>
</td></tr>
<tr><td style="padding:22px 28px;background-color:#f6f6ef;border-top:1px solid #e3e6db">
<p style="margin:0 0 7px;font-size:12px;line-height:20px;font-weight:bold;color:#005b3e">CABEÇA DO CACHORRO</p>
<p style="margin:0;font-size:12px;line-height:20px;color:#65766c">Se você não criou esta conta, pode ignorar este e-mail. Nenhuma ação é necessária.</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="margin:18px 0 0;font-size:11px;line-height:18px;color:#718075">Este e-mail faz parte da criação da sua conta.</p>
</td></tr></table></body></html>`,
  };
}

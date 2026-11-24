import { createTransport } from 'nodemailer';
import type { AppConfig } from '../config/app-config.js';
import { confirmationEmail } from './confirmation-email.js';

export type AccountMail = {
  model: string;
  recipient: string;
  name: string;
  token: string;
  expires_at: string;
};
export interface AccountMailSender {
  send(message: AccountMail, eventId: string): Promise<void>;
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );

export function accountMessage(config: AppConfig, message: AccountMail) {
  if (
    !['conta_confirmacao', 'conta_recuperacao'].includes(message.model) ||
    !/^[A-Za-z0-9_-]{43}$/.test(message.token)
  )
    throw new Error('Mensagem de conta inválida.');
  const verify = message.model === 'conta_confirmacao';
  const action = verify ? 'Confirmar e-mail' : 'Redefinir senha';
  const intro = verify
    ? 'Confirme seu e-mail para acessar sua conta.'
    : 'Recebemos uma solicitação para redefinir sua senha.';
  const link = `${config.store.url}/#conta/${verify ? 'confirmar' : 'recuperar'}?token=${message.token}`;
  const expiry = verify ? '24 horas' : '30 minutos';
  const text = `Olá, ${message.name}!\n\n${intro}\n\n${action}: ${link}\n\nO link expira em ${expiry}. Se não solicitou, ignore esta mensagem.\n\nCabeça do Cachorro`;
  const html = `<div style="font-family:Arial,sans-serif;color:#174c38;max-width:560px;margin:auto;padding:32px"><h2>Cabeça do Cachorro</h2><p>Olá, ${escape(message.name)}!</p><p>${intro}</p><p style="margin:28px 0"><a href="${escape(link)}" style="background:#00824b;color:white;padding:14px 22px;text-decoration:none;border-radius:6px">${action}</a></p><p>O link expira em ${expiry}. Se não solicitou, ignore esta mensagem.</p></div>`;
  return {
    subject: `${action} · Cabeça do Cachorro`,
    text,
    ...(verify
      ? confirmationEmail(escape(message.name), escape(link))
      : { html }),
  };
}

export class SmtpAccountMailSender implements AccountMailSender {
  constructor(private readonly config: AppConfig) {}

  async send(message: AccountMail, eventId: string): Promise<void> {
    if (!this.config.mailConfigured)
      throw new Error('Configure o SMTP da loja.');
    if (!/^[a-f0-9-]{36}$/.test(eventId)) throw new Error('Evento inválido.');
    const mail = this.config.mail;
    const transport = createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.encryption === 'ssl',
      requireTLS: mail.encryption === 'tls',
      auth: { user: mail.username!, pass: mail.password! },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.sendMail({
        from: { name: mail.fromName, address: mail.fromAddress! },
        to: { name: message.name, address: message.recipient },
        messageId: `<${eventId}@${mail.fromAddress!.split('@')[1]}>`,
        ...accountMessage(this.config, message),
      });
    } finally {
      transport.close();
    }
  }
}

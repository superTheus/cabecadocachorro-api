import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app-config.js';
import { unseal, digest } from './auth.crypto.js';
import { SmtpAccountMailSender } from './auth-mail.transport.js';
import type { AccountMailSender } from './auth-mail.transport.js';
type Mail = {
  model: string;
  recipient: string;
  name: string;
  token: string;
  expires_at: string;
};
type Job = {
  id: string;
  payload_cipher: string;
  attempts: number;
  lease: string;
  expires_at: Date;
};
export class AuthMailWorker {
  constructor(
    private db: DataSource,
    private config: AppConfig,
    private sender: AccountMailSender = new SmtpAccountMailSender(config),
  ) {}
  async runOne(): Promise<boolean> {
    if (!this.config.auth.enabled || !this.config.auth.key)
      throw new Error('Habilite o módulo de conta.');
    if (!this.config.mailConfigured)
      throw new Error('Configure o SMTP da loja.');
    const job = await this.db.transaction(async (m) => {
      await m.query(
        "UPDATE customer_mail_outbox SET state='PENDING',lease=NULL,lease_until=NULL WHERE store_id=? AND state='SENDING' AND lease_until<UTC_TIMESTAMP(6) LIMIT 100",
        [this.config.store.id],
      );
      const rows = await m.query<Job[]>(
        "SELECT * FROM customer_mail_outbox WHERE store_id=? AND state='PENDING' AND next_at<=UTC_TIMESTAMP(6) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [this.config.store.id],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      row.lease = randomBytes(32).toString('hex');
      row.attempts++;
      await m.query(
        "UPDATE customer_mail_outbox SET state='SENDING',attempts=?,lease=?,lease_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE id=?",
        [row.attempts, row.lease, row.id],
      );
      return row;
    });
    if (!job) return false;
    let state = 'PENDING';
    try {
      const payload = unseal(
        job.payload_cipher,
        this.config.auth.key,
        this.config.store.id,
      ) as Mail;
      const valid = await this.db.query(
        'SELECT token_hash FROM customer_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(6)',
        [digest(payload.token)],
      );
      if (new Date(job.expires_at).getTime() <= Date.now() || !valid.length)
        state = 'EXPIRED';
      else {
        await this.sender.send(payload, job.id);
        state = 'SENT';
      }
    } catch {
      if (job.attempts >= 10) state = 'FAILED';
    }
    const delay = Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7));
    await this.db.query(
      `UPDATE customer_mail_outbox SET state=?,payload_cipher=IF(?='PENDING',payload_cipher,''),next_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ${delay} SECOND),lease=NULL,lease_until=NULL,last_error=? WHERE id=? AND lease=?`,
      [
        state,
        state,
        state === 'PENDING' || state === 'FAILED'
          ? 'Não foi possível enviar pelo SMTP da loja.'
          : null,
        job.id,
        job.lease,
      ],
    );
    return true;
  }
}

/* Control characters are intentionally forbidden in account input. */
/* eslint-disable no-control-regex */
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { randomUUID, createHmac } from 'node:crypto';
import type { EntityManager, DataSource } from 'typeorm';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import {
  digest,
  passwordHash,
  passwordMatches,
  seal,
  token,
} from './auth.crypto.js';

type Customer = {
  id: string;
  store_id: string;
  email: string;
  name: string;
  password_hash: string;
  verified_at: Date | null;
};
type ActionToken = { customer_id: string; token_hash: string; purpose: string };
export const genericMessage = {
  message: 'Se os dados permitirem, você receberá as instruções no seu e-mail.',
};
export function input(body: unknown, fields: string[]): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException();
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((k) => typeof value[k] !== 'string')
  )
    throw new BadRequestException();
  return value as Record<string, string>;
}
export function emailInput(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    )
  )
    throw new BadRequestException();
  return email;
}
export function checkPassword(value: string): void {
  if (
    value.length < 12 ||
    Buffer.byteLength(value) > 256 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new BadRequestException();
}
@Injectable()
export class AuthService {
  constructor(
    @Inject(AppConfig) readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  get db(): DataSource {
    if (!this.config.auth.enabled || !this.database.connection?.isInitialized)
      throw new ServiceUnavailableException();
    return this.database.connection;
  }
  profile(customer: Customer) {
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      email_verified: !!customer.verified_at,
    };
  }
  async rate(ip: string, email?: string): Promise<void> {
    void this.db;
    for (const [value, window, max] of [
      [`ip:${ip}`, 60, 30],
      ...(email ? [[`email:${email}`, 900, 8]] : []),
    ] as [string, number, number][]) {
      const bucket = createHmac(
        'sha256',
        Buffer.from(this.config.auth.key!, 'base64'),
      )
        .update(this.config.store.id + ':' + value)
        .digest('hex');
      const slot = Math.floor(Date.now() / 1000 / window);
      await this.db.query(
        'INSERT INTO customer_rate_limits(bucket,window_id,attempts,expires_at) VALUES(?,?,1,?) ON DUPLICATE KEY UPDATE attempts=attempts+1',
        [bucket, slot, (slot + 1) * window],
      );
      const rows = await this.db.query<{ attempts: number }[]>(
        'SELECT attempts FROM customer_rate_limits WHERE bucket=? AND window_id=?',
        [bucket, slot],
      );
      if (rows[0].attempts > max)
        throw new HttpException('Limite de solicitações atingido.', 429);
    }
    // Counters are short lived and contain only keyed fingerprints.
    await this.db.query(
      'DELETE FROM customer_rate_limits WHERE expires_at<UNIX_TIMESTAMP() LIMIT 100',
      [],
    );
  }
  private async byEmail(email: string): Promise<Customer | undefined> {
    const rows = await this.db.query<Customer[]>(
      'SELECT * FROM customers WHERE store_id=? AND email=?',
      [this.config.store.id, email],
    );
    return rows[0];
  }
  private async lock(m: EntityManager, id: string): Promise<Customer> {
    const rows = await m.query<Customer[]>(
      'SELECT * FROM customers WHERE id=? AND store_id=? FOR UPDATE',
      [id, this.config.store.id],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }
  private async issue(
    m: EntityManager,
    customer: Customer,
    purpose: 'verify' | 'reset',
  ): Promise<void> {
    await m.query(
      'UPDATE customer_tokens SET used_at=UTC_TIMESTAMP(6) WHERE customer_id=? AND purpose=? AND used_at IS NULL',
      [customer.id, purpose],
    );
    const raw = token(),
      expires = new Date(
        Date.now() + (purpose === 'verify' ? 86400 : 1800) * 1000,
      );
    await m.query(
      'INSERT INTO customer_tokens(token_hash,customer_id,purpose,expires_at) VALUES(?,?,?,?)',
      [digest(raw), customer.id, purpose, expires],
    );
    const payload = {
      model: purpose === 'verify' ? 'conta_confirmacao' : 'conta_recuperacao',
      recipient: customer.email,
      name: customer.name,
      token: raw,
      expires_at: expires.toISOString(),
    };
    await m.query(
      'INSERT INTO customer_mail_outbox(id,store_id,payload_cipher,expires_at,next_at,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))',
      [
        randomUUID(),
        this.config.store.id,
        seal(payload, this.config.auth.key!, this.config.store.id),
        expires,
      ],
    );
  }
  async register(body: unknown, ip: string) {
    const data = input(body, ['name', 'email', 'password']),
      email = emailInput(data.email);
    if (
      !data.name.trim() ||
      data.name.trim().length > 150 ||
      /[\x00-\x1f\x7f]/.test(data.name)
    )
      throw new BadRequestException();
    checkPassword(data.password);
    await this.rate(ip, email);
    const hash = await passwordHash(data.password);
    await this.db.transaction(async (m) => {
      // Unique email closes concurrent registrations; a duplicate never changes the existing password.
      const id = randomUUID();
      await m.query(
        'INSERT INTO customers(id,store_id,email,name,password_hash,created_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE id=id',
        [id, this.config.store.id, email, data.name.trim(), hash],
      );
      const rows = await m.query<Customer[]>(
        'SELECT * FROM customers WHERE store_id=? AND email=? FOR UPDATE',
        [this.config.store.id, email],
      );
      if (rows[0].id === id) await this.issue(m, rows[0], 'verify');
    });
    return genericMessage;
  }
  async sendAction(body: unknown, ip: string, purpose: 'verify' | 'reset') {
    const email = emailInput(input(body, ['email']).email);
    await this.rate(ip, email);
    const found = await this.byEmail(email);
    if (found)
      await this.db.transaction(async (m) => {
        const user = await this.lock(m, found.id);
        if (purpose === 'reset' || !user.verified_at)
          await this.issue(m, user, purpose);
      });
    return genericMessage;
  }
  async login(body: unknown, ip: string) {
    const data = input(body, ['email', 'password']),
      email = emailInput(data.email);
    if (data.password.length > 256) throw new BadRequestException();
    await this.rate(ip, email);
    const found = await this.byEmail(email),
      matches = await passwordMatches(
        data.password,
        found?.password_hash || '',
      );
    if (!found || !matches || !found.verified_at)
      throw new UnauthorizedException();
    return this.db.transaction(async (m) => {
      const user = await this.lock(m, found.id);
      if (user.password_hash !== found.password_hash || !user.verified_at)
        throw new UnauthorizedException();
      const raw = token();
      await m.query(
        'INSERT INTO customer_sessions(token_hash,customer_id,expires_at) VALUES(?,?,?)',
        [digest(raw), user.id, new Date(Date.now() + 7 * 86400 * 1000)],
      );
      return { session: raw, user: this.profile(user) };
    });
  }
  async me(session: string): Promise<Customer> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new UnauthorizedException();
    const rows = await this.db.query<Customer[]>(
      'SELECT c.* FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=? AND c.store_id=? AND s.expires_at>UTC_TIMESTAMP(6) AND c.verified_at IS NOT NULL',
      [digest(session), this.config.store.id],
    );
    if (!rows[0]) throw new UnauthorizedException();
    return rows[0];
  }
  async logout(session: string) {
    await this.db.query(
      'DELETE s FROM customer_sessions s JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=? AND c.store_id=?',
      [digest(session), this.config.store.id],
    );
    return { message: 'Sessão encerrada.' };
  }
  async consume(body: unknown, ip: string, purpose: 'verify' | 'reset') {
    const data = input(
      body,
      purpose === 'verify' ? ['token'] : ['token', 'password'],
    );
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.token))
      throw new BadRequestException();
    if (purpose === 'reset') checkPassword(data.password);
    await this.rate(ip);
    const hash =
      purpose === 'reset' ? await passwordHash(data.password) : undefined;
    const rows = await this.db.query<ActionToken[]>(
      'SELECT t.customer_id,t.token_hash,t.purpose FROM customer_tokens t JOIN customers c ON c.id=t.customer_id WHERE t.token_hash=? AND t.purpose=? AND c.store_id=?',
      [digest(data.token), purpose, this.config.store.id],
    );
    if (!rows[0]) throw new BadRequestException();
    await this.db.transaction(async (m) => {
      const user = await this.lock(m, rows[0].customer_id);
      const valid = await m.query<ActionToken[]>(
        'SELECT * FROM customer_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE',
        [rows[0].token_hash, purpose],
      );
      if (!valid[0]) throw new BadRequestException();
      if (purpose === 'verify')
        await m.query(
          'UPDATE customers SET verified_at=COALESCE(verified_at,UTC_TIMESTAMP(6)) WHERE id=?',
          [user.id],
        );
      else {
        await m.query(
          'UPDATE customers SET password_hash=?,verified_at=COALESCE(verified_at,UTC_TIMESTAMP(6)) WHERE id=?',
          [hash, user.id],
        );
        await m.query('DELETE FROM customer_sessions WHERE customer_id=?', [
          user.id,
        ]);
      }
      await m.query(
        "UPDATE customer_tokens SET used_at=UTC_TIMESTAMP(6) WHERE customer_id=? AND (purpose=? OR ?='reset') AND used_at IS NULL",
        [user.id, purpose, purpose],
      );
    });
    return {
      message:
        purpose === 'verify'
          ? 'E-mail confirmado. Entre na sua conta.'
          : 'Senha atualizada. Entre novamente.',
    };
  }
  async changePassword(session: string, body: unknown, ip: string) {
    const data = input(body, ['current_password', 'password']);
    checkPassword(data.password);
    if (data.current_password.length > 256) throw new BadRequestException();
    await this.rate(ip);
    const found = await this.me(session);
    if (!(await passwordMatches(data.current_password, found.password_hash)))
      throw new UnauthorizedException();
    const hash = await passwordHash(data.password);
    await this.db.transaction(async (m) => {
      const user = await this.lock(m, found.id);
      if (user.password_hash !== found.password_hash)
        throw new UnauthorizedException();
      const sessions = await m.query(
        'SELECT token_hash FROM customer_sessions WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP(6)',
        [digest(session), user.id],
      );
      if (!sessions.length) throw new UnauthorizedException();
      await m.query('UPDATE customers SET password_hash=? WHERE id=?', [
        hash,
        user.id,
      ]);
      await m.query('DELETE FROM customer_sessions WHERE customer_id=?', [
        user.id,
      ]);
      await m.query(
        'UPDATE customer_tokens SET used_at=UTC_TIMESTAMP(6) WHERE customer_id=? AND used_at IS NULL',
        [user.id],
      );
    });
    return { message: 'Senha atualizada. Entre novamente.' };
  }
}

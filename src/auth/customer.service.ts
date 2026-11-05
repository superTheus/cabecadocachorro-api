/* eslint-disable no-control-regex */
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AuthService, input } from './auth.service.js';
import { digest } from './auth.crypto.js';
const fields = {
  label: 50,
  recipient: 150,
  postal_code: 8,
  street: 150,
  number: 20,
  complement: 100,
  district: 100,
  city: 100,
  state: 2,
};
const columns =
  'id,label,recipient,postal_code,street,number,complement,district,city,state,is_default';
const states = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(
    ' ',
  ),
);
type Address = { id: string; is_default: number | boolean };
@Injectable()
export class CustomerService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private async transaction<T>(
    session: string,
    action: (m: EntityManager, id: string) => Promise<T>,
  ) {
    const customer = await this.auth.me(session);
    return this.auth.db.transaction(async (m) => {
      // Serialize all address writes for a buyer, including first-address and deletion races.
      await m.query(
        'SELECT id FROM customers WHERE id=? AND store_id=? FOR UPDATE',
        [customer.id, this.auth.config.store.id],
      );
      const sessions = await m.query(
        'SELECT token_hash FROM customer_sessions WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP(6)',
        [digest(session), customer.id],
      );
      if (!sessions.length) throw new UnauthorizedException();
      return action(m, customer.id);
    });
  }
  async profile(session: string, body: unknown) {
    const d = input(body, ['name', 'phone']);
    const name = d.name.trim(),
      phone = d.phone.replace(/[ ()-]/g, '');
    if (
      d.phone.length > 25 ||
      !name ||
      name.length > 150 ||
      /[\x00-\x1f\x7f]/.test(d.name) ||
      (phone !== '' && !/^\+?[0-9]{10,15}$/.test(phone))
    )
      throw new BadRequestException();
    await this.transaction(session, async (m, id) => {
      await m.query('UPDATE customers SET name=?,phone=? WHERE id=?', [
        name,
        phone,
        id,
      ]);
    });
    return this.auth.profile(await this.auth.me(session));
  }
  async list(session: string) {
    const user = await this.auth.me(session);
    return this.auth.db.query(
      'SELECT ' +
        columns +
        ' FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,created_at,id',
      [user.id],
    );
  }
  private data(body: unknown) {
    const d = input(body, Object.keys(fields));
    for (const [key, max] of Object.entries(fields)) {
      if (/[\x00-\x1f\x7f]/.test(d[key])) throw new BadRequestException();
      d[key] = d[key].trim();
      if (
        d[key].length > max ||
        /[\x00-\x1f\x7f]/.test(d[key]) ||
        (!d[key] && !['label', 'complement'].includes(key))
      )
        throw new BadRequestException();
    }
    if (!/^[0-9]{8}$/.test(d.postal_code) || !states.has(d.state))
      throw new BadRequestException();
    return d;
  }
  private async address(
    m: EntityManager,
    customer: string,
    id: string,
  ): Promise<Address> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new NotFoundException();
    const rows = await m.query<Address[]>(
      'SELECT id,is_default FROM customer_addresses WHERE id=? AND customer_id=?',
      [id, customer],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
  async save(session: string, body: unknown, id?: string) {
    const d = this.data(body);
    return this.transaction(session, async (m, customer) => {
      if (id) {
        await this.address(m, customer, id);
        await m.query(
          'UPDATE customer_addresses SET ' +
            Object.keys(fields)
              .map((k) => k + '=?')
              .join(',') +
            ' WHERE id=? AND customer_id=?',
          [...Object.keys(fields).map((k) => d[k]), id, customer],
        );
      } else {
        const rows = await m.query<Address[]>(
          'SELECT id,is_default FROM customer_addresses WHERE customer_id=?',
          [customer],
        );
        if (rows.length >= 20)
          throw new ConflictException('Limite de 20 endereços.');
        id = randomUUID();
        await m.query(
          'INSERT INTO customer_addresses(id,customer_id,' +
            Object.keys(fields).join(',') +
            ',is_default) VALUES(' +
            Array(12).fill('?').join(',') +
            ')',
          [
            id,
            customer,
            ...Object.keys(fields).map((k) => d[k]),
            rows.length === 0,
          ],
        );
      }
      const rows = await m.query(
        'SELECT ' +
          columns +
          ' FROM customer_addresses WHERE id=? AND customer_id=?',
        [id, customer],
      );
      return rows[0];
    });
  }
  async setDefault(session: string, id: string, body: unknown) {
    input(body, []);
    return this.transaction(session, async (m, customer) => {
      await this.address(m, customer, id);
      await m.query(
        'UPDATE customer_addresses SET is_default=FALSE WHERE customer_id=? AND is_default=TRUE',
        [customer],
      );
      await m.query(
        'UPDATE customer_addresses SET is_default=TRUE WHERE id=? AND customer_id=?',
        [id, customer],
      );
      return { message: 'Endereço padrão atualizado.' };
    });
  }
  async remove(session: string, id: string) {
    return this.transaction(session, async (m, customer) => {
      const address = await this.address(m, customer, id);
      await m.query(
        'DELETE FROM customer_addresses WHERE id=? AND customer_id=?',
        [id, customer],
      );
      if (address.is_default)
        await m.query(
          'UPDATE customer_addresses SET is_default=TRUE WHERE customer_id=? ORDER BY created_at,id LIMIT 1',
          [customer],
        );
      return { message: 'Endereço excluído.' };
    });
  }
}

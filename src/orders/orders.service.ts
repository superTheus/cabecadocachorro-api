import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AuthService } from '../auth/auth.service.js';
import { digest, seal, unseal } from '../auth/auth.crypto.js';
import { DatabaseService } from '../database/database.service.js';
import { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';
import { MuiraSoftError } from '../integrations/muirasoft/muirasoft.error.js';
import { paymentKey } from '../integrations/muirasoft/muirasoft.payments.js';
import { orderRequestInput, type OrderRequestInput } from './orders.domain.js';
type Intent = {
  id: string;
  store_id: string;
  customer_id: string;
  order_id: string;
  idempotency_key: string;
  fingerprint: string;
  payload_cipher: string;
  state: 'PENDING' | 'SENT' | 'REJECTED';
  upstream_id: string | null;
  created_at: Date | string;
};
const orderId = (id: string) => {
  if (!/^[a-f0-9]{32}$/u.test(id)) throw new NotFoundException();
  return id;
};
@Injectable()
export class OrdersService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MuiraSoftClient) private readonly erp: MuiraSoftClient,
  ) {}
  private buyer(id: string) {
    return 'buyer:' + this.auth.config.store.id + ':' + id;
  }
  private purpose(id: string) {
    return 'order-request:' + id;
  }
  private body(row: Intent) {
    return unseal(
      row.payload_cipher,
      this.auth.config.auth.key!,
      this.auth.config.store.id,
      this.purpose(row.id),
    ) as OrderRequestInput;
  }
  private view(row: Intent) {
    return {
      id: row.id,
      delivery: row.state,
      upstream_id: row.upstream_id,
      ...this.body(row),
      created_at:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(
              String(row.created_at).replace(' ', 'T') + 'Z',
            ).toISOString(),
    };
  }
  private async ready() {
    if (
      !this.auth.config.integrationConfigured ||
      !(await this.database.verifyBinding())
    )
      throw new ServiceUnavailableException();
  }
  async list(session: string, q: Record<string, unknown>) {
    if (
      Object.keys(q).some((k) => !['cursor', 'limit'].includes(k)) ||
      (q.cursor !== undefined &&
        (typeof q.cursor !== 'string' || !/^[a-f0-9]{32}$/u.test(q.cursor)))
    )
      throw new BadRequestException();
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (q.limit !== undefined && typeof q.limit !== 'string')
    )
      throw new BadRequestException();
    const c = await this.auth.me(session);
    await this.ready();
    const result = await this.erp.customerOrders(
      this.buyer(c.id),
      q.cursor as string | undefined,
      limit,
    );
    await this.auth.me(session);
    return result;
  }
  async get(session: string, id: string) {
    orderId(id);
    const c = await this.auth.me(session);
    await this.ready();
    const remote = await this.erp.customerOrder(this.buyer(c.id), id);
    const rows = remote.checkout_reference
      ? await this.auth.db.query<{ id: string }[]>(
          'SELECT id FROM checkout_sessions WHERE quote_id=? AND customer_id=? AND store_id=? ORDER BY created_at LIMIT 1',
          [remote.checkout_reference, c.id, this.auth.config.store.id],
        )
      : [];
    const intents = await this.auth.db.query<Intent[]>(
      'SELECT * FROM customer_order_requests WHERE store_id=? AND customer_id=? AND order_id=? ORDER BY created_at,id',
      [this.auth.config.store.id, c.id, id],
    );
    await this.auth.me(session);
    const { checkout_reference: _, ...safe } = remote;
    void _;
    return {
      ...safe,
      checkout_id: rows[0]?.id ?? null,
      pending_requests: intents
        .filter(
          (r) =>
            r.state !== 'SENT' &&
            !remote.requests.some((v) => v.id === r.upstream_id),
        )
        .map((r) => this.view(r)),
    };
  }
  async download(
    session: string,
    id: string,
    document: string,
    format: string,
  ) {
    orderId(id);
    orderId(document);
    if (!['pdf', 'xml'].includes(format)) throw new NotFoundException();
    const c = await this.auth.me(session);
    await this.ready();
    const file = await this.erp.customerFiscalFile(
      this.buyer(c.id),
      id,
      document,
      format as 'pdf' | 'xml',
    );
    await this.auth.me(session);
    return file;
  }
  private async dispatch(row: Intent) {
    if (row.state !== 'PENDING') return row;
    try {
      const r = await this.erp.customerOrderRequest(
        this.buyer(row.customer_id),
        row.order_id,
        this.body(row),
        'customer-request-' + row.id,
      );
      row.state = 'SENT';
      row.upstream_id = r.id;
    } catch (e) {
      if (e instanceof MuiraSoftError && [404, 409, 422].includes(e.status))
        row.state = 'REJECTED';
    }
    await this.auth.db.query(
      "UPDATE customer_order_requests SET state=?,upstream_id=? WHERE id=? AND customer_id=? AND store_id=? AND state='PENDING'",
      [row.state, row.upstream_id, row.id, row.customer_id, row.store_id],
    );
    const saved = await this.auth.db.query<Intent[]>(
      'SELECT * FROM customer_order_requests WHERE id=? AND customer_id=? AND store_id=?',
      [row.id, row.customer_id, row.store_id],
    );
    return saved[0];
  }
  async submit(session: string, id: string, body: unknown, key: string) {
    orderId(id);
    paymentKey(key);
    const payload = orderRequestInput(body),
      c = await this.auth.me(session);
    await this.ready();
    // Leitura comprova vínculo e situação; a gravação ERP revalida tudo sob lock.
    await this.erp.customerOrder(this.buyer(c.id), id);
    const fingerprint = createHmac(
      'sha256',
      Buffer.from(this.auth.config.auth.key!, 'base64'),
    )
      .update(JSON.stringify([id, payload]))
      .digest('hex');
    const intent = await this.auth.db.transaction(async (m) => {
      await m.query(
        'SELECT id FROM customers WHERE id=? AND store_id=? FOR UPDATE',
        [c.id, this.auth.config.store.id],
      );
      const active = await m.query(
        'SELECT token_hash FROM customer_sessions WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE',
        [digest(session), c.id],
      );
      if (!active.length) throw new UnauthorizedException();
      const old = await m.query<Intent[]>(
        'SELECT * FROM customer_order_requests WHERE store_id=? AND customer_id=? AND idempotency_key=?',
        [this.auth.config.store.id, c.id, key],
      );
      if (old[0]) {
        if (old[0].fingerprint !== fingerprint) throw new ConflictException();
        return old[0];
      }
      const counts = await m.query<{ n: string }[]>(
        'SELECT COUNT(*) n FROM customer_order_requests WHERE store_id=? AND customer_id=? AND order_id=?',
        [this.auth.config.store.id, c.id, id],
      );
      if (Number(counts[0].n) >= 20) throw new ConflictException();
      const local = randomUUID(),
        cipher = seal(
          payload,
          this.auth.config.auth.key!,
          this.auth.config.store.id,
          this.purpose(local),
        );
      await m.query(
        'INSERT INTO customer_order_requests(id,store_id,customer_id,order_id,idempotency_key,fingerprint,payload_cipher) VALUES(?,?,?,?,?,?,?)',
        [local, this.auth.config.store.id, c.id, id, key, fingerprint, cipher],
      );
      return {
        id: local,
        store_id: this.auth.config.store.id,
        customer_id: c.id,
        order_id: id,
        idempotency_key: key,
        fingerprint,
        payload_cipher: cipher,
        state: 'PENDING',
        upstream_id: null,
        created_at: new Date(),
      } satisfies Intent;
    });
    return this.view(await this.dispatch(intent));
  }
  async retry(session: string, id: string, intentId: string) {
    orderId(id);
    if (!/^[a-f0-9-]{36}$/u.test(intentId)) throw new NotFoundException();
    const c = await this.auth.me(session);
    await this.ready();
    const rows = await this.auth.db.query<Intent[]>(
      'SELECT * FROM customer_order_requests WHERE id=? AND store_id=? AND customer_id=? AND order_id=?',
      [intentId, this.auth.config.store.id, c.id, id],
    );
    if (!rows[0]) throw new NotFoundException();
    await this.erp.customerOrder(this.buyer(c.id), id);
    await this.auth.me(session);
    return this.view(await this.dispatch(rows[0]));
  }
}

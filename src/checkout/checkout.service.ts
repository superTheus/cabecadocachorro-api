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
import {
  paymentInput,
  paymentKey,
  type PaymentInput,
  type StorePayment,
} from '../integrations/muirasoft/muirasoft.payments.js';
import {
  type CheckoutAddress,
  type CheckoutQuote,
  type CheckoutQuoteInput,
} from '../integrations/muirasoft/muirasoft.checkout.js';
import { cartInput, fields, object } from '../catalog/catalog.domain.js';
type Session = {
  id: string;
  store_id: string;
  customer_id: string;
  payload_cipher: string;
  quote_id: string | null;
  review_cipher: string | null;
  upstream_order_id: string | number | null;
  fingerprint: string;
};
type Intent = {
  id: string;
  checkout_id: string;
  idempotency_key: string;
  method: 'PIX' | 'CREDIT_CARD';
  installments: number;
  upstream_payment_id: string | number | null;
  state: string;
};
const uuid = (id: string) => {
  if (!/^[a-f0-9-]{36}$/u.test(id)) throw new NotFoundException();
  return id;
};
export function documentInput(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^\d{11}$|^\d{14}$/u.test(v) ||
    /^(\d)\1+$/u.test(v)
  )
    throw new BadRequestException();
  for (let i = v.length - 2; i < v.length; i++) {
    let sum = 0;
    for (let j = 0; j < i; j++)
      sum +=
        Number(v[j]) * (v.length === 11 ? i + 1 - j : ((i - 1 - j) % 8) + 2);
    const digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (digit !== Number(v[i])) throw new BadRequestException();
  }
  return v;
}
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MuiraSoftClient) private readonly erp: MuiraSoftClient,
  ) {}
  private buyer(id: string) {
    return 'buyer:' + this.auth.config.store.id + ':' + id;
  }
  private encrypt(id: string, purpose: string, value: unknown) {
    return seal(
      value,
      this.auth.config.auth.key!,
      this.auth.config.store.id,
      'checkout:' + id + ':' + purpose,
    );
  }
  private decrypt<T>(id: string, purpose: string, cipher: string): T {
    return unseal(
      cipher,
      this.auth.config.auth.key!,
      this.auth.config.store.id,
      'checkout:' + id + ':' + purpose,
    ) as T;
  }
  private async ready() {
    if (
      !this.auth.config.integrationConfigured ||
      !(await this.database.verifyBinding())
    )
      throw new ServiceUnavailableException();
  }
  private async owned(session: string, id: string): Promise<Session> {
    uuid(id);
    const c = await this.auth.me(session);
    const rows = await this.auth.db.query<Session[]>(
      'SELECT * FROM checkout_sessions WHERE id=? AND customer_id=? AND store_id=?',
      [id, c.id, this.auth.config.store.id],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
  private async address(
    customer: string,
    id: string,
  ): Promise<CheckoutAddress> {
    uuid(id);
    const rows = await this.auth.db.query<CheckoutAddress[]>(
      'SELECT recipient,postal_code,street,number,complement,district,city,state FROM customer_addresses WHERE id=? AND customer_id=?',
      [id, customer],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }
  async options(session: string, addressId: string) {
    const c = await this.auth.me(session);
    const a = await this.address(c.id, addressId);
    await this.ready();
    return this.erp.checkoutOptions(a.postal_code);
  }
  async prepare(session: string, body: unknown, key: string) {
    paymentKey(key);
    const c = await this.auth.me(session),
      b = object(body);
    fields(b, ['address_id', 'document', 'delivery_type', 'items']);
    if (
      typeof b.address_id !== 'string' ||
      !['RETIRADA', 'ENTREGA'].includes(b.delivery_type as string)
    )
      throw new BadRequestException();
    const document = documentInput(b.document),
      address = await this.address(c.id, b.address_id);
    const rows = cartInput(
      { store_id: this.auth.config.store.id, items: b.items },
      this.auth.config.store.id,
    );
    if (!rows.length || !c.phone || c.name.length > 100 || c.email.length > 100)
      throw new BadRequestException();
    const payload: CheckoutQuoteInput = {
      cliente: {
        referencia_externa: this.buyer(c.id),
        nome: c.name,
        email: c.email,
        documento: document,
        telefone: c.phone,
      },
      endereco: address,
      tipo_entrega: b.delivery_type as 'RETIRADA' | 'ENTREGA',
      itens: rows
        .map((r) => ({
          id_produto: r.sku_id,
          quantidade: r.quantity,
          modalidade: r.fulfillment,
        }))
        .sort(
          (a, b) =>
            a.id_produto - b.id_produto ||
            a.modalidade.localeCompare(b.modalidade),
        ),
    };
    const fingerprint = createHmac(
      'sha256',
      Buffer.from(this.auth.config.auth.key!, 'base64'),
    )
      .update(JSON.stringify(payload))
      .digest('hex');
    await this.ready();
    const id = await this.auth.db.transaction(async (m) => {
      await m.query('SELECT id FROM customers WHERE id=? FOR UPDATE', [c.id]);
      const active = await m.query(
        'SELECT token_hash FROM customer_sessions WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP(6)',
        [digest(session), c.id],
      );
      if (!active.length) throw new UnauthorizedException();
      const previous = await m.query<Session[]>(
        'SELECT * FROM checkout_sessions WHERE store_id=? AND idempotency_key=? FOR UPDATE',
        [this.auth.config.store.id, key],
      );
      if (previous[0]) {
        if (
          previous[0].customer_id !== c.id ||
          previous[0].fingerprint !== fingerprint
        )
          throw new ConflictException();
        return previous[0].id;
      }
      const id = randomUUID();
      await m.query(
        'INSERT INTO checkout_sessions(id,store_id,customer_id,idempotency_key,fingerprint,payload_cipher) VALUES(?,?,?,?,?,?)',
        [
          id,
          this.auth.config.store.id,
          c.id,
          key,
          fingerprint,
          this.encrypt(id, 'request', payload),
        ],
      );
      return id;
    });
    return this.get(session, id);
  }
  private async remote(s: Session): Promise<CheckoutQuote> {
    await this.ready();
    const quote = s.quote_id
      ? await this.erp.getCheckoutQuote(s.quote_id, this.buyer(s.customer_id))
      : await this.erp.createCheckoutQuote(
          this.decrypt<CheckoutQuoteInput>(s.id, 'request', s.payload_cipher),
          'quote-' + s.id,
        );
    if (s.quote_id && s.quote_id !== quote.id)
      throw new ServiceUnavailableException();
    await this.auth.db.query(
      'UPDATE checkout_sessions SET quote_id=?,review_cipher=?,upstream_order_id=? WHERE id=? AND customer_id=?',
      [
        quote.id,
        this.encrypt(s.id, 'review', quote),
        quote.id_pedido,
        s.id,
        s.customer_id,
      ],
    );
    return quote;
  }
  private paymentView(i: Intent, p: StorePayment | null) {
    let status = i.state === 'REVIEW' ? 'REVIEW' : 'PROCESSING';
    if (p) {
      if (p.total_estornado === p.total) status = 'REFUNDED';
      else if (p.estado === 'REVISAO' || p.estado === 'INCERTO')
        status = 'REVIEW';
      else if (p.total_estornado !== '0.00') status = 'PARTIALLY_REFUNDED';
      else if (p.pago_em) status = p.revisao_estoque ? 'PAID_REVIEW' : 'PAID';
      else if (p.estado === 'RECUSADO') status = 'DECLINED';
      else if (p.estado === 'CRIADO') status = 'AWAITING_PAYMENT';
    }
    return {
      id: i.id,
      method: i.method,
      installments: Number(i.installments),
      status,
      paid_at: p?.pago_em ?? null,
      refunded_total: p?.total_estornado ?? '0.00',
    };
  }
  private async payments(s: Session) {
    const intents = await this.auth.db.query<Intent[]>(
      'SELECT * FROM checkout_payment_intents WHERE checkout_id=? ORDER BY created_at DESC,id DESC',
      [s.id],
    );
    const result = [];
    for (const intent of intents) {
      const payments = s.upstream_order_id
        ? await this.erp.listPayments(
            Number(s.upstream_order_id),
            'payment-' + intent.id,
          )
        : [];
      if (payments.length > 1) throw new ServiceUnavailableException();
      const p = payments[0] ?? null;
      if (
        p &&
        (p.metodo !== intent.method ||
          p.parcelas !== Number(intent.installments))
      )
        throw new ServiceUnavailableException();
      if (
        p &&
        s.review_cipher &&
        p.total !==
          this.decrypt<CheckoutQuote>(s.id, 'review', s.review_cipher).revisao
            .total
      )
        throw new ServiceUnavailableException();
      const view = this.paymentView(intent, p);
      await this.auth.db.query(
        'UPDATE checkout_payment_intents SET upstream_payment_id=?,state=? WHERE id=?',
        [p?.id ?? null, view.status, intent.id],
      );
      result.push(view);
    }
    return result;
  }
  async get(session: string, id: string) {
    const s = await this.owned(session, id),
      q = await this.remote(s);
    s.upstream_order_id = q.id_pedido;
    return {
      id: s.id,
      expires_at: q.expira_em,
      ordered: q.id_pedido !== null,
      order_number: q.numero_pedido,
      review: q.revisao,
      payments: await this.payments(s),
    };
  }
  async confirm(session: string, id: string, body: unknown) {
    const b = object(body);
    fields(b, ['accepted']);
    if (b.accepted !== true) throw new BadRequestException();
    const s = await this.owned(session, id),
      q = await this.remote(s);
    if (q.id_pedido === null) {
      await this.erp.confirmCheckoutQuote(q.id, this.buyer(s.customer_id));
    }
    return this.get(session, id);
  }
  async pay(
    session: string,
    id: string,
    body: unknown,
    key: string,
    ip: string,
  ) {
    paymentKey(key);
    const b = object(body);
    fields(b, ['method', 'installments', 'card']);
    const input: PaymentInput = paymentInput(
      b.method === 'PIX'
        ? {
            metodo: 'PIX',
            parcelas: b.installments ?? 1,
            ...(b.card === undefined ? {} : { cartao: b.card }),
          }
        : {
            metodo: b.method,
            parcelas: b.installments ?? 1,
            cartao: b.card,
            ip_comprador: ip,
          },
    );
    const s = await this.owned(session, id);
    await this.ready();
    const q = await this.remote(s);
    if (!q.id_pedido) throw new ConflictException();
    s.upstream_order_id = q.id_pedido;
    // Atualiza a situação existente antes de permitir nova tentativa após recusa explícita.
    await this.payments(s);
    const intent = await this.auth.db.transaction(async (m) => {
      await m.query(
        'SELECT id FROM checkout_sessions WHERE id=? AND customer_id=? FOR UPDATE',
        [id, s.customer_id],
      );
      const sessions = await m.query(
        'SELECT token_hash FROM customer_sessions WHERE token_hash=? AND customer_id=? AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE',
        [digest(session), s.customer_id],
      );
      if (!sessions.length) throw new UnauthorizedException();
      const existing = await m.query<Intent[]>(
        'SELECT * FROM checkout_payment_intents WHERE checkout_id=? AND idempotency_key=?',
        [id, key],
      );
      if (existing[0]) {
        if (
          existing[0].method !== input.metodo ||
          Number(existing[0].installments) !== input.parcelas
        )
          throw new ConflictException();
        return { ...existing[0], fresh: false };
      }
      const attempts = await m.query<Intent[]>(
        'SELECT * FROM checkout_payment_intents WHERE checkout_id=?',
        [id],
      );
      if (attempts.some((i) => i.state !== 'DECLINED') || attempts.length >= 5)
        throw new ConflictException();
      const attempt = randomUUID();
      await m.query(
        'INSERT INTO checkout_payment_intents(id,checkout_id,idempotency_key,method,installments) VALUES(?,?,?,?,?)',
        [attempt, id, key, input.metodo, input.parcelas ?? 1],
      );
      return { id: attempt, fresh: true };
    });
    if (intent.fresh) {
      try {
        const p = await this.erp.createPayment(
          q.id_pedido,
          input,
          'payment-' + intent.id,
        );
        await this.auth.db.query(
          'UPDATE checkout_payment_intents SET upstream_payment_id=?,state=? WHERE id=?',
          [
            p.id,
            p.estado === 'RECUSADO' ? 'DECLINED' : 'PROCESSING',
            intent.id,
          ],
        );
      } catch {
        await this.auth.db.query(
          "UPDATE checkout_payment_intents SET state='REVIEW' WHERE id=?",
          [intent.id],
        );
      }
    }
    return this.get(session, id);
  }
  async pix(session: string, id: string, paymentId: string) {
    const s = await this.owned(session, id);
    uuid(paymentId);
    await this.ready();
    await this.payments(s);
    const rows = await this.auth.db.query<Intent[]>(
      'SELECT * FROM checkout_payment_intents WHERE id=? AND checkout_id=?',
      [paymentId, id],
    );
    const p = rows[0];
    if (
      !p ||
      p.method !== 'PIX' ||
      !p.upstream_payment_id ||
      !s.upstream_order_id
    )
      throw new NotFoundException();
    if (p.state !== 'AWAITING_PAYMENT') throw new ConflictException();
    return this.erp.getPaymentPix(
      Number(s.upstream_order_id),
      Number(p.upstream_payment_id),
    );
  }
}

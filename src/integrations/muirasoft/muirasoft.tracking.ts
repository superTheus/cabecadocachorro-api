/* eslint-disable no-control-regex -- Valida texto remoto antes da projeção pública. */
import { MuiraSoftError } from './muirasoft.error.js';
import { fiscalDocuments, type FiscalDocument } from './muirasoft.fiscal.js';
export type OrderSummary = {
  id: string;
  number: number;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
  status: string;
  status_label: string;
  commercial_status: string;
  total: string;
  item_count: number;
  production_days: number;
};
export type CustomerRequest = {
  id: string;
  type: 'CANCELLATION' | 'RETURN' | 'SUPPORT';
  message: string;
  items: { id: string; quantity: string }[];
  status: string;
  created_at: string;
  updated_at: string;
  responses: { status: string; message: string; created_at: string }[];
};
export type TrackedOrder = OrderSummary & {
  documents: FiscalDocument[];
  checkout_reference: string | null;
  subtotal: string;
  freight: string;
  items: {
    id: string;
    name: string;
    color: string;
    size: string;
    image: string | null;
    quantity: string;
    unit_price: string;
    total: string;
    fulfillment: string | null;
    production_days: number | null;
  }[];
  delivery: {
    type: 'ENTREGA' | 'RETIRADA';
    name: string;
    lead_days: number;
    pickup_address: string | null;
    instructions: string | null;
    address: Record<string, string> | null;
    together: true;
  } | null;
  payments: {
    id: string;
    method: 'PIX' | 'CREDIT_CARD';
    installments: number;
    total: string;
    status: string;
    paid_at: string | null;
    refunded_total: string;
    pix_available: boolean;
  }[];
  timeline: { id: string; kind: string; label: string; at: string }[];
  requests: CustomerRequest[];
  can_request_cancellation: boolean;
  can_request_return: boolean;
  synced_at: string;
};
function fail(): never {
  throw new MuiraSoftError(
    'MUIRASOFT_INVALID_RESPONSE',
    502,
    'Acompanhamento indisponível.',
  );
}
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail();
  return v as Record<string, unknown>;
};
const str = (v: unknown, max = 1000): string => {
  if (
    typeof v !== 'string' ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v)
  )
    fail();
  return v;
};
const num = (v: unknown, max = 999999999): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max)
    fail();
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') fail();
  return v;
};
const choice = <T extends string>(v: unknown, choices: readonly T[]): T => {
  const s = str(v, 100);
  if (!choices.includes(s as T)) fail();
  return s as T;
};
const list = (v: unknown, max = 1000): unknown[] => {
  if (!Array.isArray(v) || v.length > max) fail();
  return v;
};
export const publicOrderId = (v: unknown): string => {
  const s = str(v, 32);
  if (!/^[a-f0-9]{32}$/u.test(s)) fail();
  return s;
};
const timestamp = (v: unknown): string => {
  const s = str(v, 30);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/u.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    fail();
  return s;
};
const nullableTime = (v: unknown) => (v === null ? null : timestamp(v));
const money = (v: unknown): string => {
  const s = str(v, 30);
  if (!/^\d{1,13}\.\d{2}$/u.test(s)) fail();
  return s;
};
const cents = (s: string) => BigInt(s.replace('.', ''));
const quantity = (v: unknown): string => {
  const s = str(v, 24);
  if (!/^\d{1,14}\.\d{4}$/u.test(s) || BigInt(s.replace('.', '')) === 0n)
    fail();
  return s;
};
const lineId = (v: unknown): string => {
  const s = str(v, 30);
  if (!/^item_[1-9]\d{0,18}$/u.test(s)) fail();
  return s;
};
const image = (v: unknown): string | null => {
  if (v === null) return null;
  const s = str(v, 2048);
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) fail();
  } catch {
    fail();
  }
  return s;
};
const requestStates = ['OPEN', 'IN_REVIEW', 'ANSWERED', 'CLOSED'] as const;
export function requestResponse(v: unknown): CustomerRequest {
  const p = obj(v);
  return {
    id: publicOrderId(p.id),
    type: choice(p.type, ['CANCELLATION', 'RETURN', 'SUPPORT']),
    message: str(p.message),
    items: list(p.items, 30).map((v) => {
      const i = obj(v);
      return { id: lineId(i.id), quantity: quantity(i.quantity) };
    }),
    status: choice(p.status, requestStates),
    created_at: timestamp(p.created_at),
    updated_at: timestamp(p.updated_at),
    responses: list(p.responses, 100).map((v) => {
      const r = obj(v);
      return {
        status: choice(r.status, requestStates),
        message: str(r.message),
        created_at: timestamp(r.created_at),
      };
    }),
  };
}
export function trackingSummary(v: unknown): OrderSummary {
  const p = obj(v);
  return {
    id: publicOrderId(p.id),
    number: num(p.number),
    created_at: timestamp(p.created_at),
    updated_at: timestamp(p.updated_at),
    canceled_at: nullableTime(p.canceled_at),
    status: choice(p.status, [
      'PENDENTE',
      'PRODUCAO',
      'SEPARACAO',
      'PRONTO',
      'EXPEDIDO',
      'RETIRADO',
      'ENTREGUE',
      'CONCLUIDO',
      'CANCELADO',
    ]),
    status_label: str(p.status_label, 150),
    commercial_status: str(p.commercial_status, 100),
    total: money(p.total),
    item_count: num(p.item_count, 500),
    production_days: num(p.production_days, 365),
  };
}
export function trackingPage(v: unknown) {
  const p = obj(v);
  const items = list(p.items, 50).map(trackingSummary);
  if (new Set(items.map((i) => i.id)).size !== items.length) fail();
  return {
    items,
    next_cursor: p.next_cursor === null ? null : publicOrderId(p.next_cursor),
    synced_at: timestamp(p.synced_at),
  };
}
export function trackingOrder(v: unknown, expected: string): TrackedOrder {
  const p = obj(v),
    s = trackingSummary(v);
  if (s.id !== expected) fail();
  const items = list(p.items, 500).map((v) => {
    const i = obj(v);
    return {
      id: lineId(i.id),
      name: str(i.name, 200),
      color: str(i.color, 100),
      size: str(i.size, 100),
      image: image(i.image),
      quantity: quantity(i.quantity),
      unit_price: money(i.unit_price),
      total: money(i.total),
      fulfillment:
        i.fulfillment === null
          ? null
          : choice(i.fulfillment, ['PRONTA_ENTREGA', 'ENCOMENDA']),
      production_days:
        i.production_days === null ? null : num(i.production_days, 365),
    };
  });
  if (
    new Set(items.map((i) => i.id)).size !== items.length ||
    items.length !== s.item_count
  )
    fail();
  const subtotal = money(p.subtotal),
    freight = money(p.freight);
  if (
    items.reduce((sum, i) => sum + cents(i.total), 0n) !== cents(subtotal) ||
    cents(subtotal) + cents(freight) !== cents(s.total)
  )
    fail();
  let delivery: TrackedOrder['delivery'] = null;
  if (p.delivery !== null) {
    const d = obj(p.delivery);
    if (d.together !== true) fail();
    const type = choice(d.type, ['ENTREGA', 'RETIRADA']);
    let address: Record<string, string> | null = null;
    if (d.address !== null) {
      const a = obj(d.address);
      address = {};
      for (const k of [
        'recipient',
        'postal_code',
        'street',
        'number',
        'complement',
        'district',
        'city',
        'state',
      ])
        address[k] = str(a[k], 200);
    }
    if (type === 'ENTREGA' && !address) fail();
    delivery = {
      type,
      name: str(d.name, 150),
      lead_days: num(d.lead_days, 365),
      pickup_address: d.pickup_address === null ? null : str(d.pickup_address),
      instructions: d.instructions === null ? null : str(d.instructions),
      address,
      together: true,
    };
  }
  const payments = list(p.payments, 100).map((v) => {
    const a = obj(v);
    const id = str(a.id, 40);
    if (!/^payment_[1-9]\d{0,18}$/u.test(id)) fail();
    return {
      id,
      method: choice(a.method, ['PIX', 'CREDIT_CARD']),
      installments: num(a.installments, 3),
      total: money(a.total),
      status: choice(a.status, [
        'PROCESSING',
        'REVIEW',
        'DECLINED',
        'PAID',
        'PAID_REVIEW',
        'AWAITING_PAYMENT',
        'REFUNDED',
        'PARTIALLY_REFUNDED',
      ]),
      paid_at: nullableTime(a.paid_at),
      refunded_total: money(a.refunded_total),
      pix_available: bool(a.pix_available),
    };
  });
  for (const a of payments)
    if (
      a.installments < 1 ||
      cents(a.refunded_total) > cents(a.total) ||
      a.total !== s.total ||
      (a.pix_available &&
        (a.method !== 'PIX' ||
          a.status !== 'AWAITING_PAYMENT' ||
          s.canceled_at !== null))
    )
      fail();
  return {
    ...s,
    documents: fiscalDocuments(p.documents ?? []),
    checkout_reference:
      p.checkout_reference === null
        ? null
        : publicOrderId(p.checkout_reference),
    subtotal,
    freight,
    items,
    delivery,
    payments,
    timeline: list(p.timeline, 2000).map((v) => {
      const t = obj(v);
      return {
        id: str(t.id, 50),
        kind: choice(t.kind, ['COMMERCIAL', 'FULFILLMENT', 'PAYMENT']),
        label: str(t.label, 150),
        at: timestamp(t.at),
      };
    }),
    requests: list(p.requests, 20).map(requestResponse),
    can_request_cancellation: bool(p.can_request_cancellation),
    can_request_return: bool(p.can_request_return),
    synced_at: timestamp(p.synced_at),
  };
}

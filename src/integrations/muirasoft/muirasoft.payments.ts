import { isIP } from 'node:net';
import { MuiraSoftError } from './muirasoft.error.js';
import { record, positiveId } from './muirasoft.validation.js';

export type PaymentInput =
  | { metodo: 'PIX'; parcelas?: 1 }
  | {
      metodo: 'CREDIT_CARD';
      parcelas?: 1 | 2 | 3;
      cartao: {
        holderName: string;
        number: string;
        expiryMonth: string;
        expiryYear: string;
        ccv: string;
      };
      ip_comprador: string;
    };
export interface StorePayment {
  id: number;
  id_pedido: number;
  metodo: 'PIX' | 'CREDIT_CARD';
  parcelas: number;
  total: string;
  estado: string;
  pago_em: string | null;
  revisao_estoque: boolean;
  erro_codigo: string | null;
  financeiro_codigo: string | null;
  estorno_estado: string | null;
  total_estornado: string;
  liquido_recebido_acumulado: string;
  cobrancas: {
    numero: number;
    valor: string;
    liquido: string;
    estornado: string;
    status_asaas: string;
    confirmado: 'S' | 'N';
    disponivel: 'S' | 'N';
    vencimento: string;
    credito_em: string | null;
  }[];
}
function invalid(input = false): never {
  throw new MuiraSoftError(
    input ? 'MUIRASOFT_INVALID_INPUT' : 'MUIRASOFT_INVALID_RESPONSE',
    input ? 422 : 502,
    input ? 'Dados de pagamento inválidos.' : 'Resposta de pagamento inválida.',
  );
}
export function paymentKey(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,100}$/u.test(value)) invalid(true);
  return value;
}
export function paymentInput(value: unknown): PaymentInput {
  const p = record(value);
  if (
    Object.keys(p).some(
      (k) => !['metodo', 'parcelas', 'cartao', 'ip_comprador'].includes(k),
    )
  )
    invalid(true);
  const count = p.parcelas ?? 1;
  if (!Number.isInteger(count) || ![1, 2, 3].includes(count as number))
    invalid(true);
  if (p.metodo === 'PIX') {
    if (count !== 1 || p.cartao !== undefined || p.ip_comprador !== undefined)
      invalid(true);
    return { metodo: 'PIX', parcelas: 1 };
  }
  if (
    p.metodo !== 'CREDIT_CARD' ||
    typeof p.ip_comprador !== 'string' ||
    !isIP(p.ip_comprador)
  )
    invalid(true);
  const card = record(p.cartao);
  if (
    Object.keys(card).some(
      (k) =>
        !['holderName', 'number', 'expiryMonth', 'expiryYear', 'ccv'].includes(
          k,
        ),
    )
  )
    invalid(true);
  const patterns: Record<string, RegExp> = {
    holderName: /^.{1,100}$/u,
    number: /^\d{13,19}$/u,
    expiryMonth: /^(0[1-9]|1[0-2])$/u,
    expiryYear: /^20\d{2}$/u,
    ccv: /^\d{3,4}$/u,
  };
  for (const [key, pattern] of Object.entries(patterns))
    if (typeof card[key] !== 'string' || !pattern.test(card[key]))
      invalid(true);
  if (Array.from(card.holderName as string).some(c => c.charCodeAt(0) < 32)) invalid(true);
  return {
    metodo: 'CREDIT_CARD',
    parcelas: count as 1 | 2 | 3,
    cartao: {
      holderName: card.holderName as string,
      number: card.number as string,
      expiryMonth: card.expiryMonth as string,
      expiryYear: card.expiryYear as string,
      ccv: card.ccv as string,
    },
    ip_comprador: p.ip_comprador,
  };
}
function money(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{1,12}\.\d{2}$/u.test(v)) invalid();
  return v;
}
function nullable(v: unknown): string | null {
  if (v !== null && typeof v !== 'string') invalid();
  return v;
}
function sn(v: unknown): 'S' | 'N' {
  if (v !== 'S' && v !== 'N') invalid();
  return v;
}
function responseObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
}
function cents(v: string): bigint {
  return BigInt(v.replace('.', ''));
}
export function paymentResponse(value: unknown, orderId: number): StorePayment {
  const p = responseObject(value);
  if (
    p.id_pedido !== orderId ||
    !['PIX', 'CREDIT_CARD'].includes(p.metodo as string) ||
    !['EM_ENVIO', 'INCERTO', 'CRIADO', 'RECUSADO', 'REVISAO'].includes(
      p.estado as string,
    ) ||
    ![1, 2, 3].includes(p.parcelas as number) ||
    typeof p.revisao_estoque !== 'boolean' ||
    !Array.isArray(p.cobrancas) ||
    p.cobrancas.length > 3
  )
    invalid();
  if (p.metodo === 'PIX' && p.parcelas !== 1) invalid();
  const seen = new Set<number>();
  const cobrancas = p.cobrancas.map((value: unknown) => {
    const c = responseObject(value),
      numero = positiveId(Number(c.numero));
    if (
      seen.has(numero) ||
      numero > (p.parcelas as number) ||
      typeof c.status_asaas !== 'string' ||
      typeof c.vencimento !== 'string'
    )
      invalid();
    seen.add(numero);
    return {
      numero,
      valor: money(c.valor),
      liquido: money(c.liquido),
      estornado: money(c.estornado),
      status_asaas: c.status_asaas,
      confirmado: sn(c.confirmado),
      disponivel: sn(c.disponivel),
      vencimento: c.vencimento,
      credito_em: nullable(c.credito_em),
    };
  });
  const total = money(p.total),
    refunded = money(p.total_estornado),
    received = money(p.liquido_recebido_acumulado);
  if (
    cents(total) <= 0n ||
    cents(refunded) > cents(total) ||
    cobrancas.some(
      (c) =>
        cents(c.liquido) > cents(c.valor) ||
        cents(c.estornado) > cents(c.valor),
    ) ||
    (cobrancas.length > 0 && cobrancas.length !== p.parcelas) ||
    (p.pago_em !== null && cobrancas.some((c) => c.confirmado !== 'S'))
  )
    invalid();
  if (
    cobrancas.length &&
    cobrancas.reduce((sum, c) => sum + cents(c.valor), 0n) !== cents(total)
  )
    invalid();
  if (
    cobrancas.reduce((sum, c) => sum + cents(c.estornado), 0n) !==
      cents(refunded) ||
    cobrancas
      .filter((c) => c.disponivel === 'S')
      .reduce((sum, c) => sum + cents(c.liquido), 0n) !== cents(received)
  )
    invalid();
  return {
    id: positiveId(p.id),
    id_pedido: orderId,
    metodo: p.metodo as StorePayment['metodo'],
    parcelas: p.parcelas as number,
    total: money(p.total),
    estado: p.estado as string,
    pago_em: nullable(p.pago_em),
    revisao_estoque: p.revisao_estoque,
    erro_codigo: nullable(p.erro_codigo),
    financeiro_codigo: nullable(p.financeiro_codigo),
    estorno_estado: nullable(p.estorno_estado),
    total_estornado: money(p.total_estornado),
    liquido_recebido_acumulado: money(p.liquido_recebido_acumulado),
    cobrancas,
  };
}
export function paymentsResponse(
  value: unknown,
  orderId: number,
): StorePayment[] {
  const p = responseObject(value);
  if (!Array.isArray(p.data) || p.data.length > 50) invalid();
  return p.data.map((v) => paymentResponse(v, orderId));
}
export function pixResponse(value: unknown): {
  imagem_base64: string;
  copia_cola: string;
  expira_em: string;
} {
  const p = responseObject(value);
  if (
    typeof p.imagem_base64 !== 'string' ||
    p.imagem_base64.length > 100000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(p.imagem_base64) ||
    !Buffer.from(p.imagem_base64, 'base64')
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    typeof p.copia_cola !== 'string' ||
    p.copia_cola.length > 4096 ||
    typeof p.expira_em !== 'string' ||
    p.expira_em.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(p.expira_em) ||
    !Number.isFinite(Date.parse(p.expira_em)) ||
    Date.parse(p.expira_em) <= Date.now()
  )
    invalid();
  return {
    imagem_base64: p.imagem_base64,
    copia_cola: p.copia_cola,
    expira_em: p.expira_em,
  };
}

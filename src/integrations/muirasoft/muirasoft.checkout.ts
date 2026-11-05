import { MuiraSoftError } from './muirasoft.error.js';
export interface CheckoutAddress {
  recipient: string;
  postal_code: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}
export interface DeliveryOption {
  tipo: 'RETIRADA' | 'ENTREGA';
  nome: string;
  taxa: string;
  prazo_dias: number;
  endereco: string | null;
  instrucoes: string | null;
}
export interface CheckoutQuote {
  id: string;
  expira_em: string;
  id_pedido: number | null;
  numero_pedido: string | null;
  revisao: {
    cliente: { nome: string; email: string; documento_final: string };
    endereco: CheckoutAddress;
    entrega: DeliveryOption;
    itens: {
      sku_id: number;
      titulo: string;
      cor: string;
      tamanho: string;
      imagem: string | null;
      quantidade: number;
      preco: string;
      total: string;
      modalidade: 'PRONTA_ENTREGA' | 'ENCOMENDA';
      prazo_producao_dias: number | null;
    }[];
    subtotal: string;
    frete: string;
    total: string;
    prazo_producao_dias: number;
    atendimento_conjunto: true;
  };
}
export interface CheckoutQuoteInput {
  cliente: {
    referencia_externa: string;
    nome: string;
    email: string;
    documento: string;
    telefone: string;
  };
  endereco: CheckoutAddress;
  tipo_entrega: 'RETIRADA' | 'ENTREGA';
  itens: {
    id_produto: number;
    quantidade: number;
    modalidade: 'PRONTA_ENTREGA' | 'ENCOMENDA';
  }[];
}
function invalid(): never {
  throw new MuiraSoftError(
    'MUIRASOFT_INVALID_RESPONSE',
    502,
    'Resposta de checkout inválida.',
  );
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 1000): string => {
  if (typeof v !== 'string' || v.length > max) invalid();
  return v;
};
const integer = (v: unknown, min = 0, max = 999999999): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    invalid();
  return v;
};
const money = (v: unknown): string => {
  const s = text(v, 30);
  if (!/^\d{1,12}\.\d{2}$/u.test(s)) invalid();
  return s;
};
const amount = (s: string) => BigInt(s.replace('.', ''));
export function deliveryResponse(value: unknown): DeliveryOption {
  const d = object(value);
  if (!['RETIRADA', 'ENTREGA'].includes(d.tipo as string)) invalid();
  return {
    tipo: d.tipo as DeliveryOption['tipo'],
    nome: text(d.nome, 100),
    taxa: money(d.taxa),
    prazo_dias: integer(d.prazo_dias, 0, 365),
    endereco: d.endereco === null ? null : text(d.endereco),
    instrucoes: d.instrucoes === null ? null : text(d.instrucoes),
  };
}
export function optionsResponse(value: unknown) {
  const v = object(value);
  if (
    v.atendimento_conjunto !== true ||
    !Array.isArray(v.opcoes) ||
    v.opcoes.length > 2
  )
    invalid();
  return {
    versao: integer(v.versao, 1),
    atendimento_conjunto: true as const,
    opcoes: v.opcoes.map(deliveryResponse),
  };
}
export function quoteResponse(value: unknown): CheckoutQuote {
  const q = object(value),
    r = object(q.revisao),
    c = object(r.cliente),
    a = object(r.endereco);
  const id = text(q.id, 32);
  if (
    !/^[a-f0-9]{32}$/u.test(id) ||
    r.atendimento_conjunto !== true ||
    !Array.isArray(r.itens) ||
    !r.itens.length ||
    r.itens.length > 30
  )
    invalid();
  const expires = text(q.expira_em, 40);
  if (!Number.isFinite(Date.parse(expires))) invalid();
  const address = Object.fromEntries(
    [
      'recipient',
      'postal_code',
      'street',
      'number',
      'complement',
      'district',
      'city',
      'state',
    ].map((k) => [k, text(a[k], 150)]),
  ) as unknown as CheckoutAddress;
  const rows = r.itens.map((value) => {
    const i = object(value);
    if (!['PRONTA_ENTREGA', 'ENCOMENDA'].includes(i.modalidade as string))
      invalid();
    const image = i.imagem === null ? null : text(i.imagem, 2048);
    if (image && !image.startsWith('https://')) invalid();
    return {
      sku_id: integer(i.sku_id, 1, Number.MAX_SAFE_INTEGER),
      titulo: text(i.titulo, 150),
      cor: text(i.cor, 100),
      tamanho: text(i.tamanho, 100),
      imagem: image,
      quantidade: integer(i.quantidade, 1, 99),
      preco: money(i.preco),
      total: money(i.total),
      modalidade: i.modalidade as 'PRONTA_ENTREGA' | 'ENCOMENDA',
      prazo_producao_dias:
        i.prazo_producao_dias === null
          ? null
          : integer(i.prazo_producao_dias, 1, 365),
    };
  });
  const subtotal = money(r.subtotal),
    fee = money(r.frete),
    total = money(r.total);
  if (
    rows.some(
      (i) => amount(i.preco) * BigInt(i.quantidade) !== amount(i.total),
    ) ||
    rows.reduce((sum, i) => sum + amount(i.total), 0n) !== amount(subtotal) ||
    amount(subtotal) + amount(fee) !== amount(total)
  )
    invalid();
  const delivery = deliveryResponse(r.entrega);
  if (delivery.taxa !== fee) invalid();
  return {
    id,
    expira_em: expires,
    id_pedido:
      q.id_pedido === null
        ? null
        : integer(q.id_pedido, 1, Number.MAX_SAFE_INTEGER),
    numero_pedido: q.numero_pedido === null ? null : text(q.numero_pedido, 30),
    revisao: {
      cliente: {
        nome: text(c.nome, 100),
        email: text(c.email, 254),
        documento_final: text(c.documento_final, 4),
      },
      endereco: address,
      entrega: delivery,
      itens: rows,
      subtotal,
      frete: fee,
      total,
      prazo_producao_dias: integer(r.prazo_producao_dias, 0, 365),
      atendimento_conjunto: true,
    },
  };
}

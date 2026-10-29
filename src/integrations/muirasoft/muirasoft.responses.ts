import { MuiraSoftError } from './muirasoft.error.js';
import type {
  MuiraSoftConnection,
  MuiraSoftOrder,
  MuiraSoftOrderDetail,
  MuiraSoftOrderPage,
  MuiraSoftProduct,
  MuiraSoftProductPage,
} from './muirasoft.types.js';

type Parser = (value: unknown) => unknown;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

/** Project declared fields instead of passing unexpected upstream data to future callers. */
function shape(
  value: unknown,
  schema: Record<string, Parser>,
  required: string[],
): Record<string, unknown> {
  const source = object(value);
  const result: Record<string, unknown> = {};
  for (const [key, parser] of Object.entries(schema)) {
    if (source[key] === undefined) {
      if (required.includes(key)) invalid();
    } else result[key] = parser(source[key]);
  }
  return result;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}

function id(value: unknown): number {
  if (integer(value) < 1) invalid();
  return value as number;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function literal(...values: Array<string | null>): Parser {
  return (value) => {
    if (!values.includes(value as string | null)) invalid();
    return value;
  };
}

function nullable(parser: Parser): Parser {
  return (value) => (value === null ? null : parser(value));
}

function array(parser: Parser, max = Number.MAX_SAFE_INTEGER): Parser {
  return (value) => {
    if (!Array.isArray(value) || value.length > max) invalid();
    return value.map(parser);
  };
}

function decimal(value: unknown): string {
  const result = string(value);
  if (!/^\d{1,13}(?:\.\d{1,2})?$/u.test(result) || result.trim() !== result)
    invalid();
  return result;
}

function quantity(value: unknown): string {
  const result = string(value);
  if (!/^-?\d{1,13}(?:\.\d{1,4})?$/u.test(result) || result.trim() !== result)
    invalid();
  return result;
}

function timestamp(value: unknown): string {
  const result = string(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T.+Z$/u.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid();
  return result;
}

const origin = literal('LOJA_VIRTUAL', 'MARKETPLACE', 'API', 'INTEGRACAO');
const policy = literal('SEM_MOVIMENTO');
const statusSchema = {
  codigo: string,
  nome: string,
  tipo: literal('FLUXO', 'ESPECIAL', 'CANCELAMENTO'),
  stage: nullable(id),
};
const status: Parser = (value) =>
  shape(value, statusSchema, Object.keys(statusSchema));
const orderSchema = {
  id,
  numero: id,
  referencia_externa: string,
  origem: origin,
  canal: string,
  status,
  total: decimal,
  total_desconto: decimal,
  total_acrescimo: decimal,
  versao: id,
  criado_em: timestamp,
  atualizado_em: timestamp,
  cancelado_em: nullable(timestamp),
  estoque_politica: policy,
};
const orderRequired = [
  'id',
  'numero',
  'referencia_externa',
  'status',
  'total',
  'versao',
];
const customerSchema = Object.fromEntries(
  [
    'referencia_externa',
    'nome',
    'email',
    'documento',
    'telefone',
    'cep',
    'logradouro',
    'numero',
    'bairro',
    'complemento',
    'cidade',
    'estado',
    'codigo_municipio',
    'inscricao_estadual',
  ].map((key) => [key, string]),
);

export function connectionResponse(value: unknown): MuiraSoftConnection {
  const schema = {
    nome: string,
    empresa: id,
    canal: string,
    origem: origin,
    escopos: array(
      literal(
        'produtos:ler',
        'pedidos:criar',
        'pedidos:ler',
        'pedidos:cancelar',
      ),
      4,
    ),
    estoque_politica: policy,
  };
  return shape(
    value,
    schema,
    Object.keys(schema),
  ) as unknown as MuiraSoftConnection;
}

export function productResponse(value: unknown): MuiraSoftProduct {
  const stockSchema = {
    cadastrado: boolean,
    fisico: nullable(quantity),
    politica: policy,
    reservado: literal(null),
    disponivel_para_venda: literal(null),
    consultado_em: timestamp,
    versao: nullable(integer),
  };
  const schema = {
    id,
    descricao: string,
    unidade: nullable(string),
    ean: nullable(string),
    controla_estoque: boolean,
    kit: boolean,
    preco_venda: nullable(decimal),
    estoque: (stock: unknown) =>
      shape(stock, stockSchema, [
        'cadastrado',
        'fisico',
        'politica',
        'reservado',
        'disponivel_para_venda',
        'consultado_em',
      ]),
  };
  return shape(value, schema, [
    'id',
    'descricao',
    'estoque',
  ]) as unknown as MuiraSoftProduct;
}

export function productPageResponse(value: unknown): MuiraSoftProductPage {
  return shape(
    value,
    {
      data: array(productResponse, 100),
      next_cursor: nullable((cursor) => {
        const result = string(cursor);
        if (
          !/^[1-9]\d*$/u.test(result) ||
          !Number.isSafeInteger(Number(result))
        )
          invalid();
        return result;
      }),
    },
    ['data', 'next_cursor'],
  ) as unknown as MuiraSoftProductPage;
}

export function orderResponse(value: unknown): MuiraSoftOrder {
  return shape(value, orderSchema, orderRequired) as unknown as MuiraSoftOrder;
}

export function orderPageResponse(value: unknown): MuiraSoftOrderPage {
  return shape(
    value,
    {
      data: array(orderResponse, 100),
      total: integer,
      limit: id,
      offset: integer,
    },
    ['data', 'total', 'limit', 'offset'],
  ) as unknown as MuiraSoftOrderPage;
}

export function orderDetailResponse(value: unknown): MuiraSoftOrderDetail {
  const itemSchema = {
    id_produto: id,
    quantidade: quantity,
    preco: decimal,
    desconto_real: decimal,
    acrescimo: decimal,
    descricao: string,
    total: decimal,
  };
  const historySchema = {
    anterior: nullable(status),
    novo: status,
    data: timestamp,
    observacao: nullable(string),
  };
  const schema = {
    ...orderSchema,
    cliente: nullable((customer) =>
      shape(customer, customerSchema, ['referencia_externa', 'nome']),
    ),
    itens: array(
      (item) => shape(item, itemSchema, ['id_produto', 'quantidade', 'preco']),
      500,
    ),
    fluxo: array(status),
    historico: array((entry) =>
      shape(entry, historySchema, Object.keys(historySchema)),
    ),
  };
  return shape(value, schema, [
    ...orderRequired,
    'cliente',
    'itens',
    'fluxo',
    'historico',
  ]) as unknown as MuiraSoftOrderDetail;
}

function invalid(): never {
  throw new MuiraSoftError(
    'MUIRASOFT_INVALID_RESPONSE',
    502,
    'Resposta incompatível com o contrato MuiraSoft.',
  );
}

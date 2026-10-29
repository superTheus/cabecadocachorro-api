import { MuiraSoftError } from './muirasoft.error.js';
import type {
  MuiraSoftCancelOrder,
  MuiraSoftCreateOrder,
  MuiraSoftOrderFilter,
  MuiraSoftProductFilter,
} from './muirasoft.types.js';

type JsonObject = Record<string, unknown>;

export function record(value: unknown): JsonObject {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalidInput();
  return value as JsonObject;
}

function fields(value: JsonObject, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalidInput();
}

export function positiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    invalidInput();
  return value;
}

function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required && value.trim() === '')
  )
    invalidInput();
  return value;
}

function decimal(value: unknown, scale: number): string {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^\\d{1,13}(?:\\.\\d{1,${scale}})?$`, 'u').test(value) ||
    value.trim() !== value
  )
    invalidInput();
  return value;
}

function date(value: unknown): string {
  const day = text(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) invalidInput();
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  )
    invalidInput();
  return day;
}

export function idempotencyKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)
  )
    invalidInput();
  return value;
}

export function createOrderInput(
  input: MuiraSoftCreateOrder,
): MuiraSoftCreateOrder {
  const source = record(input);
  fields(source, [
    'referencia_externa',
    'cliente',
    'itens',
    'pagamentos',
    'observacao',
  ]);
  text(source['referencia_externa'], 191, true);
  if (
    !Array.isArray(source['itens']) ||
    source['itens'].length < 1 ||
    source['itens'].length > 500
  )
    invalidInput();
  for (const item of source['itens']) {
    const row = record(item);
    fields(row, [
      'id_produto',
      'quantidade',
      'preco',
      'desconto_real',
      'desconto_percentual',
      'acrescimo',
    ]);
    positiveId(row['id_produto']);
    if (Number(decimal(row['quantidade'], 4)) <= 0) invalidInput();
    decimal(row['preco'], 2);
    for (const key of ['desconto_real', 'desconto_percentual', 'acrescimo']) {
      if (row[key] !== undefined) decimal(row[key], 2);
    }
  }
  if (source['pagamentos'] !== undefined) {
    if (
      !Array.isArray(source['pagamentos']) ||
      source['pagamentos'].length > 50
    )
      invalidInput();
    for (const payment of source['pagamentos']) {
      const row = record(payment);
      fields(row, [
        'id_forma',
        'id_condicao_pagamento',
        'valor',
        'parcelas',
        'primeiro_vencimento',
      ]);
      positiveId(row['id_forma']);
      decimal(row['valor'], 2);
      for (const key of ['id_condicao_pagamento', 'parcelas']) {
        if (row[key] !== undefined && row[key] !== null) positiveId(row[key]);
      }
      if (
        row['primeiro_vencimento'] !== undefined &&
        row['primeiro_vencimento'] !== null
      )
        date(row['primeiro_vencimento']);
    }
  }
  if (source['cliente'] !== undefined && source['cliente'] !== null)
    customerInput(source['cliente']);
  if (source['observacao'] !== undefined) text(source['observacao'], 2000);
  // Capture the validated payload before awaiting network calls: later caller mutations cannot alter it.
  return structuredClone(input);
}

export function customerInput(value: unknown): void {
  const customer = record(value);
  const lengths: Record<string, number> = {
    referencia_externa: 191,
    nome: 100,
    email: 100,
    documento: 18,
    telefone: 50,
    cep: 9,
    logradouro: 50,
    numero: 50,
    bairro: 50,
    complemento: 50,
    cidade: 50,
    estado: 2,
    codigo_municipio: 7,
    inscricao_estadual: 100,
  };
  fields(customer, Object.keys(lengths));
  text(customer['referencia_externa'], 191, true);
  text(customer['nome'], 100, true);
  for (const [key, max] of Object.entries(lengths))
    if (customer[key] !== undefined) text(customer[key], max);
}

export function cancelOrderInput(
  input: MuiraSoftCancelOrder,
): MuiraSoftCancelOrder {
  const source = record(input);
  fields(source, ['motivo', 'versao']);
  return {
    motivo: text(source['motivo'], 500, true),
    versao: positiveId(source['versao']),
  };
}

export function productFilter(input: MuiraSoftProductFilter): URLSearchParams {
  const filter = record(input);
  fields(filter, ['busca', 'ean', 'cursor', 'limit']);
  if (filter['busca'] !== undefined) text(filter['busca'], 100);
  if (filter['ean'] !== undefined) text(filter['ean'], 100);
  if (filter['cursor'] !== undefined) positiveId(filter['cursor']);
  if (filter['limit'] !== undefined && positiveId(filter['limit']) > 100)
    invalidInput();
  return parameters(filter);
}

export function orderFilter(input: MuiraSoftOrderFilter): URLSearchParams {
  const filter = record(input);
  fields(filter, [
    'referencia_externa',
    'numero',
    'status',
    'stage',
    'data_inicio',
    'data_fim',
    'limit',
    'offset',
  ]);
  for (const key of ['referencia_externa', 'status'])
    if (filter[key] !== undefined) text(filter[key], 191);
  for (const key of ['numero', 'stage'])
    if (filter[key] !== undefined) positiveId(filter[key]);
  if (filter['limit'] !== undefined && positiveId(filter['limit']) > 100)
    invalidInput();
  if (
    filter['offset'] !== undefined &&
    (typeof filter['offset'] !== 'number' ||
      !Number.isSafeInteger(filter['offset']) ||
      filter['offset'] < 0 ||
      filter['offset'] > 100000)
  )
    invalidInput();
  for (const key of ['data_inicio', 'data_fim'])
    if (filter[key] !== undefined) date(filter[key]);
  if (
    typeof filter['data_inicio'] === 'string' &&
    typeof filter['data_fim'] === 'string' &&
    filter['data_inicio'] > filter['data_fim']
  )
    invalidInput();
  return parameters(filter);
}

function parameters(filter: JsonObject): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number') invalidInput();
    result.set(key, String(value));
  }
  return result;
}

function invalidInput(): never {
  throw new MuiraSoftError(
    'MUIRASOFT_INVALID_INPUT',
    422,
    'Dados inválidos para a integração MuiraSoft.',
  );
}

import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { MuiraSoftProduct } from '../integrations/muirasoft/muirasoft.types.js';

export type Fulfillment = 'PRONTA_ENTREGA' | 'ENCOMENDA';
export interface CatalogVariant {
  sku_id: number;
  title: string;
  price: string;
  color: string;
  size: string;
  images: string[];
  fulfillment: 'PRONTA_ENTREGA' | 'ENCOMENDA' | 'MISTA';
  production_days: number | null;
  ready_available: boolean;
  max_ready_quantity: number | null;
}
export interface CatalogProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  images: string[];
  price_from: string;
  variants: CatalogVariant[];
}
export interface CartInput {
  sku_id: number;
  quantity: number;
  fulfillment: Fulfillment;
  observed_price?: string;
}
const bad = (): never => {
  throw new BadRequestException();
};
export function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return bad();
  return v as Record<string, unknown>;
}
export function fields(v: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(v).some((k) => !allowed.includes(k))) bad();
}
export function cents(v: string): bigint {
  return BigInt(v.replace('.', ''));
}
export function decimal(v: bigint): string {
  return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
}
export function productId(p: MuiraSoftProduct): string {
  return p.loja?.grupo_variacao
    ? 'g_' +
        createHash('sha256')
          .update(p.loja.grupo_variacao)
          .digest('hex')
          .slice(0, 32)
    : `p_${p.id}`;
}
export function variant(p: MuiraSoftProduct): CatalogVariant | null {
  const l = presentation(p);
  if (
    typeof p.controla_estoque !== 'boolean' ||
    !p.preco_venda ||
    !/^\d{1,12}\.\d{2}$/u.test(p.preco_venda) ||
    cents(p.preco_venda) <= 0n
  )
    return null;
  let max: number | null = null;
  if (p.controla_estoque) {
    const available = p.estoque.disponivel_para_venda;
    max =
      p.estoque.politica === 'RESERVA' && available !== null
        ? Math.max(0, Math.min(99, Math.floor(Number(available))))
        : 0;
    if (!Number.isFinite(max)) max = 0;
  }
  return {
    sku_id: p.id,
    title: l.titulo,
    price: p.preco_venda,
    color: l.cor,
    size: l.tamanho,
    images: l.imagens,
    fulfillment: l.modalidade,
    production_days: l.prazo_dias,
    ready_available: l.modalidade !== 'ENCOMENDA' && (max === null || max > 0),
    max_ready_quantity: max,
  };
}
export function presentation(p: MuiraSoftProduct) {
  return p.loja ?? {
    titulo: p.descricao, descricao: p.descricao, categoria: p.categoria || 'Sem categoria',
    imagens: (p.imagens || []).map((image) => `/api/v1/catalog/images/${p.id}/${image.id}`),
    grupo_variacao: null, cor: '', tamanho: '', modalidade: 'PRONTA_ENTREGA' as const, prazo_dias: null,
  };
}
export function groupProducts(products: MuiraSoftProduct[]): CatalogProduct[] {
  const result = new Map<string, CatalogProduct>();
  for (const p of products) {
    const v = variant(p);
    if (!v) continue;
    const display = presentation(p);
    const id = productId(p),
      current = result.get(id);
    if (current) {
      current.variants.push(v);
      if (cents(v.price) < cents(current.price_from))
        current.price_from = v.price;
    } else
      result.set(id, {
        id,
        title: display.titulo,
        description: display.descricao,
        category: display.categoria,
        images: v.images,
        price_from: v.price,
        variants: [v],
      });
  }
  return [...result.values()];
}
export function cartInput(body: unknown, storeId: string): CartInput[] {
  const b = object(body);
  fields(b, ['store_id', 'items']);
  if (b.store_id !== storeId || !Array.isArray(b.items) || b.items.length > 30)
    bad();
  const rows = new Map<string, CartInput>();
  for (const item of b.items as unknown[]) {
    const r = object(item);
    fields(r, ['sku_id', 'quantity', 'fulfillment', 'observed_price']);
    if (
      !Number.isSafeInteger(r.sku_id) ||
      (r.sku_id as number) < 1 ||
      !Number.isInteger(r.quantity) ||
      (r.quantity as number) < 1 ||
      (r.quantity as number) > 99 ||
      !['PRONTA_ENTREGA', 'ENCOMENDA'].includes(r.fulfillment as string) ||
      (r.observed_price !== undefined &&
        (typeof r.observed_price !== 'string' ||
          !/^\d{1,12}\.\d{2}$/u.test(r.observed_price)))
    )
      bad();
    const key = `${r.sku_id as number}:${r.fulfillment as string}`;
    if (rows.has(key)) bad();
    rows.set(key, r as unknown as CartInput);
  }
  return [...rows.values()];
}
export function queryInput(value: unknown) {
  const q = object(value);
  fields(q, [
    'search',
    'category',
    'color',
    'size',
    'fulfillment',
    'sort',
    'page',
    'limit',
  ]);
  for (const f of ['search', 'category', 'color', 'size'])
    if (
      q[f] !== undefined &&
      (typeof q[f] !== 'string' || (q[f] as string).length > 100)
    )
      bad();
  if (
    q.fulfillment !== undefined &&
    !['PRONTA_ENTREGA', 'ENCOMENDA'].includes(q.fulfillment as string)
  )
    bad();
  if (
    q.sort !== undefined &&
    !['recent', 'price_asc', 'price_desc'].includes(q.sort as string)
  )
    bad();
  const page = q.page === undefined ? 1 : Number(q.page),
    limit = q.limit === undefined ? 24 : Number(q.limit);
  if (
    (q.page !== undefined &&
      (typeof q.page !== 'string' || !/^\d{1,4}$/u.test(q.page))) ||
    (q.limit !== undefined &&
      (typeof q.limit !== 'string' || !/^\d{1,2}$/u.test(q.limit))) ||
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 48
  )
    bad();
  return {
    search: ((q.search as string) || '').trim().toLocaleLowerCase('pt-BR'),
    category: q.category as string | undefined,
    color: q.color as string | undefined,
    size: q.size as string | undefined,
    fulfillment: q.fulfillment as Fulfillment | undefined,
    sort: (q.sort as string) || 'recent',
    page,
    limit,
  };
}

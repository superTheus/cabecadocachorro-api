import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';
import { MuiraSoftError } from '../integrations/muirasoft/muirasoft.error.js';
import {
  cartInput,
  cents,
  decimal,
  groupProducts,
  productId,
  queryInput,
  variant,
  type CatalogProduct,
  type CartInput,
} from './catalog.domain.js';

@Injectable()
export class CatalogService {
  private cache: { at: number; products: CatalogProduct[] } | null = null;
  private loading: Promise<CatalogProduct[]> | null = null;
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MuiraSoftClient) private readonly erp: MuiraSoftClient,
  ) {}
  private async ready(): Promise<void> {
    if (!this.config.integrationConfigured || !(await this.db.verifyBinding()))
      throw new ServiceUnavailableException();
    try {
      const c = await this.erp.checkConnection();
      if (!c.escopos.includes('produtos:ler')) throw new Error();
    } catch {
      this.cache = null;
      throw new ServiceUnavailableException();
    }
  }
  private async products(): Promise<CatalogProduct[]> {
    await this.ready();
    if (this.cache && Date.now() - this.cache.at < 15000)
      return this.cache.products;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const all = [];
      let cursor: number | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await this.erp.listProducts({
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        all.push(...page.data);
        if (page.next_cursor === null) {
          const products = groupProducts(all);
          this.cache = { at: Date.now(), products };
          return products;
        }
        const next = Number(page.next_cursor);
        if (!Number.isSafeInteger(next) || next <= (cursor ?? 0))
          throw new Error();
        cursor = next;
      }
      throw new Error('Catálogo excede paginação suportada.');
    })();
    try {
      return await this.loading;
    } catch {
      this.cache = null;
      throw new ServiceUnavailableException();
    } finally {
      this.loading = null;
    }
  }
  async list(query: unknown) {
    const q = queryInput(query),
      products = await this.products();
    const facets = {
      categories: [...new Set(products.map((p) => p.category))].sort(),
      colors: [
        ...new Set(
          products
            .flatMap((p) => p.variants.map((v) => v.color))
            .filter(Boolean),
        ),
      ].sort(),
      sizes: [
        ...new Set(
          products
            .flatMap((p) => p.variants.map((v) => v.size))
            .filter(Boolean),
        ),
      ].sort(),
    };
    const found = products.filter(
      (p) =>
        (!q.search ||
          `${p.title} ${p.description} ${p.category} ${p.variants.map((v) => v.title).join(' ')}`
            .toLocaleLowerCase('pt-BR')
            .includes(q.search)) &&
        (!q.category || p.category === q.category) &&
        p.variants.some(
          (v) =>
            (!q.color || v.color === q.color) &&
            (!q.size || v.size === q.size) &&
            (!q.fulfillment ||
              (q.fulfillment === 'PRONTA_ENTREGA'
                ? v.ready_available
                : v.fulfillment !== 'PRONTA_ENTREGA')),
        ),
    );
    if (q.sort.startsWith('price_'))
      found.sort(
        (a, b) =>
          (cents(a.price_from) < cents(b.price_from)
            ? -1
            : cents(a.price_from) > cents(b.price_from)
              ? 1
              : a.id.localeCompare(b.id)) * (q.sort === 'price_desc' ? -1 : 1),
      );
    else found.reverse();
    return {
      store_id: this.config.store.id,
      items: found.slice((q.page - 1) * q.limit, q.page * q.limit),
      total: found.length,
      page: q.page,
      limit: q.limit,
      facets,
    };
  }
  async image(product: string, image: string) {
    if (!/^[1-9]\d{0,15}$/u.test(product) || !/^[1-9]\d{0,15}$/u.test(image)) throw new NotFoundException();
    await this.ready();
    const p = await this.erp.getProduct(Number(product));
    if (!variant(p) || !p.imagens?.some((i) => i.id === Number(image))) throw new NotFoundException();
    return this.erp.productImage(Number(product), Number(image));
  }
  async detail(id: string) {
    if (!/^(p_\d{1,16}|g_[a-f0-9]{32})$/u.test(id))
      throw new NotFoundException();
    const p = (await this.products()).find((p) => p.id === id);
    if (!p) throw new NotFoundException();
    return p;
  }
  private async line(row: CartInput) {
    try {
      const p = await this.erp.getProduct(row.sku_id),
        v = variant(p);
      if (!v)
        throw new MuiraSoftError(
          'MUIRASOFT_NOT_FOUND',
          404,
          'Produto indisponível.',
        );
      let status = 'OK';
      if (v.fulfillment !== 'MISTA' && v.fulfillment !== row.fulfillment)
        status = 'FULFILLMENT_UNAVAILABLE';
      else if (
        row.fulfillment === 'PRONTA_ENTREGA' &&
        (!v.ready_available ||
          (v.max_ready_quantity !== null &&
            row.quantity > v.max_ready_quantity))
      )
        status = 'QUANTITY_UNAVAILABLE';
      else if (
        row.observed_price !== undefined &&
        row.observed_price !== v.price
      )
        status = 'PRICE_CHANGED';
      return {
        ...row,
        status,
        product: { ...v, product_id: productId(p) },
        line_total: decimal(cents(v.price) * BigInt(row.quantity)),
      };
    } catch (e) {
      if (e instanceof MuiraSoftError && e.status === 404)
        return {
          ...row,
          status: 'UNPUBLISHED',
          product: null,
          line_total: null,
        };
      throw new ServiceUnavailableException();
    }
  }
  async validate(body: unknown) {
    const rows = cartInput(body, this.config.store.id);
    await this.ready();
    // Máximo de quatro leituras simultâneas; nenhuma reserva ou estoque no NestJS.
    const items = [];
    for (let i = 0; i < rows.length; i += 4)
      items.push(
        ...(await Promise.all(rows.slice(i, i + 4).map((r) => this.line(r)))),
      );
    const valid = items.length > 0 && items.every((r) => r.status === 'OK');
    return {
      store_id: this.config.store.id,
      checked_at: new Date().toISOString(),
      valid,
      total: valid
        ? decimal(items.reduce((sum, r) => sum + cents(r.line_total!), 0n))
        : null,
      items,
    };
  }
}

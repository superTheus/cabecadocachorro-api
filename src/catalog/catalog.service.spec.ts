import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogService } from './catalog.service.js';
import {
  cartInput,
  groupProducts,
  queryInput,
  variant,
} from './catalog.domain.js';
import { MuiraSoftError } from '../integrations/muirasoft/muirasoft.error.js';
import type { AppConfig } from '../config/app-config.js';
import type { DatabaseService } from '../database/database.service.js';
import type { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';
import type { MuiraSoftProduct } from '../integrations/muirasoft/muirasoft.types.js';
const product = (id = 1, control = true): MuiraSoftProduct => ({
  id,
  descricao: 'Descrição interna que não vai para vitrine',
  ean: 'privado',
  controla_estoque: control,
  preco_venda: '100.00',
  estoque: {
    cadastrado: true,
    fisico: control ? '3.0000' : null,
    politica: 'RESERVA',
    reservado: control ? '1.0000' : null,
    disponivel_para_venda: control ? '2.0000' : null,
    consultado_em: '2026-11-02T12:00:00Z',
  },
  loja: {
    titulo: 'Camiseta',
    descricao: 'Descrição pública',
    categoria: 'Roupas',
    imagens: ['https://images.example.test/sku.png'],
    grupo_variacao: 'modelo-1',
    cor: id === 1 ? 'Verde' : 'Preta',
    tamanho: id === 1 ? 'M' : 'G',
    modalidade: 'MISTA',
    prazo_dias: 7,
  },
});
const config = {
  integrationConfigured: true,
  store: { id: 'fixture' },
} as AppConfig;
let db: { verifyBinding: ReturnType<typeof vi.fn> },
  erp: {
    checkConnection: ReturnType<typeof vi.fn>;
    listProducts: ReturnType<typeof vi.fn>;
    getProduct: ReturnType<typeof vi.fn>;
    productImage: ReturnType<typeof vi.fn>;
  },
  service: CatalogService;
const cart = (items: unknown[]) => ({ store_id: 'fixture', items });
const line = {
  sku_id: 1,
  quantity: 1,
  fulfillment: 'PRONTA_ENTREGA',
  observed_price: '100.00',
};
beforeEach(() => {
  db = { verifyBinding: vi.fn().mockResolvedValue(true) };
  erp = {
    checkConnection: vi.fn().mockResolvedValue({ escopos: ['produtos:ler'] }),
    listProducts: vi
      .fn()
      .mockResolvedValue({ data: [product(), product(2)], next_cursor: null }),
    getProduct: vi.fn().mockResolvedValue(product()),
    productImage: vi.fn().mockResolvedValue({ content: Buffer.from('image'), mime: 'image/png' }),
  };
  service = new CatalogService(
    config,
    db as unknown as DatabaseService,
    erp as unknown as MuiraSoftClient,
  );
});
describe('Vitrine pública e revalidação da sacola', () => {
  it('carrega a imagem do cadastro sem expor a credencial do ERP', async () => {
    const p = product(1, false); p.loja = null; p.imagens = [{ id: 7 }];
    erp.getProduct.mockResolvedValue(p);
    expect(await service.image('1', '7')).toMatchObject({ mime: 'image/png' });
    expect(erp.productImage).toHaveBeenCalledWith(1, 7);
  });
  it('não serve imagem que não pertence ao produto consultável', async () => {
    erp.getProduct.mockResolvedValue({ ...product(), imagens: [{ id: 7 }] });
    await expect(service.image('1', '8')).rejects.toThrow();
    await expect(service.image('../1', '7')).rejects.toThrow();
    expect(erp.productImage).not.toHaveBeenCalled();
  });
  it('agrupa SKUs sem expor descrição interna, EAN ou estoque físico', async () => {
    const r = await service.list({});
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.variants).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain('privado');
    expect(JSON.stringify(r)).not.toContain('Descrição interna');
    expect(JSON.stringify(r)).not.toContain('fisico');
  });
  it('não serve cache quando vínculo da empresa deixou de conferir', async () => {
    await service.list({});
    db.verifyBinding.mockResolvedValue(false);
    await expect(service.list({})).rejects.toThrow();
  });
  it('não serve cache se escopo é removido', async () => {
    await service.list({});
    erp.checkConnection.mockResolvedValue({ escopos: [] });
    await expect(service.list({})).rejects.toThrow();
  });
  it('cor e tamanho devem corresponder ao mesmo SKU', async () => {
    expect(
      (await service.list({ color: 'Verde', size: 'G' })).items,
    ).toHaveLength(0);
    expect(
      (await service.list({ color: 'Preta', size: 'G' })).items,
    ).toHaveLength(1);
  });
  it('consome todas as páginas antes de agrupar variações', async () => {
    erp.listProducts
      .mockResolvedValueOnce({ data: [product()], next_cursor: '1' })
      .mockResolvedValueOnce({ data: [product(2)], next_cursor: null });
    const r = await service.list({});
    expect(r.items[0]?.variants).toHaveLength(2);
    expect(erp.listProducts).toHaveBeenLastCalledWith({
      limit: 100,
      cursor: 1,
    });
  });
  it('recusa cursor que não avança e não devolve catálogo parcial', async () => {
    erp.listProducts.mockResolvedValue({ data: [product()], next_cursor: '1' });
    await expect(service.list({})).rejects.toThrow();
  });
  it('produto cadastrado aparece automaticamente sem publicação separada', () => {
    const p = product();
    delete p.loja;
    p.categoria = 'Cadastro';
    p.imagens = [{ id: 7 }];
    expect(groupProducts([p])[0]).toMatchObject({
      id: 'p_1', title: p.descricao, category: 'Cadastro',
      images: ['/api/v1/catalog/images/1/7'], price_from: '100.00',
    });
  });
  it('revalida a sacola de produto sem publicação e sem controle de estoque', async () => {
    const p = product(1, false); p.loja = null;
    erp.getProduct.mockResolvedValue(p);
    const result = await service.validate(cart([line]));
    expect(result.items[0]).toMatchObject({ status: 'OK', product: { title: p.descricao, max_ready_quantity: null } });
  });
  it('sem foto ou categoria continua consultável, e saldo zero não esconde produto', () => {
    const p = product(); p.loja = null; p.estoque.disponivel_para_venda = '0.0000';
    expect(groupProducts([p])[0]).toMatchObject({ category: 'Sem categoria', images: [], variants: [{ ready_available: false }] });
  });
  it('não confunde falta de saldo com produto sem controle', () => {
    const p = product(1, false);
    expect(variant(p)).toMatchObject({
      ready_available: true,
      max_ready_quantity: null,
    });
  });
  it('pronta entrega controlada exige disponibilidade do ERP', () => {
    const p = product();
    p.estoque.disponivel_para_venda = '0.0000';
    expect(variant(p)).toMatchObject({
      ready_available: false,
      max_ready_quantity: 0,
    });
  });
  it('não usa política legada para garantir pronta entrega', () => {
    const p = product();
    p.estoque.politica = 'SEM_MOVIMENTO';
    expect(variant(p)?.ready_available).toBe(false);
  });
  it('revalida pelo ERP e não usa preço do cache como autoridade', async () => {
    await service.list({});
    const p = product();
    p.preco_venda = '110.00';
    erp.getProduct.mockResolvedValue(p);
    const r = await service.validate(cart([line]));
    expect(r.valid).toBe(false);
    expect(r.total).toBeNull();
    expect(r.items[0]?.status).toBe('PRICE_CHANGED');
    expect(r.items[0]?.product?.price).toBe('110.00');
  });
  it('preço observado não altera o total calculado', async () => {
    const r = await service.validate(
      cart([{ ...line, observed_price: '0.01' }]),
    );
    expect(r.items[0]?.line_total).toBe('100.00');
    expect(r.valid).toBe(false);
  });
  it('quantidade maior que disponível bloqueia sem reduzir silenciosamente', async () => {
    const r = await service.validate(cart([{ ...line, quantity: 3 }]));
    expect(r.items[0]).toMatchObject({
      quantity: 3,
      status: 'QUANTITY_UNAVAILABLE',
    });
  });
  it('sem controle aceita quantidade mesmo com saldo nulo', async () => {
    erp.getProduct.mockResolvedValue(product(1, false));
    const r = await service.validate(cart([{ ...line, quantity: 99 }]));
    expect(r).toMatchObject({ valid: true, total: '9900.00' });
  });
  it('encomenda não exige saldo e preserva prazo', async () => {
    const p = product();
    p.estoque.disponivel_para_venda = '0.0000';
    erp.getProduct.mockResolvedValue(p);
    const r = await service.validate(
      cart([{ ...line, fulfillment: 'ENCOMENDA', quantity: 3 }]),
    );
    expect(r.valid).toBe(true);
    expect(r.items[0]?.product?.production_days).toBe(7);
  });
  it('publicação removida fica explícita sem retirar item automaticamente', async () => {
    erp.getProduct.mockRejectedValue(
      new MuiraSoftError('MUIRASOFT_NOT_FOUND', 404, 'Não encontrado'),
    );
    const r = await service.validate(cart([line]));
    expect(r.items[0]).toMatchObject({
      sku_id: 1,
      status: 'UNPUBLISHED',
      product: null,
    });
    expect(r.total).toBeNull();
  });
  it('falha de rede não vira item excluído ou sacola aprovada', async () => {
    erp.getProduct.mockRejectedValue(new Error('private-key-must-not-leak'));
    await expect(service.validate(cart([line]))).rejects.toThrow(
      'Service Unavailable',
    );
  });
  it('recusa tentativa de escolher empresa, canal ou valor', () => {
    expect(() =>
      cartInput({ ...cart([line]), id_empresa: 2 }, 'fixture'),
    ).toThrow();
    expect(() =>
      cartInput(cart([{ ...line, price: '0.01' }]), 'fixture'),
    ).toThrow();
    expect(() => queryInput({ company: 2 })).toThrow();
  });
  it('recusa sacola de outra loja, SKU duplicado e quantidades inválidas', () => {
    expect(() => cartInput(cart([line]), 'another')).toThrow();
    expect(() => cartInput(cart([line, line]), 'fixture')).toThrow();
    expect(() =>
      cartInput(cart([{ ...line, quantity: 0 }]), 'fixture'),
    ).toThrow();
    expect(() => cartInput(cart(Array(31).fill(line)), 'fixture')).toThrow();
  });
  it('soma decimais sem ruído de ponto flutuante', async () => {
    erp.getProduct.mockImplementation((id: number) => ({
      ...product(id, false),
      preco_venda: id === 1 ? '0.10' : '0.20',
    }));
    const r = await service.validate(
      cart([
        { ...line, observed_price: '0.10' },
        { ...line, sku_id: 2, observed_price: '0.20' },
      ]),
    );
    expect(r.total).toBe('0.30');
  });
  it('rejeita parâmetros repetidos e filtros/paginação malformados', () => {
    expect(() => queryInput({ page: ['1', '2'] })).toThrow();
    expect(() => queryInput({ limit: '100' })).toThrow();
    expect(() => queryInput({ sort: 'sql' })).toThrow();
  });
  it('com cache agrupa requisições de catálogo sem consulta comercial redundante', async () => {
    await Promise.all([service.list({}), service.list({})]);
    expect(erp.listProducts).toHaveBeenCalledTimes(1);
  });
});

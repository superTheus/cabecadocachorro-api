import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/app-config.js';
import { ApiExceptionFilter } from '../src/common/http/api-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { MuiraSoftClient } from '../src/integrations/muirasoft/muirasoft.client.js';
const product = {
  id: 1,
  descricao: 'INTERNAL_DESCRIPTION',
  ean: 'INTERNAL_EAN',
  preco_venda: '99.90',
  controla_estoque: false,
  estoque: {
    cadastrado: true,
    politica: 'RESERVA',
    fisico: null,
    reservado: null,
    disponivel_para_venda: null,
    consultado_em: '2026-11-02T12:00:00Z',
  },
  loja: {
    titulo: 'Produto público',
    descricao: 'Descrição pública',
    categoria: 'Camisetas',
    imagens: ['https://images.example.test/sku.png'],
    grupo_variacao: null,
    cor: 'Verde',
    tamanho: 'M',
    modalidade: 'PRONTA_ENTREGA',
    prazo_dias: null,
  },
};
describe('Catálogo e sacola HTTP sem dados reais', () => {
  let app: INestApplication;
  const erp = {
    checkConnection: vi.fn().mockResolvedValue({ escopos: ['produtos:ler'] }),
    listProducts: vi
      .fn()
      .mockResolvedValue({ data: [product], next_cursor: null }),
    getProduct: vi.fn().mockResolvedValue(product),
  };
  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      MUIRASOFT_BASE_URL: 'https://erp.example.test',
      MUIRASOFT_TOKEN: 'muira_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43),
      MUIRASOFT_COMPANY_ID: '42',
      MUIRASOFT_CHANNEL: 'loja-teste',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(DatabaseService)
      .useValue({ verifyBinding: vi.fn().mockResolvedValue(true) })
      .overrideProvider(MuiraSoftClient)
      .useValue(erp)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('retorna publicação pública sem dados internos do ERP', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/catalog/products')
      .expect(200);
    expect(r.body.items[0]).toMatchObject({
      id: 'p_1',
      title: 'Produto público',
      price_from: '99.90',
    });
    expect(JSON.stringify(r.body)).not.toContain('INTERNAL_');
  });
  it('detalhe é somente produto publicado desta loja', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products/p_1')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products/p_999')
      .expect(404);
  });
  it('não aceita contexto comercial pelo query string', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/products?id_empresa=1')
      .expect(400);
  });
  it('confere sacola sem cadastro, reserva ou pagamento', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({
        store_id: 'cabeca-do-cachorro',
        items: [
          {
            sku_id: 1,
            quantity: 2,
            fulfillment: 'PRONTA_ENTREGA',
            observed_price: '99.90',
          },
        ],
      })
      .expect(200);
    expect(r.body).toMatchObject({ valid: true, total: '199.80' });
    expect(r.body).not.toHaveProperty('order_id');
  });
  it('não aceita preço/empresa adulterados para cobrança', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({
        store_id: 'cabeca-do-cachorro',
        items: [
          {
            sku_id: 1,
            quantity: 1,
            fulfillment: 'PRONTA_ENTREGA',
            total: '0.01',
          },
        ],
      })
      .expect(400);
  });
  it('não expõe pedidos, contas comerciais ou gateway pela nova superfície', async () => {
    for (const path of [
      '/api/v1/pedidos',
      '/api/v1/payments',
      '/api/v1/conexao',
    ])
      await request(app.getHttpServer()).get(path).expect(404);
    await request(app.getHttpServer()).get('/api/v1/orders').expect(401);
  });
  it('indisponibilidade não ecoa erro do provedor', async () => {
    erp.getProduct.mockRejectedValueOnce(new Error('gateway-private-key'));
    const r = await request(app.getHttpServer())
      .post('/api/v1/cart/validate')
      .send({
        store_id: 'cabeca-do-cachorro',
        items: [{ sku_id: 1, quantity: 1, fulfillment: 'PRONTA_ENTREGA' }],
      })
      .expect(503);
    expect(JSON.stringify(r.body)).not.toContain('private-key');
  });
});

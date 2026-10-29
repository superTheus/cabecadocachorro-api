import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createApplication } from '../src/bootstrap.js';
import { AppModule } from '../src/app.module.js';
import { loadConfig } from '../src/config/app-config.js';
import { DatabaseService } from '../src/database/database.service.js';
import { MuiraSoftClient } from '../src/integrations/muirasoft/muirasoft.client.js';

describe('Fundação HTTP', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createApplication(loadConfig({ NODE_ENV: 'test' }));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('liveness não depende de banco ou integração, com identificador próprio', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'identificador-nao-confiavel')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('não anuncia prontidão comercial sem dependências configuradas', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'disabled', muirasoft: 'not_configured' },
    });
  });
  it('não expõe métodos comerciais do adaptador sem autenticação de compradores', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/pedidos/1')
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.request_id).toBe(response.headers['x-request-id']);
  });
  it('permite CORS somente para a origem configurada da loja', async () => {
    const accepted = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(accepted.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    const denied = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('Origin', 'https://outra-loja.example')
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejeita JSON inválido sem stack ou conteúdo técnico', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/health/live')
      .set('Content-Type', 'application/json')
      .send('{invalido')
      .expect(400);
    expect(response.body.code).toBe('BAD_REQUEST');
    expect(response.body).not.toHaveProperty('stack');
    expect(response.body.request_id).toBeDefined();
  });
  it('limita o corpo sem registrar seu conteúdo', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/health/live')
      .send({ value: 'x'.repeat(1024 * 1024 + 1) })
      .expect(413);
    expect(response.body.code).toBe('BODY_TOO_LARGE');
  });
});

describe('Prontidão de dependências', () => {
  it('requer schema, vínculo persistido e contexto remoto válido', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      MUIRASOFT_BASE_URL: 'http://127.0.0.1:4900',
      MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
      MUIRASOFT_COMPANY_ID: '42',
      MUIRASOFT_CHANNEL: 'loja-teste',
    });
    const database = {
      isEnabled: true,
      isHealthy: vi.fn().mockResolvedValue(true),
      verifyBinding: vi.fn().mockResolvedValue(true),
    };
    const client = {
      checkConnection: vi
        .fn()
        .mockResolvedValue({ empresa: 42, canal: 'loja-teste' }),
    };
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .overrideProvider(MuiraSoftClient)
      .useValue(client)
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    try {
      const ready = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);
      expect(ready.body).toEqual({
        status: 'ready',
        checks: { database: 'up', muirasoft: 'up' },
      });
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);
      expect(client.checkConnection).toHaveBeenCalledTimes(1);
      database.verifyBinding.mockResolvedValue(false);
      const currentTime = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(currentTime + 5100);
      const wrongBinding = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(wrongBinding.body.checks.database).toBe('down');
      database.verifyBinding.mockResolvedValue(true);
      client.checkConnection.mockRejectedValue(new Error('segredo remoto'));
      clock.mockReturnValue(currentTime + 10200);
      const failed = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);
      expect(failed.body.checks.muirasoft).toBe('down');
      expect(JSON.stringify(failed.body)).not.toContain('segredo');
    } finally {
      vi.restoreAllMocks();
      await app.close();
    }
  });
});

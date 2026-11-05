import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig } from '../../dist/config/app-config.js';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { createApplication } from '../../dist/bootstrap.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { unseal } from '../../dist/auth/auth.crypto.js';
if (!process.env.DATABASE_TEST_ADMIN_URL) {
  console.log(
    'SKIP: configure DATABASE_TEST_ADMIN_URL para acompanhamento isolado.',
  );
  process.exit(0);
}
let app,
  db,
  admin,
  server,
  created = false,
  checks = 0,
  last = 'inicialização';
const schema = 'orders_test_' + randomBytes(6).toString('hex'),
  orders = new Map(),
  requests = new Map();
let writes = 0,
  loseResponse = true,
  offline = false,
  mutate = null,
  pauseRead = null;
const check = (ok, label) => {
  last = label;
  assert.ok(ok, label);
  checks++;
  console.log('OK:', label);
};
const now = () => new Date().toISOString();
const fiscalId = 'd'.repeat(32),
  pdf = Buffer.from('%PDF-1.4\nDocumento fiscal sintético\n%%EOF');
let fiscalUnavailable = false,
  badFiscalHash = false;
function order(id, number, buyer, quote = null) {
  return {
    buyer,
    id,
    number,
    created_at: now(),
    updated_at: now(),
    canceled_at: null,
    status: 'PRODUCAO',
    status_label: 'Em produção',
    commercial_status: 'Atendimento',
    total: '112.50',
    item_count: 1,
    production_days: 7,
    checkout_reference: quote,
    subtotal: '100.00',
    freight: '12.50',
    items: [
      {
        id: 'item_' + number,
        name: 'Camiseta comprada',
        color: 'Verde',
        size: 'M',
        image: 'https://images.example.test/item.png',
        quantity: '1.0000',
        unit_price: '100.00',
        total: '100.00',
        fulfillment: 'ENCOMENDA',
        production_days: 7,
        internal_notes: 'SEGREDO_INTERNO',
      },
    ],
    delivery: {
      type: 'ENTREGA',
      name: 'Área fixture',
      lead_days: 2,
      pickup_address: null,
      instructions: null,
      address: {
        recipient: 'Comprador fixture',
        postal_code: '69000000',
        street: 'Rua original da compra',
        number: '10',
        complement: '',
        district: 'Centro',
        city: 'Manaus',
        state: 'AM',
        private_note: 'SEGREDO_INTERNO',
      },
      together: true,
    },
    payments: [
      {
        id: 'payment_' + number,
        method: 'PIX',
        installments: 1,
        total: '112.50',
        status: 'AWAITING_PAYMENT',
        paid_at: null,
        refunded_total: '0.00',
        pix_available: true,
        fee: '99.99',
        api_key: 'SEGREDO_INTERNO',
      },
    ],
    timeline: [
      {
        id: 'operation_' + number,
        kind: 'FULFILLMENT',
        label: 'Produção iniciada',
        at: now(),
        observacao: 'SEGREDO_INTERNO',
      },
    ],
    requests: [],
    can_request_cancellation: true,
    can_request_return: false,
    synced_at: now(),
    id_conta: 999,
    excecao_pagamento_motivo: 'SEGREDO_INTERNO',
  };
}
try {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture.test'),
        send = (body, status = 200) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
      let raw = '';
      for await (const b of req) raw += b;
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/integracao/v1/conexao')
        return send({
          nome: 'Tracking fixture',
          empresa: 42,
          canal: 'tracking-test',
          origem: 'LOJA_VIRTUAL',
          estoque_politica: 'RESERVA',
          escopos: [
            'pedidos:ler',
            'pedidos:criar',
            'checkout:ler',
            'checkout:criar',
            'pagamentos:ler',
          ],
        });
      if (offline) return send({}, 503);
      const base = '/integracao/v1/compradores/pedidos';
      const fiscal = url.pathname.match(
        /^\/integracao\/v1\/compradores\/pedidos\/([a-f0-9]{32})\/documentos\/([a-f0-9]{32})\/(pdf|xml)$/,
      );
      if (fiscal) {
        const o = orders.get(fiscal[1]);
        if (
          !o ||
          o.buyer !== url.searchParams.get('referencia_comprador') ||
          o.number !== 1 ||
          fiscal[2] !== fiscalId
        )
          return send({}, 404);
        if (fiscalUnavailable) return send({}, 409);
        const type = fiscal[3],
          data =
            type === 'pdf'
              ? pdf
              : Buffer.from(
                  '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"/>',
                );
        return send({
          filename: `nota-fiscal-${fiscalId}.${type}`,
          mime: type === 'pdf' ? 'application/pdf' : 'application/xml',
          content_base64: data.toString('base64'),
          sha256: badFiscalHash
            ? '0'.repeat(64)
            : createHash('sha256').update(data).digest('hex'),
        });
      }
      if (url.pathname === base) {
        const buyer = url.searchParams.get('referencia_comprador'),
          cursor = url.searchParams.get('cursor'),
          limit = Number(url.searchParams.get('limit'));
        const all = [...orders.values()]
          .filter((o) => o.buyer === buyer)
          .sort((a, b) => b.number - a.number);
        const index = cursor ? all.findIndex((o) => o.id === cursor) + 1 : 0;
        if (cursor && !index) return send({}, 404);
        const page = all.slice(index, index + limit);
        return send({
          items: page,
          next_cursor: index + limit < all.length ? page.at(-1).id : null,
          synced_at: now(),
        });
      }
      const match = url.pathname.match(
        /^\/integracao\/v1\/compradores\/pedidos\/([a-f0-9]{32})(\/solicitacoes)?$/,
      );
      if (!match) return send({}, 404);
      const buyer = match[2]
          ? body.referencia_comprador
          : url.searchParams.get('referencia_comprador'),
        o = orders.get(match[1]);
      if (!o || o.buyer !== buyer) return send({}, 404);
      if (!match[2]) {
        if (pauseRead) {
          const f = pauseRead;
          pauseRead = null;
          await f();
        }
        const copy = structuredClone(o);
        copy.requests = [...requests.values()].filter((v) => v.order === o.id);
        if (mutate) mutate(copy);
        return send(copy);
      }
      const key = req.headers['idempotency-key'];
      if (requests.has(key))
        return send({ id: requests.get(key).id, accepted: true });
      if (body.type === 'CANCELLATION' && !o.can_request_cancellation)
        return send({}, 409);
      const r = {
        id: randomBytes(16).toString('hex'),
        order: o.id,
        type: body.type,
        message: body.message,
        items: body.items,
        status: 'OPEN',
        created_at: now(),
        updated_at: now(),
        responses: [],
        observacao_interna: 'SEGREDO_INTERNO',
      };
      requests.set(key, r);
      writes++;
      if (loseResponse) {
        loseResponse = false;
        req.socket.destroy();
        return;
      }
      return send({ id: r.id, accepted: true });
    } catch {
      res.writeHead(500);
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
  url.pathname = '/';
  admin = await mysql.createConnection(url.href);
  await admin.query(
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  );
  created = true;
  url.pathname = '/' + schema;
  const config = loadConfig({
    NODE_ENV: 'test',
    STORE_ID: 'tracking-store',
    DATABASE_ENABLED: 'true',
    DATABASE_URL: url.href,
    AUTH_ENABLED: 'true',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MUIRASOFT_BASE_URL: 'http://127.0.0.1:' + server.address().port,
    MUIRASOFT_TOKEN: 'muira_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43),
    MUIRASOFT_COMPANY_ID: '42',
    MUIRASOFT_CHANNEL: 'tracking-test',
  });
  db = createDatabaseSource(config);
  await db.initialize();
  await db.runMigrations();
  await db.query(
    'INSERT INTO store_bindings(id,store_id,muirasoft_base_url,muirasoft_company_id,muirasoft_channel) VALUES(?,?,?,?,?)',
    [
      randomUUID(),
      config.store.id,
      config.muirasoft.baseUrl,
      42,
      'tracking-test',
    ],
  );
  app = await createApplication(config);
  await app.init();
  const http = app.getHttpServer(),
    auth = app.get(AuthService),
    origin = config.store.url;
  async function buyer(email) {
    await auth.register(
      { name: 'Comprador fixture', email, password: 'Uma senha forte 123!' },
      'fixture',
    );
    const [mail] = await db.query(
      'SELECT payload_cipher FROM customer_mail_outbox ORDER BY created_at DESC LIMIT 1',
    );
    const data = unseal(mail.payload_cipher, config.auth.key, config.store.id);
    await auth.consume({ token: data.token }, 'fixture', 'verify');
    const login = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password: 'Uma senha forte 123!' });
    return {
      id: login.body.id,
      cookie: login.headers['set-cookie'][0].split(';')[0],
    };
  }
  const a = await buyer('tracking-a@example.test'),
    b = await buyer('tracking-b@example.test');
  const ids = [
      randomBytes(16).toString('hex'),
      randomBytes(16).toString('hex'),
      randomBytes(16).toString('hex'),
    ],
    quote = randomBytes(16).toString('hex'),
    checkout = randomUUID();
  orders.set(ids[0], order(ids[0], 1, 'buyer:tracking-store:' + a.id, quote));
  orders.set(ids[1], order(ids[1], 2, 'buyer:tracking-store:' + a.id));
  orders.set(ids[2], order(ids[2], 3, 'buyer:tracking-store:' + b.id));
  await db.query(
    'INSERT INTO checkout_sessions(id,store_id,customer_id,idempotency_key,fingerprint,payload_cipher,quote_id,upstream_order_id) VALUES(?,?,?,?,?,?,?,?)',
    [
      checkout,
      config.store.id,
      a.id,
      randomUUID(),
      'a'.repeat(64),
      'fixture-not-read',
      quote,
      1,
    ],
  );
  const call = (
    method,
    path,
    body,
    cookie = a.cookie,
    key,
    source = origin,
  ) => {
    let r = request(http)[method]('/api/v1/' + path);
    if (cookie) r = r.set('Cookie', cookie);
    if (source) r = r.set('Origin', source);
    if (key) r = r.set('Idempotency-Key', key);
    return body === undefined ? r : r.send(body);
  };
  let r = await call('get', 'orders', undefined, '');
  check(r.status === 401, 'Histórico exige sessão verificada');
  r = await call('get', 'orders?limit=1');
  check(
    r.status === 200 &&
      r.body.items.length === 1 &&
      r.body.next_cursor === ids[1],
    'Histórico paginado consulta somente identidade derivada da sessão',
  );
  r = await call('get', 'orders?limit=1&cursor=' + r.body.next_cursor);
  check(
    r.status === 200 &&
      r.body.items[0].id === ids[0] &&
      r.body.next_cursor === null,
    'Cursor preserva paginação isolada',
  );
  r = await call('get', 'orders?referencia_comprador=outro');
  check(
    r.status === 400,
    'Query pública não escolhe comprador, conta ou empresa',
  );
  r = await call('get', 'orders/' + ids[2]);
  check(
    r.status === 404,
    'Comprador não consulta ID público de outro comprador',
  );
  r = await call('get', 'orders?cursor=' + ids[2]);
  check(r.status === 404, 'Cursor de outra identidade não enumera pedidos');
  r = await call('get', 'orders/' + ids[0]);
  check(
    r.status === 200 &&
      r.body.checkout_id === checkout &&
      r.body.delivery.address.street === 'Rua original da compra',
    'Detalhe usa snapshot e recupera checkout por vínculo próprio',
  );
  check(
    !JSON.stringify(r.body).includes('SEGREDO_INTERNO') &&
      !JSON.stringify(r.body).includes('fee') &&
      !('checkout_reference' in r.body),
    'Whitelist elimina notas internas, taxas e referências privadas em todos os níveis',
  );
  const fiscalPath = `orders/${ids[0]}/documents/${fiscalId}/pdf`;
  r = await call('get', fiscalPath, undefined, '');
  check(r.status === 401, 'Arquivo fiscal exige sessão verificada');
  r = await call('get', fiscalPath, undefined, b.cookie);
  check(r.status === 404, 'Outro comprador não baixa nota por conhecer IDs');
  r = await call('get', fiscalPath);
  check(
    r.status === 200 &&
      r.headers['content-type'].startsWith('application/pdf') &&
      r.headers['content-disposition'].includes(
        `nota-fiscal-${fiscalId}.pdf`,
      ) &&
      Buffer.compare(r.body, pdf) === 0,
    'Download devolve bytes corretos como anexo, sem URL pública',
  );
  check(
    r.headers['cache-control'] === 'private, no-store' &&
      r.headers['x-content-type-options'] === 'nosniff' &&
      r.headers['content-security-policy'].includes('sandbox'),
    'Download impede cache compartilhado e renderização ativa inline',
  );
  badFiscalHash = true;
  r = await call('get', fiscalPath);
  check(
    r.status === 502,
    'Arquivo adulterado é recusado antes de chegar ao navegador',
  );
  badFiscalHash = false;
  fiscalUnavailable = true;
  r = await call('get', fiscalPath);
  check(
    r.status === 409,
    'Cancelamento posterior invalida download mesmo com página já aberta',
  );
  fiscalUnavailable = false;
  r = await call('get', `orders/${ids[0]}/documents/${fiscalId}/html`);
  check(
    r.status === 404,
    'Formato fora de PDF/XML não abre conteúdo arbitrário',
  );
  const base = 'orders/' + ids[0] + '/requests',
    body = {
      type: 'CANCELLATION',
      message: 'Solicitação cifrada do comprador',
      items: [],
    },
    key = randomUUID();
  r = await call('post', base, body, a.cookie, key, 'https://evil.example');
  check(
    r.status === 403 && writes === 0,
    'Origem de terceiro não envia solicitação',
  );
  r = await call('post', base, { ...body, customer_id: b.id }, a.cookie, key);
  check(
    r.status === 400 && writes === 0,
    'Payload não substitui titular da solicitação',
  );
  r = await call('post', base, body, a.cookie, key);
  const pending = r.body.id;
  check(
    r.status === 202 && r.body.delivery === 'PENDING' && writes === 1,
    'Resposta perdida preserva intenção cifrada antes da rede',
  );
  r = await call('get', 'orders/' + ids[0]);
  check(
    r.status === 200 &&
      r.body.requests.length === 1 &&
      r.body.pending_requests[0].id === pending,
    'Histórico recupera pedido e mostra envio pendente após perda da resposta',
  );
  r = await call('post', base + '/' + pending + '/retry', {});
  check(
    r.status === 202 && r.body.delivery === 'SENT' && writes === 1,
    'Retomar usa a mesma chave, sem duplicar solicitação no ERP',
  );
  r = await call('post', base, body, a.cookie, key);
  check(
    r.status === 202 && r.body.delivery === 'SENT' && writes === 1,
    'Repetição local retorna envio confirmado sem nova solicitação',
  );
  r = await call('post', base, { ...body, message: 'Alterada' }, a.cookie, key);
  check(
    r.status === 409 && writes === 1,
    'Chave usada com outra mensagem não sobrescreve pedido de atendimento',
  );
  r = await call('post', base + '/' + pending + '/retry', {}, b.cookie);
  check(r.status === 404, 'Outro comprador não retoma intenção conhecida');
  const [saved] = await db.query(
    'SELECT * FROM customer_order_requests WHERE id=?',
    [pending],
  );
  check(
    !JSON.stringify(saved).includes(body.message) &&
      unseal(
        saved.payload_cipher,
        config.auth.key,
        config.store.id,
        'order-request:' + pending,
      ).message === body.message,
    'Mensagem fica cifrada localmente com contexto próprio',
  );
  const remote = [...requests.values()][0];
  remote.status = 'ANSWERED';
  remote.responses = [
    {
      status: 'ANSWERED',
      message: 'Resposta destinada ao comprador',
      created_at: now(),
      observacao_interna: 'SEGREDO_INTERNO',
      usuario: 'Funcionário privado',
    },
  ];
  r = await call('get', 'orders/' + ids[0]);
  check(
    r.status === 200 &&
      r.body.requests[0].responses[0].message === remote.responses[0].message &&
      !JSON.stringify(r.body).includes('SEGREDO_INTERNO') &&
      !JSON.stringify(r.body).includes('Funcionário privado'),
    'Respostas públicas são exibidas sem notas ou identificação interna',
  );
  mutate = (o) => {
    o.total = '0.01';
  };
  r = await call('get', 'orders/' + ids[0]);
  check(r.status === 502, 'Totais divergentes recusam projeção remota');
  mutate = null;
  offline = true;
  r = await call('get', 'orders');
  check(
    r.status === 502,
    'Indisponibilidade retorna erro recuperável, sem histórico vazio fictício',
  );
  offline = false;
  await db.query(
    'UPDATE store_bindings SET muirasoft_company_id=99 WHERE store_id=?',
    [config.store.id],
  );
  r = await call('get', 'orders');
  check(
    r.status === 503,
    'Mudança no vínculo persistido bloqueia acompanhamento',
  );
  await db.query(
    'UPDATE store_bindings SET muirasoft_company_id=42 WHERE store_id=?',
    [config.store.id],
  );
  let entered, release;
  const paused = new Promise((resolve) => (entered = resolve)),
    gate = new Promise((resolve) => (release = resolve));
  pauseRead = async () => {
    entered();
    await gate;
  };
  const before = writes;
  const waiting = call(
    'post',
    'orders/' + ids[2] + '/requests',
    { type: 'SUPPORT', message: 'Sessão revogada durante consulta', items: [] },
    b.cookie,
    randomUUID(),
  ).then((r) => r);
  await paused;
  await call('post', 'auth/logout', {}, b.cookie);
  release();
  r = await waiting;
  check(
    r.status === 401 && writes === before,
    'Logout durante preflight impede aceitar nova solicitação',
  );
  await call('post', 'auth/logout', {});
  r = await call('get', 'orders/' + ids[0]);
  check(r.status === 401, 'Sessão revogada não consulta histórico anterior');
  console.log(
    `OK: ${checks} verificações HTTP/MySQL de acompanhamento, sem gateway ou e-mail externo.`,
  );
} catch {
  console.error(
    `FALHA: acompanhamento isolado após ${checks} verificações (${last}).`,
  );
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin) {
    if (created) await admin.query(`DROP DATABASE \`${schema}\``);
    await admin.end();
  }
  if (server) await new Promise((resolve) => server.close(resolve));
}

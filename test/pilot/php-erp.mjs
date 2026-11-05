import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig } from '../../dist/config/app-config.js';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { createApplication } from '../../dist/bootstrap.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { unseal } from '../../dist/auth/auth.crypto.js';
const tests = [];
let stage = 'inicialização',
  app,
  db,
  admin,
  erp,
  created = false;
const apiSchema = 'pilot_test_' + randomBytes(6).toString('hex');
function check(condition, label) {
  stage = label;
  if (!condition) throw new Error(label);
  tests.push(label);
}
try {
  stage = 'configuração isolada';
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (
    !/^integracoes_test_[a-f0-9]{12}$/.test(input.erp_schema) ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(input.base_url)
  )
    throw new Error('Escopo não efêmero.');
  process.loadEnvFile('../../muirasoft/back/.env');
  if (input.erp_schema === process.env.DB_NAME)
    throw new Error('Banco de aplicação não permitido.');
  stage = 'bancos temporários';
  admin = await mysql.createConnection({
    host: input.host,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || '',
  });
  await admin.query(
    `CREATE DATABASE \`${apiSchema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  );
  created = true;
  const url = new URL('mysql://127.0.0.1/' + apiSchema);
  url.username = process.env.DB_USER;
  url.password = process.env.DB_PASS || '';
  erp = await mysql.createConnection({
    host: input.host,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || '',
    database: input.erp_schema,
  });
  stage = 'configuração da API';
  const config = loadConfig({
    NODE_ENV: 'test',
    STORE_ID: 'bridge-store',
    DATABASE_ENABLED: 'true',
    DATABASE_URL: url.href,
    AUTH_ENABLED: 'true',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MUIRASOFT_BASE_URL: input.base_url,
    MUIRASOFT_TOKEN: input.token,
    MUIRASOFT_COMPANY_ID: String(input.company),
    MUIRASOFT_CHANNEL: input.channel,
  });
  db = createDatabaseSource(config);
  await db.initialize();
  await db.runMigrations();
  await db.query(
    'INSERT INTO store_bindings(id,store_id,muirasoft_base_url,muirasoft_company_id,muirasoft_channel) VALUES(?,?,?,?,?)',
    [
      randomUUID(),
      config.store.id,
      input.base_url,
      input.company,
      input.channel,
    ],
  );
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (!String(url).startsWith(input.base_url + '/integracao/v1/'))
      throw new Error('Rede externa recusada no piloto isolado.');
    return nativeFetch(url, options);
  };
  stage = 'inicialização NestJS';
  app = await createApplication(config);
  await app.init();
  const http = app.getHttpServer(),
    auth = app.get(AuthService),
    origin = config.store.url;
  async function buyer(email) {
    await auth.register(
      { name: 'Comprador da ponte', email, password: 'Uma senha forte 123!' },
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
    if (login.status !== 200) throw new Error('Login da ponte.');
    return {
      id: login.body.id,
      cookie: login.headers['set-cookie'][0].split(';')[0],
    };
  }
  stage = 'contas verificadas de teste';
  const a = await buyer('original-fiscal@example.test'),
    b = await buyer('outra-conta-ponte@example.test');
  stage = 'vínculo da fixture fiscal';
  const [[p]] = await erp.query(
    "SELECT p.* FROM pedidos p WHERE p.referencia_externa='fiscal-loja-fixture' AND p.id_integracao=?",
    [input.connection],
  );
  if (!p) throw new Error('Fixture fiscal ausente.');
  const snapshot =
      typeof p.cliente_snapshot === 'string'
        ? JSON.parse(p.cliente_snapshot)
        : p.cliente_snapshot,
    oldReference = snapshot.referencia_externa;
  snapshot.referencia_externa = 'buyer:' + config.store.id + ':' + a.id;
  await erp.query(
    'UPDATE integracoes_clientes SET referencia_externa=? WHERE id_conexao=? AND id_cliente=? AND referencia_externa=?',
    [snapshot.referencia_externa, input.connection, p.id_cliente, oldReference],
  );
  await erp.query('UPDATE pedidos SET cliente_snapshot=? WHERE id=?', [
    JSON.stringify(snapshot),
    p.id,
  ]);
  const [[doc]] = await erp.query(
    'SELECT f.public_id,d.id,d.pdf_base64 FROM pedido_fiscal_publicacoes f JOIN fiscal_documentos d ON d.id=f.id_documento WHERE f.id_pedido=?',
    [p.id],
  );
  const call = (method, path, body, cookie = a.cookie, key) => {
    let r = request(http)
      [method]('/api/v1/' + path)
      .set('Origin', origin);
    if (cookie) r = r.set('Cookie', cookie);
    if (key) r = r.set('Idempotency-Key', key);
    return body === undefined ? r : r.send(body);
  };
  stage = 'consulta real do catálogo';
  let r = await call('get', 'catalog/products');
  check(
    r.status === 200 && r.body.items.length > 0,
    'Ponte real: vitrine NestJS lê publicações do PHP',
  );
  r = await call('get', 'orders');
  check(
    r.status === 200 && r.body.items.some((i) => i.id === p.loja_public_id),
    'Ponte real: conta verificada localiza histórico por identidade estável',
  );
  r = await call('get', 'orders/' + p.loja_public_id);
  check(
    r.status === 200 &&
      r.body.documents.some((d) => d.id === doc.public_id && d.downloadable),
    'Ponte real: documento autorizado aparece na conta correta',
  );
  r = await call(
    'get',
    `orders/${p.loja_public_id}/documents/${doc.public_id}/pdf`,
  );
  const expected = Buffer.from(doc.pdf_base64, 'base64');
  if (r.status !== 200) {
    const diagnostic = await nativeFetch(
      input.base_url +
        `/integracao/v1/compradores/pedidos/${p.loja_public_id}/documentos/${doc.public_id}/pdf?referencia_comprador=` +
        encodeURIComponent(snapshot.referencia_externa),
      { headers: { Authorization: 'Bearer ' + input.token } },
    );
    const text = await diagnostic.text();
    stage =
      'arquivo fiscal: HTTP ' +
      diagnostic.status +
      ', controller=' +
      (text.includes('request_id') ? 'sim' : 'não') +
      ', arquivo=' +
      (text.includes('Arquivo não encontrado') ? 'ausente' : 'outro') +
      ', pedido=' +
      (text.includes('Pedido não encontrado') ? 'ausente' : 'presente');
    throw new Error(stage);
  }
  check(r.status === 200, 'Ponte real: transporte fiscal HTTP ' + r.status);
  check(
    r.status === 200 &&
      createHash('sha256').update(r.body).digest('hex') ===
        createHash('sha256').update(expected).digest('hex'),
    'Ponte real: bytes fiscais atravessam PHP e NestJS sem alteração',
  );
  r = await call(
    'get',
    `orders/${p.loja_public_id}/documents/${doc.public_id}/xml`,
    undefined,
    b.cookie,
  );
  check(r.status === 404, 'Ponte real: outra conta não baixa XML do comprador');
  const key = randomUUID(),
    body = {
      type: 'SUPPORT',
      message: 'Solicitação da ponte real de teste',
      items: [],
    };
  r = await call(
    'post',
    `orders/${p.loja_public_id}/requests`,
    body,
    a.cookie,
    key,
  );
  check(
    r.status === 202 && r.body.delivery === 'SENT',
    'Ponte real: solicitação chega ao ERP sem efeito comercial automático',
  );
  await call(
    'post',
    `orders/${p.loja_public_id}/requests`,
    body,
    a.cookie,
    key,
  );
  const [[count]] = await erp.query(
    'SELECT COUNT(*) n FROM pedido_solicitacoes_loja WHERE id_pedido=? AND mensagem=?',
    [p.id, body.message],
  );
  check(
    Number(count.n) === 1,
    'Ponte real: repetição HTTP não duplica solicitação',
  );
  await call('put', 'auth/profile', {
    name: 'Comprador da ponte',
    phone: '92999999999',
  });
  const address = await call('post', 'auth/addresses', {
    label: 'Casa fixture',
    recipient: 'Comprador',
    postal_code: '69000000',
    street: 'Rua da ponte',
    number: '10',
    complement: '',
    district: 'Centro',
    city: 'Manaus',
    state: 'AM',
  });
  const [[sku]] = await erp.query(
    "SELECT c.id_produto FROM integracoes_catalogo c JOIN produtos p ON p.id=c.id_produto WHERE c.id_conexao=? AND c.publicado='S' AND c.modalidade='PRONTA_ENTREGA' AND p.controla_estoque='N' LIMIT 1",
    [input.connection],
  );
  r = await call(
    'post',
    'checkout',
    {
      address_id: address.body.id,
      document: '11144477735',
      delivery_type: 'ENTREGA',
      items: [
        { sku_id: sku.id_produto, quantity: 1, fulfillment: 'PRONTA_ENTREGA' },
      ],
    },
    a.cookie,
    randomUUID(),
  );
  check(
    r.status === 200 && r.body.review.frete === '15.00' && r.body.review.total,
    'Ponte real: checkout calcula revisão e entrega no ERP',
  );
  const checkout = r.body.id;
  r = await call('post', `checkout/${checkout}/confirm`, { accepted: true });
  check(
    r.status === 200 && r.body.ordered,
    'Ponte real: confirmação cria pedido sem acionar gateway',
  );
  r = await call('get', 'orders');
  check(
    r.status === 200 && r.body.items.length === 2,
    'Ponte real: nova compra aparece no histórico sem depender do navegador',
  );
  const [[payments]] = await erp.query(
    'SELECT COUNT(*) n FROM loja_pagamentos lp JOIN pedidos p ON p.id=lp.id_pedido WHERE p.cliente_snapshot LIKE ?',
    ['%' + a.id + '%'],
  );
  check(
    Number(payments.n) === 0,
    'Ponte real: leitura e confirmação comercial não fabricam pagamento',
  );
  await erp.query(
    "UPDATE fiscal_documentos SET status='CANCELADO' WHERE id=?",
    [doc.id],
  );
  r = await call(
    'get',
    `orders/${p.loja_public_id}/documents/${doc.public_id}/pdf`,
  );
  check(
    r.status === 409,
    'Ponte real: cancelamento no ERP revoga download pela API',
  );
  await call('post', 'auth/logout', {});
  r = await call('get', 'orders');
  check(
    r.status === 401,
    'Ponte real: sessão encerrada perde acesso ao histórico',
  );
  process.stdout.write(JSON.stringify({ ok: true, tests }));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, stage }));
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (erp) await erp.end();
  if (admin) {
    if (created) await admin.query(`DROP DATABASE \`${apiSchema}\``);
    await admin.end();
  }
}

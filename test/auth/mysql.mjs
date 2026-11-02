import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig } from '../../dist/config/app-config.js';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { createApplication } from '../../dist/bootstrap.js';
import { unseal, digest } from '../../dist/auth/auth.crypto.js';
import { AuthMailWorker } from '../../dist/auth/auth-mail.worker.js';
import { AuthService } from '../../dist/auth/auth.service.js';
const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
if (!adminUrl) {
  console.log(
    'SKIP: configure DATABASE_TEST_ADMIN_URL para os testes de conta isolados.',
  );
  process.exit(0);
}
const schema = 'customer_auth_test_' + randomBytes(8).toString('hex'),
  origin = 'http://localhost:5173';
let admin,
  db,
  app,
  checks = 0;
const check = (ok, name) => {
  assert.ok(ok, name);
  checks++;
  console.log('OK:', name);
};
try {
  const server = new URL(adminUrl);
  server.pathname = '/';
  admin = await mysql.createConnection(server.href);
  await admin.query(
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  );
  server.pathname = '/' + schema;
  const config = loadConfig({
    NODE_ENV: 'test',
    STORE_ID: 'loja-teste',
    DATABASE_ENABLED: 'true',
    DATABASE_URL: server.href,
    AUTH_ENABLED: 'true',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MUIRASOFT_BASE_URL: 'https://erp.example.test',
    MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
    MUIRASOFT_COMPANY_ID: '42',
    MUIRASOFT_CHANNEL: 'test',
  });
  db = createDatabaseSource(config);
  await db.initialize();
  await db.runMigrations();
  await db.query(
    'INSERT INTO store_bindings(id,store_id,muirasoft_base_url,muirasoft_company_id,muirasoft_channel) VALUES(?,?,?,?,?)',
    [randomUUID(), config.store.id, config.muirasoft.baseUrl, 42, 'test'],
  );
  app = await createApplication(config);
  await app.init();
  const http = app.getHttpServer(),
    agent = request.agent(http),
    second = request.agent(http);
  const post = (path, data, client = agent) =>
    client
      .post('/api/v1/auth/' + path)
      .set('Origin', origin)
      .send(data);
  const payload = {
    name: 'Comprador fixture',
    email: 'comprador@example.test',
    password: 'Uma senha longa 123!',
  };
  const clearRate = () => db.query('DELETE FROM customer_rate_limits');
  const latest = async () => {
    const rows = await db.query(
      'SELECT * FROM customer_mail_outbox ORDER BY created_at DESC,id DESC LIMIT 1',
    );
    return {
      row: rows[0],
      payload: unseal(rows[0].payload_cipher, config.auth.key, config.store.id),
    };
  };
  await request(http)
    .post('/api/v1/auth/register')
    .set('Origin', 'https://evil.example')
    .send(payload)
    .expect(403);
  check(
    true,
    'Origem externa não pode cadastrar ou executar ações autenticadas',
  );
  await post('register', { ...payload, id_conta: 1 }).expect(400);
  await post('register', { ...payload, password: 'curta' }).expect(400);
  check(true, 'Validação rejeita campos extras e senha curta');
  const reg = await post('register', payload).expect(202);
  check(
    !JSON.stringify(reg.body).includes('token'),
    'Cadastro não devolve token nem senha',
  );
  const user = (await db.query('SELECT * FROM customers'))[0];
  check(
    user.password_hash.startsWith('scrypt$') &&
      !user.password_hash.includes(payload.password),
    'Senha é persistida com scrypt e salt',
  );
  const first = await latest();
  check(
    !first.row.payload_cipher.includes(first.payload.token) &&
      !first.row.payload_cipher.includes(payload.email),
    'Outbox protege token e destinatário com cifra autenticada',
  );
  await post('register', payload).expect(202);
  check(
    (await db.query('SELECT * FROM customers')).length === 1 &&
      (await db.query('SELECT * FROM customer_mail_outbox')).length === 1,
    'Cadastro repetido não altera a conta nem duplica a mensagem',
  );
  await post('login', {
    email: payload.email,
    password: payload.password,
  }).expect(401);
  check(true, 'Login exige confirmação do e-mail');
  const confirmations = await Promise.all([
    post('verify-email', { token: first.payload.token }),
    post('verify-email', { token: first.payload.token }),
  ]);
  check(
    confirmations
      .map((r) => r.status)
      .sort((a, b) => a - b)
      .join(',') === '200,400',
    'Confirmação concorrente consome o token somente uma vez',
  );
  await post('verify-email', { token: first.payload.token }).expect(400);
  await clearRate();
  const logged = await post('login', {
    email: payload.email,
    password: payload.password,
  }).expect(200);
  const cookie = logged.headers['set-cookie'][0];
  check(
    cookie.includes('HttpOnly') &&
      cookie.includes('SameSite=Lax') &&
      !JSON.stringify(logged.body).includes('password_hash'),
    'Login emite cookie protegido e perfil sem segredo',
  );
  await agent.get('/api/v1/auth/me').expect(200);
  await request(http).get('/api/v1/auth/me').expect(401);
  check(true, 'Perfil requer sessão válida');
  const wrongStore = new AuthService(
    loadConfig({
      NODE_ENV: 'test',
      STORE_ID: 'outra-loja',
      DATABASE_ENABLED: 'true',
      DATABASE_URL: server.href,
      AUTH_ENABLED: 'true',
      AUTH_ENCRYPTION_KEY: config.auth.key,
    }),
    { connection: db },
  );
  await assert.rejects(() =>
    wrongStore.me(cookie.match(/cabeca_session=([^;]+)/)[1]),
  );
  check(true, 'Sessão de uma loja não autentica em outra');
  const unknown = await post('forgot-password', {
    email: 'ausente@example.test',
  }).expect(202);
  const known = await post('forgot-password', { email: payload.email }).expect(
    202,
  );
  check(
    JSON.stringify(known.body) === JSON.stringify(unknown.body),
    'Recuperação não revela existência do e-mail',
  );
  const reset = await latest();
  await post('reset-password', {
    token: first.payload.token,
    password: 'Outra senha longa 123!',
  }).expect(400);
  check(true, 'Token de confirmação não serve como recuperação');
  await post('reset-password', {
    token: reset.payload.token,
    password: 'Outra senha longa 123!',
  }).expect(200);
  await agent.get('/api/v1/auth/me').expect(401);
  await post('reset-password', {
    token: reset.payload.token,
    password: 'Outra senha longa 123!',
  }).expect(400);
  check(true, 'Reset revoga sessões e não permite reutilizar token');
  await clearRate();
  await post('login', {
    email: payload.email,
    password: payload.password,
  }).expect(401);
  await post('login', {
    email: payload.email,
    password: 'Outra senha longa 123!',
  }).expect(200);
  check(true, 'Somente a nova senha autentica após reset');
  await post(
    'login',
    { email: payload.email, password: 'Outra senha longa 123!' },
    second,
  ).expect(200);
  await post('change-password', {
    current_password: 'errada',
    password: 'Terceira senha longa 123!',
  }).expect(401);
  await post('change-password', {
    current_password: 'Outra senha longa 123!',
    password: 'Terceira senha longa 123!',
  }).expect(200);
  await second.get('/api/v1/auth/me').expect(401);
  check(true, 'Alteração exige senha atual e revoga inclusive outras sessões');
  await clearRate();
  await post('login', {
    email: payload.email,
    password: 'Terceira senha longa 123!',
  }).expect(200);
  await post('logout', {}).expect(200);
  await agent.get('/api/v1/auth/me').expect(401);
  check(true, 'Logout revoga a sessão persistida');
  await post('forgot-password', { email: payload.email }).expect(202);
  const expired = await latest();
  await db.query(
    'UPDATE customer_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE token_hash=?',
    [digest(expired.payload.token)],
  );
  await post('reset-password', {
    token: expired.payload.token,
    password: 'Outra senha longa 123!',
  }).expect(400);
  check(true, 'Token expirado é recusado');
  await clearRate();
  await post('forgot-password', { email: payload.email }).expect(202);
  const fresh = await latest();
  let calls = 0,
    seen = [];
  const unbound = new AuthMailWorker(
    db,
    loadConfig({
      NODE_ENV: 'test',
      STORE_ID: config.store.id,
      DATABASE_ENABLED: 'true',
      DATABASE_URL: server.href,
      AUTH_ENABLED: 'true',
      AUTH_ENCRYPTION_KEY: config.auth.key,
    }),
    {
      async sendCustomerEmail() {
        throw new Error('Não deveria enviar.');
      },
    },
  );
  await assert.rejects(() => unbound.runOne());
  check(
    (
      await db.query('SELECT attempts FROM customer_mail_outbox WHERE id=?', [
        fresh.row.id,
      ])
    )[0].attempts === 0,
    'Empresa/conexão ausente não consome tentativas da fila nem envia mensagens',
  );
  const worker = new AuthMailWorker(db, config, {
    async sendCustomerEmail(body, key) {
      calls++;
      seen.push({ body, key });
      if (calls === 1) throw new Error('ERP fora');
    },
  });
  // Old, consumed tokens expire without being sent; only the current token reaches the upstream.
  for (let i = 0; i < 10; i++) if (!(await worker.runOne())) break;
  check(
    calls === 1,
    'Somente token vigente chega ao transporte; falha do ERP não cancela conta',
  );
  await db.query(
    "UPDATE customer_mail_outbox SET next_at=UTC_TIMESTAMP(6) WHERE state='PENDING'",
  );
  await worker.runOne();
  check(
    calls === 2 &&
      seen[0].key === seen[1].key &&
      seen[1].body.token === fresh.payload.token,
    'Retentativa ao MuiraSoft conserva evento e token para idempotência',
  );
  const dispatched = (
    await db.query('SELECT * FROM customer_mail_outbox WHERE id=?', [
      fresh.row.id,
    ])
  )[0];
  check(
    dispatched.state === 'QUEUED' && dispatched.payload_cipher === '',
    'Outbox apaga token cifrado após confirmação de enfileiramento no ERP',
  );
  await clearRate();
  for (let i = 0; i < 9; i++) {
    const response = await post('forgot-password', {
      email: 'rate@example.test',
    });
    if (i === 8)
      check(response.status === 429, 'Limite por e-mail persiste no banco');
  }
  await clearRate();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const postman = spawn(
    'postman',
    [
      'collection',
      'run',
      'postman/collections/customer-account.postman_collection.json',
      '--env-var',
      'base_url=http://127.0.0.1:' + address.port,
      '--env-var',
      'store_origin=' + origin,
      '--reporters',
      'cli',
      '--timeout-request',
      '5000',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let report = '';
  postman.stdout.on('data', (data) => (report += data));
  postman.stderr.on('data', () => {});
  const code = await new Promise((resolve, reject) => {
    postman.on('exit', resolve);
    postman.on('error', reject);
  });
  check(
    code === 0,
    'Coleção Postman: seis asserções HTTP em endpoints de conta sem criar usuários',
  );
  console.log(
    'Concluído:',
    checks,
    'verificações HTTP/MySQL de conta e outbox.',
  );
} finally {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
}

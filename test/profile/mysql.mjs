import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig } from '../../dist/config/app-config.js';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { createApplication } from '../../dist/bootstrap.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { unseal } from '../../dist/auth/auth.crypto.js';
const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
if (!adminUrl) {
  console.log(
    'SKIP: configure DATABASE_TEST_ADMIN_URL para teste isolado de perfil.',
  );
  process.exit(0);
}
const schema = 'customer_profile_test_' + randomBytes(8).toString('hex');
let admin,
  db,
  app,
  otherApp,
  created = false,
  checks = 0;
const check = (ok, label) => {
  assert.ok(ok, label);
  checks++;
  console.log('OK:', label);
};
try {
  const server = new URL(adminUrl);
  server.pathname = '/';
  admin = await mysql.createConnection(server.href);
  await admin.query(
    'CREATE DATABASE `' +
      schema +
      '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin',
  );
  created = true;
  server.pathname = '/' + schema;
  const env = {
    NODE_ENV: 'test',
    STORE_ID: 'profile-store',
    DATABASE_ENABLED: 'true',
    DATABASE_URL: server.href,
    AUTH_ENABLED: 'true',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  const config = loadConfig(env);
  db = createDatabaseSource(config);
  await db.initialize();
  await db.runMigrations();
  app = await createApplication(config);
  await app.init();
  const http = app.getHttpServer(),
    origin = config.store.url;
  const auth = app.get(AuthService);
  async function buyer(email) {
    const password = 'Uma senha forte 123!';
    await auth.register(
      { name: 'Comprador fixture', email, password },
      'fixture',
    );
    const rows = await db.query(
      'SELECT payload_cipher FROM customer_mail_outbox ORDER BY created_at DESC LIMIT 1',
    );
    const payload = unseal(
      rows[0].payload_cipher,
      config.auth.key,
      config.store.id,
    );
    await auth.consume({ token: payload.token }, 'fixture', 'verify');
    const login = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    return {
      cookie: login.headers['set-cookie'][0].split(';')[0],
      user: login.body,
    };
  }
  const a = await buyer('a@example.test'),
    b = await buyer('b@example.test');
  function req(method, path, body, cookie = a.cookie, source = origin) {
    let r = request(http)[method]('/api/v1/auth/' + path);
    if (cookie) r = r.set('Cookie', cookie);
    if (source) r = r.set('Origin', source);
    return body === undefined ? r : r.send(body);
  }
  const address = {
    label: 'Casa',
    recipient: 'Comprador',
    postal_code: '69000000',
    street: 'Rua de teste',
    number: '12',
    complement: '',
    district: 'Centro',
    city: 'Manaus',
    state: 'AM',
  };
  await req('get', 'addresses', undefined, '').expect(401);
  await req(
    'put',
    'profile',
    { name: 'Teste', phone: '' },
    a.cookie,
    'https://evil.example',
  ).expect(403);
  await req('post', 'addresses', address, a.cookie, '').expect(403);
  check(true, 'Sessão e Origin obrigatórios para alterações');
  await req('put', 'profile', {
    name: 'Teste',
    phone: '',
    email: 'outro@example.test',
  }).expect(400);
  await req('put', 'profile', { name: ' ', phone: '' }).expect(400);
  await req('put', 'profile', { name: 'Teste', phone: 'abc' }).expect(400);
  const profile = await req('put', 'profile', {
    name: ' Nome atualizado ',
    phone: '(92) 99999-1234',
  }).expect(200);
  check(
    profile.body.name === 'Nome atualizado' &&
      profile.body.phone === '92999991234' &&
      profile.body.email === a.user.email &&
      !profile.body.password_hash,
    'Perfil persiste nome/telefone e protege e-mail e segredos',
  );
  check(
    (await req('get', 'me').expect(200)).body.phone === '92999991234',
    'Perfil persiste entre requisições',
  );
  for (const invalid of [
    { ...address, postal_code: '123' },
    { ...address, state: 'ZZ' },
    { ...address, street: '' },
    { ...address, customer_id: b.user.id },
    { ...address, label: 'x'.repeat(51) },
    { ...address, city: 'Manaus\n' },
  ])
    await req('post', 'addresses', invalid).expect(400);
  check(
    true,
    'Endereço rejeita CEP/UF inválidos, campos extras, limites e controles',
  );
  // Two concurrent first inserts must still produce exactly one default.
  const first = await Promise.all([
    req('post', 'addresses', address).expect(201),
    req('post', 'addresses', { ...address, label: 'Trabalho' }).expect(201),
  ]);
  const [one, two] = first.map((r) => r.body.id);
  let list = (await req('get', 'addresses').expect(200)).body;
  check(
    list.length === 2 && list.filter((x) => x.is_default).length === 1,
    'Criação concorrente escolhe exatamente um primeiro endereço padrão',
  );
  for (const path of ['addresses/' + one, 'addresses/' + one + '/default'])
    await req(
      'put',
      path,
      path.endsWith('default') ? {} : address,
      b.cookie,
    ).expect(404);
  await req('delete', 'addresses/' + one, undefined, b.cookie).expect(404);
  check(
    (await req('get', 'addresses', undefined, b.cookie).expect(200)).body
      .length === 0,
    'IDOR: outro comprador não lê, altera, promove ou exclui endereço',
  );
  await req('put', 'addresses/' + one, {
    ...address,
    street: 'Rua atualizada',
  }).expect(200);
  check(
    (await req('get', 'addresses').expect(200)).body.find((x) => x.id === one)
      .street === 'Rua atualizada',
    'Edição de endereço persiste',
  );
  await Promise.all([
    req('put', 'addresses/' + one + '/default', {}).expect(200),
    req('put', 'addresses/' + two + '/default', {}).expect(200),
  ]);
  list = (await req('get', 'addresses').expect(200)).body;
  check(
    list.filter((x) => x.is_default).length === 1,
    'Trocas concorrentes mantêm um único padrão',
  );
  const def = list.find((x) => x.is_default).id;
  await req('delete', 'addresses/' + def).expect(200);
  list = (await req('get', 'addresses').expect(200)).body;
  check(
    list.length === 1 && !!list[0].is_default,
    'Excluir padrão promove endereço restante',
  );
  const remaining = list[0].id;
  await Promise.all([
    req('delete', 'addresses/' + remaining).expect(200),
    req('post', 'addresses', address).expect(201),
  ]);
  list = (await req('get', 'addresses').expect(200)).body;
  check(
    list.length === 1 && !!list[0].is_default,
    'Criação e exclusão concorrentes preservam padrão',
  );
  await req('delete', 'addresses/' + list[0].id).expect(200);
  check(
    (await req('get', 'addresses').expect(200)).body.length === 0,
    'Último endereço pode ser excluído',
  );
  await req('delete', 'addresses/' + one).expect(404);
  otherApp = await createApplication(
    loadConfig({ ...env, STORE_ID: 'different-store' }),
  );
  await otherApp.init();
  await request(otherApp.getHttpServer())
    .get('/api/v1/auth/addresses')
    .set('Cookie', a.cookie)
    .expect(401);
  check(true, 'Sessão de outra loja não dá acesso a endereços');
  for (let i = 0; i < 20; i++)
    await req('post', 'addresses', address).expect(201);
  await req('post', 'addresses', address).expect(409);
  check(
    (await req('get', 'addresses').expect(200)).body.length === 20,
    'Limite persistente de 20 endereços',
  );
  await req('post', 'logout', {}).expect(200);
  await req('put', 'profile', { name: 'Teste', phone: '' }).expect(401);
  await req('post', 'addresses', address).expect(401);
  check(true, 'Sessão revogada não altera perfil nem endereços');
  await otherApp.close();
  otherApp = null;
  await app.close();
  app = null;
  await db.undoLastMigration();
  check(
    (await db.query("SHOW COLUMNS FROM customers LIKE 'phone'")).length === 0,
    'Reversão remove extensão de perfil',
  );
  check(
    (await db.runMigrations()).length === 1,
    'Migration pode ser reaplicada após reversão em fixture',
  );
  console.log(
    'Concluído:',
    checks,
    'verificações de perfil e endereços em schema efêmero.',
  );
} finally {
  await otherApp?.close();
  await app?.close();
  if (db?.isInitialized) await db.destroy();
  if (admin) {
    if (created) await admin.query('DROP DATABASE `' + schema + '`');
    await admin.end();
  }
}

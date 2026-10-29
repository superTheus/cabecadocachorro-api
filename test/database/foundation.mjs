import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { DatabaseService } from '../../dist/database/database.service.js';
import { loadConfig } from '../../dist/config/app-config.js';

// Opt-in only. Never reads another project's environment or application data.
const adminUrl = process.env.DATABASE_TEST_ADMIN_URL;
if (!adminUrl) {
  console.log(
    'SKIP: configure DATABASE_TEST_ADMIN_URL para o teste MySQL isolado.',
  );
  process.exit(0);
}

const schema = `cabeca_foundation_test_${randomBytes(8).toString('hex')}`;
let admin;
let source;
let service;
let created = false;
let checks = 0;
const check = () => {
  checks += 1;
};

try {
  const serverUrl = new URL(adminUrl);
  assert.equal(serverUrl.protocol, 'mysql:');
  serverUrl.pathname = '/';
  serverUrl.search = '';
  serverUrl.hash = '';
  admin = await mysql.createConnection(serverUrl.href);
  await admin.query(
    `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  created = true;
  const isolatedUrl = new URL(serverUrl);
  isolatedUrl.pathname = `/${schema}`;
  source = createDatabaseSource({
    database: { enabled: true, url: isolatedUrl.href },
  });
  await source.initialize();
  service = new DatabaseService(
    loadConfig({
      NODE_ENV: 'test',
      STORE_ID: 'loja-a',
      DATABASE_ENABLED: 'true',
      DATABASE_URL: isolatedUrl.href,
      MUIRASOFT_BASE_URL: 'https://erp.example.test/back',
      MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
      MUIRASOFT_COMPANY_ID: '7',
      MUIRASOFT_CHANNEL: 'loja-a',
    }),
  );
  await service.onModuleInit();
  assert.equal(await service.isHealthy(), false);
  check();
  const rows = await source.query('SELECT DATABASE() AS name');
  assert.equal(rows[0].name, schema);
  check();

  assert.equal(await source.showMigrations(), true);
  assert.equal((await source.runMigrations()).length, 1);
  assert.equal(await source.showMigrations(), false);
  assert.equal((await source.runMigrations()).length, 0);
  assert.equal(await service.isHealthy(), true);
  check();

  const bindings = [randomUUID(), randomUUID()];
  const insertBinding = (id, store) =>
    source.query(
      `INSERT INTO store_bindings
       (id, store_id, muirasoft_base_url, muirasoft_company_id, muirasoft_channel)
     VALUES (?, ?, ?, ?, ?)`,
      [id, store, 'https://erp.example.test/back', 7, store],
    );
  await insertBinding(bindings[0], 'loja-a');
  await insertBinding(bindings[1], 'loja-b');
  assert.equal(await service.verifyBinding(), true);
  await source.query(
    'UPDATE store_bindings SET muirasoft_channel=? WHERE id=?',
    ['outro-canal', bindings[0]],
  );
  assert.equal(await service.verifyBinding(), false);
  await source.query(
    'UPDATE store_bindings SET muirasoft_channel=? WHERE id=?',
    ['loja-a', bindings[0]],
  );
  check();
  await assert.rejects(
    insertBinding(randomUUID(), 'loja-a'),
    (error) => error.code === 'ER_DUP_ENTRY',
  );
  check();

  const insertOperation = (binding, operation, key) =>
    source.query(
      `INSERT INTO integration_operations
       (id, store_binding_id, operation, idempotency_key, payload_hash)
     VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), binding, operation, key, 'a'.repeat(64)],
    );
  await insertOperation(bindings[0], 'pedido.criar', 'Checkout-A');
  await assert.rejects(
    insertOperation(bindings[0], 'pedido.criar', 'Checkout-A'),
    (error) => error.code === 'ER_DUP_ENTRY',
  );
  check();

  // Same request key must remain independent across stores and operations.
  await insertOperation(bindings[1], 'pedido.criar', 'Checkout-A');
  await insertOperation(bindings[0], 'pedido.cancelar', 'Checkout-A');
  check();

  // MuiraSoft's ASCII idempotency keys are case-sensitive.
  await insertOperation(bindings[0], 'pedido.criar', 'checkout-a');
  const counts = await source.query(
    'SELECT COUNT(*) AS total FROM integration_operations',
  );
  assert.equal(Number(counts[0].total), 4);
  check();

  await assert.rejects(
    insertOperation(randomUUID(), 'pedido.criar', 'sem-vinculo'),
    (error) => error.code === 'ER_NO_REFERENCED_ROW_2',
  );
  await assert.rejects(
    source.query('DELETE FROM store_bindings WHERE id = ?', [bindings[0]]),
    (error) => error.code === 'ER_ROW_IS_REFERENCED_2',
  );
  check();

  await source.undoLastMigration();
  assert.equal(await service.isHealthy(), false);
  assert.equal(await source.showMigrations(), true);
  const tables = await source.query('SHOW TABLES');
  assert.deepEqual(
    tables.map((row) => Object.values(row)[0]),
    ['store_migrations'],
  );
  check();

  console.log(
    `OK: ${checks} verificações MySQL em schema efêmero (migração, rollback, unicidade e isolamento).`,
  );
} catch {
  // Neither driver errors nor assertion dumps may expose the admin URL.
  console.error(
    `FALHA: teste MySQL isolado após ${checks} verificações concluídas.`,
  );
  process.exitCode = 1;
} finally {
  try {
    await service?.onModuleDestroy();
    if (source?.isInitialized) await source.destroy();
  } catch {
    console.error('FALHA: encerramento da conexão MySQL de teste.');
    process.exitCode = 1;
  }
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE \`${schema}\``);
    } catch {
      console.error('FALHA: remoção do schema MySQL efêmero.');
      process.exitCode = 1;
    } finally {
      try {
        await admin.end();
      } catch {
        console.error(
          'FALHA: encerramento da conexão administrativa de teste.',
        );
        process.exitCode = 1;
      }
    }
  }
}

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { loadConfig } from '../../dist/config/app-config.js';
import { MuiraSoftClient } from '../../dist/integrations/muirasoft/muirasoft.client.js';
import { MuiraSoftError } from '../../dist/integrations/muirasoft/muirasoft.error.js';

// No .env is loaded and no real backend or database is contacted.
const root = fileURLToPath(new URL('../../', import.meta.url));
const mock = spawn('postman', [
  'mock', 'run', 'postman/mocks/muirasoft', '--no-history', '--port', 'auto', '--output', 'ndjson',
], { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
const events = [];
let pending = '';
let baseUrl;
let startupFailure;
let checks = 0;
const pass = (label) => { checks++; process.stdout.write(`OK: ${label}\n`); };
mock.on('error', () => { startupFailure = 'Postman CLI indisponível.'; });
mock.on('exit', (code) => { startupFailure ??= `Postman encerrou antes da validação (código ${code}).`; });
mock.stderr.on('data', () => { /* Do not emit uncontrolled CLI diagnostics. */ });
mock.stdout.on('data', (chunk) => {
  pending += chunk.toString();
  const lines = pending.split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (event.event === 'listening' && Number.isInteger(event.port)) baseUrl = `http://127.0.0.1:${event.port}`;
    } catch { /* CLI may also print a human-readable shutdown hint. */ }
  }
});

async function control(scenario, extra = {}) {
  const response = await fetch(`${baseUrl}/__control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, ...extra }), signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200, 'controle do mock deve responder');
  await response.arrayBuffer();
}
async function stats() {
  const response = await fetch(`${baseUrl}/__stats`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  return response.json();
}
function client(timeoutMs = 2000) {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_ENABLED: 'false', OBSERVE_ENABLED: 'false',
    MUIRASOFT_BASE_URL: baseUrl,
    MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
    MUIRASOFT_COMPANY_ID: '42', MUIRASOFT_CHANNEL: 'test',
    MUIRASOFT_TIMEOUT_MS: String(timeoutMs),
  });
  return new MuiraSoftClient(config);
}
async function expectError(operation, code, status) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof MuiraSoftError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.ok(!error.message.includes('remote-private-detail'));
    assert.ok(!error.message.includes('muira_live_'));
    return true;
  });
}

const redirectCalls = [];
const redirectTrap = createServer((req, res) => {
  redirectCalls.push({ authorized: !!req.headers.authorization });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{}');
});
try {
  const startDeadline = Date.now() + 15000;
  while (!baseUrl && Date.now() < startDeadline) {
    if (startupFailure) throw new Error(startupFailure);
    await pause(50);
  }
  if (!baseUrl) throw new Error('O mock Postman não iniciou em 15 segundos.');

  await control('success');
  const connection = await client().checkConnection();
  assert.equal(connection.empresa, 42);
  assert.equal(connection.canal, 'test');
  const first = await stats();
  assert.equal(first.calls.length, 1);
  assert.equal(first.calls[0].path, '/integracao/v1/conexao');
  assert.equal(first.calls[0].authenticated, true);
  pass('contexto validado pelo cliente real e bearer recebido no servidor HTTP local');

  for (const scenario of ['wrong-company', 'wrong-channel']) {
    await control(scenario);
    await expectError(() => client().listProducts(), 'MUIRASOFT_CONTEXT_MISMATCH', 503);
    assert.equal((await stats()).calls.length, 1, 'catálogo não deve ser consultado após contexto divergente');
    pass(`${scenario}: contexto divergente bloqueia consulta comercial`);
  }

  await control('unauthorized');
  await expectError(() => client().checkConnection(), 'MUIRASOFT_AUTHENTICATION_FAILED', 503);
  pass('401 remoto convertido em falha segura da integração, sem detalhes privados');

  await control('rate-limited');
  await assert.rejects(() => client().checkConnection(), (error) => {
    assert.equal(error.code, 'MUIRASOFT_RATE_LIMITED');
    assert.equal(error.status, 503);
    assert.equal(error.retryAfterSeconds, 17);
    assert.equal(error.requestId, 'c'.repeat(32));
    return true;
  });
  assert.equal((await stats()).calls.length, 1);
  pass('429 preserva Retry-After e request ID seguros, sem retry automático');

  await control('html-error');
  await expectError(() => client().checkConnection(), 'MUIRASOFT_UPSTREAM_ERROR', 502);
  pass('500 com HTML produz erro seguro sem encaminhar o corpo remoto');

  await control('invalid-json');
  await expectError(() => client().checkConnection(), 'MUIRASOFT_INVALID_RESPONSE', 502);
  pass('JSON inválido em resposta 200 é recusado');

  redirectTrap.listen(0, '127.0.0.1');
  await once(redirectTrap, 'listening');
  const redirectUrl = `http://127.0.0.1:${redirectTrap.address().port}/trap`;
  await control('redirect', { redirectUrl });
  await expectError(() => client().checkConnection(), 'MUIRASOFT_UNAVAILABLE', 503);
  assert.equal(redirectCalls.length, 0, 'redirect não pode receber a credencial');
  pass('redirect recusado; servidor de destino não recebe requisição nem credencial');

  await control('timeout');
  await expectError(() => client(150).checkConnection(), 'MUIRASOFT_TIMEOUT', 504);
  assert.equal((await stats()).calls.length, 1);
  pass('timeout HTTP aborta a chamada dentro do limite configurado');

  await control('success');
  const products = await client().listProducts({ busca: 'Camiseta azul', limit: 1 });
  assert.equal(products.data[0].preco_venda, '99.00');
  assert.equal(products.data[0].estoque.reservado, null);
  const catalogCalls = (await stats()).calls;
  assert.equal(catalogCalls.length, 2);
  const query = new URL(catalogCalls[1].path, baseUrl).searchParams;
  assert.equal(query.get('busca'), 'Camiseta azul');
  assert.equal(query.get('limit'), '1');
  pass('catálogo usa prefixo e query reais, preserva decimais e ausência de reserva');

  const reference = '09e445d0-452e-48d9-b3db-abdd536446bc';
  const key = `checkout:${reference}`;
  const input = {
    referencia_externa: reference,
    cliente: { referencia_externa: 'c5503aac-6467-41c6-99c8-3ec0aeff1a1a', nome: 'Comprador fictício' },
    itens: [{ id_produto: 7, quantidade: '2.0000', preco: '99.00' }],
  };
  await control('success');
  const created = await client().createOrder(input, key);
  const repeated = await client().createOrder(input, key);
  assert.equal(created.id, repeated.id);
  const writeState = await stats();
  const writes = writeState.calls.filter((call) => call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(Object.keys(writeState.orders).length, 1);
  assert.equal(writes[0].idempotencyKey, key);
  assert.deepEqual(writes[0].body, input);
  assert.equal(writes[0].contentType, 'application/json');
  pass('POST serializa payload e Idempotency-Key; replay intencional conserva o pedido simulado');

  await control('write-timeout');
  await expectError(() => client(150).createOrder(input, key), 'MUIRASOFT_TIMEOUT', 504);
  const uncertain = await stats();
  assert.equal(uncertain.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(Object.keys(uncertain.orders).length, 1);
  pass('timeout após persistência simulada não repete POST automaticamente');

  await control('success');
  const emailKey='11111111-1111-4111-8111-111111111111';
  await client().sendCustomerEmail({model:'conta_confirmacao',recipient:'fixture@example.test',name:'Fixture',token:'x'.repeat(43),expires_at:new Date(Date.now()+600000).toISOString()},emailKey);
  const mails=(await stats()).calls;
  assert.equal(mails.at(-1).path,'/integracao/v1/contas/emails');
  assert.equal(mails.at(-1).idempotencyKey,emailKey);
  assert.equal(mails.at(-1).authenticated,true);
  pass('mensagem de conta usa o cliente real, bearer e evento idempotente por HTTP local');

  // The CLI's NDJSON is inspected in-memory; no request log is committed.
  for (let i = 0; i < 10 && !events.some((event) => event.event === 'request' && event.path === '/integracao/v1/pedidos'); i++) await pause(50);
  assert.ok(events.some((event) => event.event === 'request' && event.path === '/integracao/v1/conexao'));
  assert.ok(events.some((event) => event.event === 'request' && event.path.startsWith('/integracao/v1/produtos')));
  assert.ok(events.some((event) => event.event === 'request' && event.path === '/integracao/v1/pedidos'));
  pass('NDJSON Postman confirma execução dos caminhos de contexto, catálogo e escrita');
  process.stdout.write(`PASS: ${checks} cenários HTTP locais; nenhum serviço real foi chamado.\n`);
} finally {
  redirectTrap.closeAllConnections();
  if (redirectTrap.listening) await new Promise((resolve) => redirectTrap.close(resolve));
  if (mock.pid) {
    try {
      if (process.platform === 'win32') mock.kill('SIGINT');
      else process.kill(-mock.pid, 'SIGINT');
    } catch { /* Process already exited. */ }
    await Promise.race([once(mock, 'exit').catch(() => {}), pause(1500)]);
    if (mock.exitCode === null && mock.signalCode === null) {
      try {
        if (process.platform === 'win32') mock.kill('SIGKILL');
        else process.kill(-mock.pid, 'SIGKILL');
      } catch { /* Process already exited. */ }
    }
  }
}

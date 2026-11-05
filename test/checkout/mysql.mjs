import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { loadConfig } from '../../dist/config/app-config.js';
import { createDatabaseSource } from '../../dist/database/data-source-options.js';
import { createApplication } from '../../dist/bootstrap.js';
import { AuthService } from '../../dist/auth/auth.service.js';
import { unseal } from '../../dist/auth/auth.crypto.js';
if (!process.env.DATABASE_TEST_ADMIN_URL) {
  console.log('SKIP: configure DATABASE_TEST_ADMIN_URL para checkout isolado.');
  process.exit(0);
}
let admin,
  db,
  app,
  server,
  created = false,
  checks = 0,
  last = 'inicialização';
const schema = 'checkout_test_' + randomBytes(6).toString('hex');
const check = (ok, label) => {
  last = label;
  assert.ok(ok, label);
  checks++;
  console.log('OK:', label);
};
const quotes = new Map(),
  quoteKeys = new Map(),
  payments = new Map();
let quoteWrites = 0,
  orderWrites = 0,
  paymentWrites = 0,
  losePaymentResponse = true,
  cardSeen = false,
  actualIp = '';
const signature =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0p0AAAAASUVORK5CYII=';
let pauseQuoteRead = null;
try {
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture.test');
      let body = '';
      for await (const chunk of req) body += chunk;
      const b = body ? JSON.parse(body) : {};
      const send = (value, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const base = '/integracao/v1';
      if (url.pathname === base + '/conexao')
        return send({
          nome: 'Checkout fixture',
          empresa: 42,
          canal: 'checkout-test',
          origem: 'LOJA_VIRTUAL',
          estoque_politica: 'RESERVA',
          escopos: [
            'produtos:ler',
            'pedidos:criar',
            'pedidos:ler',
            'pedidos:cancelar',
            'contas:email',
            'pagamentos:criar',
            'pagamentos:ler',
            'checkout:criar',
            'checkout:ler',
          ],
        });
      if (url.pathname === base + '/checkout/opcoes')
        return send({
          versao: 1,
          atendimento_conjunto: true,
          opcoes: [
            {
              tipo: 'ENTREGA',
              nome: 'Área fixture',
              taxa: '12.50',
              prazo_dias: 2,
              endereco: null,
              instrucoes: null,
            },
          ],
        });
      if (
        url.pathname === base + '/checkout/cotacoes' &&
        req.method === 'POST'
      ) {
        const key = req.headers['idempotency-key'];
        if (quoteKeys.has(key)) return send(quotes.get(quoteKeys.get(key)));
        const id = randomBytes(16).toString('hex'),
          subtotal = b.itens
            .reduce((s, i) => s + 100 * i.quantidade, 0)
            .toFixed(2);
        const q = {
          id,
          expira_em: new Date(Date.now() + 300000).toISOString(),
          id_pedido: null,
          numero_pedido: null,
          buyer: b.cliente.referencia_externa,
          revisao: {
            cliente: {
              nome: b.cliente.nome,
              email: b.cliente.email,
              documento_final: b.cliente.documento.slice(-4),
            },
            endereco: b.endereco,
            entrega: {
              tipo: b.tipo_entrega,
              nome: 'Área fixture',
              taxa: '12.50',
              prazo_dias: 2,
              endereco: null,
              instrucoes: null,
            },
            itens: b.itens.map((i) => ({
              sku_id: i.id_produto,
              titulo: 'Produto fixture',
              cor: 'Verde',
              tamanho: 'M',
              imagem: 'https://images.example.test/sku.png',
              quantidade: i.quantidade,
              preco: '100.00',
              total: (i.quantidade * 100).toFixed(2),
              modalidade: i.modalidade,
              prazo_producao_dias: null,
            })),
            subtotal,
            frete: '12.50',
            total: (Number(subtotal) + 12.5).toFixed(2),
            prazo_producao_dias: 0,
            atendimento_conjunto: true,
          },
        };
        quotes.set(id, q);
        quoteKeys.set(key, id);
        quoteWrites++;
        return send(q);
      }
      const qMatch = url.pathname.match(
        /\/checkout\/cotacoes\/([a-f0-9]{32})(\/confirmar)?$/,
      );
      if (qMatch) {
        if (req.method === 'GET' && pauseQuoteRead) {
          const pause = pauseQuoteRead;
          pauseQuoteRead = null;
          pause.started();
          await pause.wait;
        }
        const q = quotes.get(qMatch[1]),
          buyer = qMatch[2]
            ? b.referencia_comprador
            : url.searchParams.get('referencia_comprador');
        if (!q || q.buyer !== buyer) return send({ code: 'NOT_FOUND' }, 404);
        if (qMatch[2] && !q.id_pedido) {
          q.id_pedido = 100 + ++orderWrites;
          q.numero_pedido = String(1000 + orderWrites);
        }
        return send(q);
      }
      const pMatch = url.pathname.match(/\/pedidos\/(\d+)\/pagamentos$/);
      if (pMatch) {
        const order = Number(pMatch[1]),
          key =
            req.method === 'GET'
              ? url.searchParams.get('chave')
              : req.headers['idempotency-key'];
        if (req.method === 'GET')
          return send({ data: payments.has(key) ? [payments.get(key)] : [] });
        if (payments.has(key)) return send(payments.get(key));
        const quote = [...quotes.values()].find((q) => q.id_pedido === order);
        paymentWrites++;
        cardSeen ||= !!b.cartao;
        actualIp = b.ip_comprador || '';
        const p = {
          id: 500 + paymentWrites,
          id_pedido: order,
          metodo: b.metodo,
          parcelas: b.parcelas,
          total: quote.revisao.total,
          estado: 'CRIADO',
          pago_em: null,
          revisao_estoque: false,
          erro_codigo: null,
          financeiro_codigo: null,
          estorno_estado: null,
          total_estornado: '0.00',
          liquido_recebido_acumulado: '0.00',
          cobrancas: [
            {
              numero: 1,
              valor: quote.revisao.total,
              liquido: quote.revisao.total,
              estornado: '0.00',
              status_asaas: 'PENDING',
              confirmado: 'N',
              disponivel: 'N',
              vencimento: '2026-11-02',
              credito_em: null,
            },
          ],
        };
        payments.set(key, p);
        if (losePaymentResponse) {
          losePaymentResponse = false;
          res.destroy();
          return;
        }
        return send(p);
      }
      if (/\/pedidos\/\d+\/pagamentos\/\d+\/pix$/.test(url.pathname))
        return send({
          imagem_base64: signature,
          copia_cola: '000201-fixture',
          expira_em: new Date(Date.now() + 86400000).toISOString(),
        });
      return send({ code: 'NOT_FOUND' }, 404);
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
    STORE_ID: 'checkout-store',
    DATABASE_ENABLED: 'true',
    DATABASE_URL: url.href,
    AUTH_ENABLED: 'true',
    AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MUIRASOFT_BASE_URL: 'http://127.0.0.1:' + server.address().port,
    MUIRASOFT_TOKEN: 'muira_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43),
    MUIRASOFT_COMPANY_ID: '42',
    MUIRASOFT_CHANNEL: 'checkout-test',
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
      'checkout-test',
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
      cookie: login.headers['set-cookie'][0].split(';')[0],
      id: login.body.id,
    };
  }
  const a = await buyer('checkout-a@example.test'),
    b = await buyer('checkout-b@example.test');
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
  const address = {
    label: 'Casa',
    recipient: 'Comprador fixture',
    postal_code: '69000000',
    street: 'Rua sintética fixture',
    number: '10',
    complement: '',
    district: 'Centro',
    city: 'Manaus',
    state: 'AM',
  };
  await call('put', 'auth/profile', {
    name: 'Comprador fixture',
    phone: '92999999999',
  });
  await call(
    'put',
    'auth/profile',
    { name: 'Comprador fixture', phone: '92999999999' },
    b.cookie,
  );
  const ad = await call('post', 'auth/addresses', address),
    other = await call('post', 'auth/addresses', address, b.cookie);
  const [aAddress] = await db.query(
    'SELECT id FROM customer_addresses WHERE customer_id=?',
    [a.id],
  );
  const [bAddress] = await db.query(
    'SELECT id FROM customer_addresses WHERE customer_id=?',
    [b.id],
  );
  check(
    ad.status === 201 && other.status === 201,
    'Endereços sintéticos criados somente no schema efêmero',
  );
  let r = await call(
    'get',
    'checkout/options?address_id=' + aAddress.id,
    undefined,
    '',
  );
  check(r.status === 401, 'Checkout exige sessão verificada');
  r = await call('get', 'checkout/options?address_id=' + bAddress.id);
  check(r.status === 404, 'Comprador não usa endereço de outra conta');
  r = await call('get', 'checkout/options?address_id=' + aAddress.id);
  check(
    r.status === 200 && r.body.opcoes[0].taxa === '12.50',
    'Opções vêm da configuração do ERP para o CEP salvo',
  );
  const body = {
      address_id: aAddress.id,
      document: '11144477735',
      delivery_type: 'ENTREGA',
      items: [
        {
          sku_id: 1,
          quantity: 1,
          fulfillment: 'PRONTA_ENTREGA',
          observed_price: '0.01',
        },
      ],
    },
    key = randomUUID();
  r = await call(
    'post',
    'checkout',
    body,
    a.cookie,
    key,
    'https://evil.example',
  );
  check(r.status === 403, 'Origem de terceiro não prepara checkout');
  r = await call(
    'post',
    'checkout',
    { ...body, id_empresa: 99 },
    a.cookie,
    key,
  );
  check(r.status === 400, 'Payload não escolhe conta, empresa ou canal');
  r = await call('post', 'checkout', body, a.cookie, key);
  check(
    r.status === 200 && r.body.review.total === '112.50',
    'Revisão usa preço do servidor e soma frete',
  );
  const id = r.body.id;
  r = await call('post', 'checkout', body, a.cookie, key);
  check(
    r.status === 200 && r.body.id === id && quoteWrites === 1,
    'Repetir revisão preserva cotação e chave, sem duplicação',
  );
  r = await call('get', 'checkout/' + id, undefined, b.cookie);
  check(
    r.status === 404,
    'Checkout de outro comprador não pode ser consultado',
  );
  r = await call(
    'post',
    'checkout',
    { ...body, address_id: bAddress.id },
    b.cookie,
    key,
  );
  check(
    r.status === 409,
    'Outra conta não reaproveita chave de checkout existente',
  );
  r = await call('post', 'checkout/' + id + '/confirm', { accepted: false });
  check(r.status === 400, 'Confirmar exige aceite explícito da revisão');
  r = await call('post', 'checkout/' + id + '/confirm', { accepted: true });
  check(
    r.status === 200 && r.body.ordered && r.body.order_number === '1001',
    'Aceitar revisão cria pedido e devolve número público',
  );
  await Promise.all([
    call('post', 'checkout/' + id + '/confirm', { accepted: true }),
    call('post', 'checkout/' + id + '/confirm', { accepted: true }),
  ]);
  check(
    orderWrites === 1,
    'Confirmações concorrentes não duplicam pedido remoto',
  );
  const card = {
      holderName: 'Comprador fixture',
      number: '4111111111111111',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
    },
    paymentKey = randomUUID();
  r = await call(
    'post',
    'checkout/' + id + '/payments',
    {
      method: 'CREDIT_CARD',
      installments: 1,
      card,
      ip_comprador: '203.0.113.99',
    },
    a.cookie,
    paymentKey,
  );
  check(r.status === 400, 'IP do comprador não é aceito do corpo');
  r = await call(
    'post',
    'checkout/' + id + '/payments',
    { method: 'CREDIT_CARD', installments: 1, card },
    a.cookie,
    paymentKey,
  );
  check(
    r.status === 200 &&
      paymentWrites === 1 &&
      cardSeen &&
      actualIp !== '203.0.113.99',
    'Pagamento usa IP derivado do servidor e encaminha cartão só na requisição',
  );
  check(
    r.body.payments[0].status === 'AWAITING_PAYMENT',
    'Resposta perdida após cobrança é recuperada por consulta da chave',
  );
  r = await call(
    'post',
    'checkout/' + id + '/payments',
    { method: 'CREDIT_CARD', installments: 1, card },
    a.cookie,
    paymentKey,
  );
  check(
    r.status === 200 && paymentWrites === 1,
    'Repetir chave após resposta incerta não reenvia cartão',
  );
  r = await call(
    'post',
    'checkout/' + id + '/payments',
    { method: 'PIX', installments: 1 },
    a.cookie,
    randomUUID(),
  );
  check(
    r.status === 409 && paymentWrites === 1,
    'Outra chave não duplica cobrança ativa',
  );
  const first = [...payments.values()][0];
  first.estado = 'RECUSADO';
  await call('get', 'checkout/' + id);
  await db.query('DELETE FROM customer_rate_limits');
  r = await call(
    'post',
    'checkout/' + id + '/payments',
    { method: 'PIX', installments: 1 },
    a.cookie,
    randomUUID(),
  );
  check(
    r.status === 200 && paymentWrites === 2,
    'Nova tentativa é permitida após recusa explícita',
  );
  const pixId = r.body.payments[0].id;
  r = await call('get', `checkout/${id}/payments/${pixId}/pix`);
  check(
    r.status === 200 && r.body.copia_cola === '000201-fixture',
    'Pix só fica disponível para tentativa própria',
  );
  r = await call(
    'get',
    `checkout/${id}/payments/${pixId}/pix`,
    undefined,
    b.cookie,
  );
  check(r.status === 404, 'Outro comprador não acessa o Pix por conhecer IDs');
  const last = [...payments.values()].at(-1);
  last.pago_em = '2026-11-02T23:00:00Z';
  last.cobrancas[0].confirmado = 'S';
  last.cobrancas[0].disponivel = 'S';
  last.cobrancas[0].status_asaas = 'RECEIVED';
  last.liquido_recebido_acumulado = last.total;
  r = await call('get', 'checkout/' + id);
  check(
    r.status === 200 && r.body.payments[0].status === 'PAID',
    'Confirmação do pagamento é consultada sem gerar nova cobrança',
  );
  check(
    !JSON.stringify(r.body).includes('liquido') &&
      !JSON.stringify(r.body).includes('financeiro_codigo'),
    'Resposta do comprador não expõe taxas ou códigos operacionais',
  );
  last.estado = 'REVISAO';
  r = await call('get', 'checkout/' + id);
  check(
    r.body.payments[0].status === 'REVIEW',
    'Pagamento em disputa não é apresentado como nova confirmação disponível',
  );
  last.estado = 'CRIADO';
  const [stored] = await db.query(
    'SELECT payload_cipher,review_cipher FROM checkout_sessions WHERE id=?',
    [id],
  );
  const [intents] = await db.query(
    'SELECT * FROM checkout_payment_intents WHERE checkout_id=?',
    [id],
  );
  const persisted = JSON.stringify({ stored, intents });
  check(
    !persisted.includes('4111111111111111') &&
      !persisted.includes('ccv') &&
      !persisted.includes('11144477735') &&
      !persisted.includes(address.street),
    'Cartão nunca persiste; dados pessoais da revisão ficam cifrados',
  );
  await db.query('DELETE FROM customer_rate_limits');
  const bQuote = await call(
    'post',
    'checkout',
    { ...body, address_id: bAddress.id },
    b.cookie,
    randomUUID(),
  );
  const bId = bQuote.body.id;
  await call('post', `checkout/${bId}/confirm`, { accepted: true }, b.cookie);
  let release, started;
  const waiting = new Promise((resolve) => (release = resolve)),
    entered = new Promise((resolve) => (started = resolve));
  pauseQuoteRead = { wait: waiting, started };
  const beforePayment = paymentWrites;
  const pending = call(
    'post',
    `checkout/${bId}/payments`,
    { method: 'PIX', installments: 1 },
    b.cookie,
    randomUUID(),
  ).then((response) => response);
  await entered;
  await call('post', 'auth/logout', {}, b.cookie);
  release();
  r = await pending;
  check(
    r.status === 401 && paymentWrites === beforePayment,
    'Logout durante consulta impede aceitar uma nova intenção financeira',
  );
  r = await call('post', 'auth/logout', {});
  check(r.status === 200, 'Sessão é encerrada para verificar revogação');
  r = await call('get', 'checkout/' + id);
  check(r.status === 401, 'Sessão revogada não consulta checkout anterior');
  console.log(
    `OK: ${checks} verificações HTTP/MySQL de checkout, sem gateway ou e-mail externo.`,
  );
} catch {
  console.error(
    `FALHA: checkout isolado após ${checks} verificações (${last}).`,
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

/* Derived from contracts/muirasoft/integracoes-v1.openapi.json via postman mock generate.
 * Narrowed to this validation's HTTP paths and corrected to match SEM_MOVIMENTO.
 * /__control and /__stats are local test controls, not MuiraSoft endpoints.
 * Every identity, credential and order below is synthetic. */
const http = require('node:http');
const STATE_KEY = 'muirasoft.integration-validation';
const FAKE_BEARER = `Bearer muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`;
const REQUEST_ID = 'c'.repeat(32);
const scenarios = new Set([
  'success', 'wrong-company', 'wrong-channel', 'unauthorized', 'rate-limited',
  'html-error', 'redirect', 'timeout', 'write-timeout', 'invalid-json',
]);
const initial = () => ({ scenario: 'success', redirectUrl: null, calls: [], orders: {} });
const context = () => ({
  nome: 'Loja de teste', empresa: 42, canal: 'test', origem: 'LOJA_VIRTUAL',
  escopos: ['produtos:ler', 'pedidos:criar', 'pedidos:ler', 'pedidos:cancelar'],
  estoque_politica: 'SEM_MOVIMENTO',
});
const product = () => ({
  id: 7, descricao: 'Camiseta de teste', unidade: 'UN', ean: null,
  controla_estoque: true, kit: false, preco_venda: '99.00',
  estoque: {
    cadastrado: true, fisico: '5.0000', politica: 'SEM_MOVIMENTO', reservado: null,
    disponivel_para_venda: null, consultado_em: '2026-10-29T12:00:00.000Z', versao: 1,
  },
});
const order = (reference) => ({
  id: 91, numero: 1, referencia_externa: reference, origem: 'LOJA_VIRTUAL', canal: 'test',
  status: { codigo: 'pending', nome: 'Pendente', tipo: 'FLUXO', stage: 10 },
  total: '198.00', total_desconto: '0.00', total_acrescimo: '0.00', versao: 1,
  criado_em: '2026-10-29T12:00:00.000Z', atualizado_em: '2026-10-29T12:00:00.000Z',
  cancelado_em: null, estoque_politica: 'SEM_MOVIMENTO',
});
function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Request-Id': REQUEST_ID, ...headers,
  });
  res.end(JSON.stringify(body));
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && pathname === '/__control') {
      if (!scenarios.has(req.body?.scenario)) return json(res, 422, { error: 'Unknown test scenario' });
      const next = { ...initial(), scenario: req.body.scenario, redirectUrl: req.body.redirectUrl ?? null };
      await pm.state.set(STATE_KEY, next);
      return json(res, 200, { scenario: next.scenario });
    }
    const state = (await pm.state.get(STATE_KEY)) || initial();
    if (req.method === 'GET' && pathname === '/__stats') return json(res, 200, state);
    state.calls.push({
      method: req.method, path: req.url, authenticated: req.headers.authorization === FAKE_BEARER,
      idempotencyKey: req.headers['idempotency-key'] ?? null,
      contentType: req.headers['content-type'] ?? null, body: req.body ?? null,
    });
    await pm.state.set(STATE_KEY, state);
    if (req.headers.authorization !== FAKE_BEARER) {
      return json(res, 401, { code: 'INVALID_TOKEN', message: 'Credencial inválida.', request_id: REQUEST_ID });
    }
    if (req.method === 'GET' && pathname === '/integracao/v1/conexao') {
      if (state.scenario === 'unauthorized') return json(res, 401, { code: 'INVALID_TOKEN', message: 'remote-private-detail', request_id: REQUEST_ID });
      if (state.scenario === 'rate-limited') return json(res, 429, { code: 'RATE_LIMITED', message: 'remote-private-detail', request_id: REQUEST_ID }, { 'Retry-After': '17' });
      if (state.scenario === 'html-error') {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        return res.end('<html>remote-private-detail</html>');
      }
      if (state.scenario === 'redirect') {
        res.writeHead(302, { Location: state.redirectUrl });
        return res.end();
      }
      if (state.scenario === 'timeout') return setTimeout(() => json(res, 200, context()), 600);
      if (state.scenario === 'invalid-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{');
      }
      const value = context();
      if (state.scenario === 'wrong-company') value.empresa = 43;
      if (state.scenario === 'wrong-channel') value.canal = 'other-store';
      return json(res, 200, value);
    }
    if (req.method === 'GET' && pathname === '/integracao/v1/produtos') return json(res, 200, { data: [product()], next_cursor: null });
    if (req.method === 'GET' && pathname === '/integracao/v1/produtos/7') return json(res, 200, product());
    if (req.method === 'POST' && pathname === '/integracao/v1/pedidos') {
      const key = req.headers['idempotency-key'];
      if (!key || !req.body?.referencia_externa) return json(res, 422, { code: 'INVALID_ORDER', message: 'Chave e referência obrigatórias.', request_id: REQUEST_ID });
      const fingerprint = JSON.stringify(req.body);
      const existing = state.orders[key];
      if (existing && existing.fingerprint !== fingerprint) return json(res, 409, { code: 'IDEMPOTENCY_CONFLICT', message: 'Conteúdo divergente.', request_id: REQUEST_ID });
      const result = existing?.result ?? order(req.body.referencia_externa);
      state.orders[key] = { fingerprint, result };
      await pm.state.set(STATE_KEY, state);
      if (state.scenario === 'write-timeout') return setTimeout(() => json(res, 201, result), 600);
      return json(res, 201, result);
    }
    return json(res, 501, { code: 'NOT_MODELLED', message: 'Path not modelled by this local mock.', request_id: REQUEST_ID });
  } catch {
    return json(res, 500, { code: 'MOCK_FAILURE', message: 'Local mock failed.', request_id: REQUEST_ID });
  }
});
server.listen(Number(process.env.PORT || 4500), '127.0.0.1');

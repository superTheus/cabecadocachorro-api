import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../../config/app-config.js';
import { MuiraSoftClient } from './muirasoft.client.js';
import type { MuiraSoftCreateOrder } from './muirasoft.types.js';

const secret = `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`;
const connection = {
  nome: 'Loja de teste',
  empresa: 12,
  canal: 'cabeca-cachorro',
  origem: 'LOJA_VIRTUAL',
  escopos: ['produtos:ler', 'pedidos:ler', 'pedidos:criar', 'pedidos:cancelar'],
  estoque_politica: 'SEM_MOVIMENTO',
};
const order = {
  id: 31,
  numero: 1,
  referencia_externa: 'checkout-test',
  canal: connection.canal,
  status: { codigo: 'pending', nome: 'Pendente', tipo: 'FLUXO', stage: 10 },
  total: '19.90',
  versao: 1,
  estoque_politica: 'SEM_MOVIMENTO',
};
const product = {
  id: 7,
  descricao: 'Produto',
  preco_venda: null,
  estoque: {
    cadastrado: false,
    fisico: null,
    politica: 'SEM_MOVIMENTO',
    reservado: null,
    disponivel_para_venda: null,
    consultado_em: '2026-10-29T10:00:00Z',
    versao: null,
  },
};
const payload: MuiraSoftCreateOrder = {
  referencia_externa: 'checkout-test',
  cliente: { referencia_externa: 'buyer-test', nome: 'Comprador' },
  itens: [{ id_produto: 7, quantidade: '1.0000', preco: '19.90' }],
};

function client(
  overrides: Partial<AppConfig['muirasoft']> = {},
): MuiraSoftClient {
  return new MuiraSoftClient(
    new AppConfig(
      'test',
      3000,
      { id: 'store-test', url: 'http://localhost:5173' },
      [],
      { enabled: false, ssl: false },
      {
        baseUrl: 'http://127.0.0.1:3010/back',
        token: secret,
        companyId: 12,
        channel: 'cabeca-cachorro',
        timeoutMs: 100,
        ...overrides,
      },
      { enabled: false },
    ),
  );
}

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function mockResponses(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const item of responses) mock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MuiraSoftClient boundaries', () => {
  it('preserves backend base path and sends the opaque credential only as a header', async () => {
    const fetch = mockResponses(response(connection));
    expect(await client().checkConnection()).toEqual(connection);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3010/back/integracao/v1/conexao',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${secret}`,
        },
      }),
    );
    expect(fetch.mock.calls[0]?.[0]).not.toContain(secret);
  });

  it.each([{ empresa: 99 }, { canal: 'other-shop' }])(
    'refuses the wrong merchant context before reading resources: %j',
    async (override) => {
      const fetch = mockResponses(response({ ...connection, ...override }));
      await expect(client().listProducts()).rejects.toMatchObject({
        code: 'MUIRASOFT_CONTEXT_MISMATCH',
        status: 503,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('checks current scopes and does not call a forbidden resource', async () => {
    const fetch = mockResponses(
      response({ ...connection, escopos: ['produtos:ler'] }),
    );
    await expect(
      client().createOrder(payload, 'checkout:one'),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_SCOPE_DENIED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails safely when integration is not configured', async () => {
    const fetch = mockResponses();
    await expect(
      client({ token: undefined }).checkConnection(),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_NOT_CONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('encodes filters and retains null availability without claiming stock reservation', async () => {
    const fetch = mockResponses(
      response(connection),
      response({ data: [{ ...product, custo: 'secret' }], next_cursor: null }),
    );
    const result = await client().listProducts({ busca: 'a&b', limit: 1 });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:3010/back/integracao/v1/produtos?busca=a%26b&limit=1',
    );
    expect(result.data[0]).toEqual(product);
    expect(result.data[0]?.estoque.disponivel_para_venda).toBeNull();
  });

  it('does not expose unexpected connection fields', async () => {
    mockResponses(response({ ...connection, segredo: secret }));
    expect(JSON.stringify(await client().checkConnection())).not.toContain(
      secret,
    );
  });

  it('rejects a future stock policy until its contract is explicitly supported', async () => {
    mockResponses(
      response(connection),
      response({
        ...product,
        estoque: { ...product.estoque, politica: 'POLITICA_DESCONHECIDA' },
      }),
    );
    await expect(client().getProduct(7)).rejects.toMatchObject({
      code: 'MUIRASOFT_INVALID_RESPONSE',
      status: 502,
    });
  });

  it('forwards a stable idempotency key and only contract fields when creating an order', async () => {
    const fetch = mockResponses(
      response(connection),
      response(order, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await client().createOrder(payload, 'checkout:one')).toEqual(order);
    const request = fetch.mock.calls[1]?.[1];
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      'Idempotency-Key': 'checkout:one',
    });
    expect(JSON.parse(request?.body as string)).toEqual(payload);
  });

  it('captures validated input before awaiting upstream context', async () => {
    const input = structuredClone(payload);
    let finishContext!: (response: Response) => void;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishContext = resolve;
          }),
      )
      .mockResolvedValueOnce(response(order));
    vi.stubGlobal('fetch', fetch);
    const pending = client().createOrder(input, 'checkout:one');
    input.itens[0]!.preco = '0.01';
    finishContext(response(connection));
    await pending;
    expect(
      JSON.parse(fetch.mock.calls[1]?.[1]?.body as string).itens[0].preco,
    ).toBe('19.90');
  });

  it.each([
    { ...payload, id_conta: 2 },
    { ...payload, itens: [{ ...payload.itens[0], preco: 19.9 }] },
    { ...payload, itens: [{ ...payload.itens[0], quantidade: '0' }] },
    { ...payload, cliente: { ...payload.cliente, id_cliente: 99 } },
  ])(
    'rejects invalid or caller-controlled tenancy fields before HTTP: %j',
    async (input) => {
      const fetch = mockResponses();
      await expect(
        client().createOrder(input as MuiraSoftCreateOrder, 'checkout:one'),
      ).rejects.toMatchObject({ code: 'MUIRASOFT_INVALID_INPUT' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'x\n', 'x y', 'a'.repeat(129)])(
    'rejects invalid idempotency key',
    async (key) => {
      const fetch = mockResponses();
      await expect(client().createOrder(payload, key)).rejects.toMatchObject({
        code: 'MUIRASOFT_INVALID_INPUT',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects wrong-channel orders returned by the provider', async () => {
    mockResponses(
      response(connection),
      response({ ...order, canal: 'another' }),
    );
    await expect(
      client().createOrder(payload, 'checkout:one'),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_CONTEXT_MISMATCH' });
  });

  it('forwards cancellation version, reason and idempotency key', async () => {
    const fetch = mockResponses(response(connection), response(order));
    await client().cancelOrder(
      31,
      { motivo: 'Solicitado pelo comprador', versao: 1 },
      'cancel:one',
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:3010/back/integracao/v1/pedidos/31/cancelar',
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
      motivo: 'Solicitado pelo comprador',
      versao: 1,
    });
  });

  it('projects order detail without internal employee or fiscal data', async () => {
    mockResponses(
      response(connection),
      response({
        ...order,
        cliente: payload.cliente,
        itens: [{ ...payload.itens[0], fornecedor: 'interno' }],
        fluxo: [order.status],
        historico: [
          {
            anterior: null,
            novo: order.status,
            data: '2026-10-29T10:00:00Z',
            observacao: null,
            usuario: 'interno',
          },
        ],
        fiscal: { url: 'https://private.test/invoice' },
      }),
    );
    const detail = await client().getOrder(31);
    expect(detail.cliente).toEqual(payload.cliente);
    expect(JSON.stringify(detail)).not.toContain('interno');
    expect(JSON.stringify(detail)).not.toContain('private.test');
  });

  it('lists orders with encoded server-side filters', async () => {
    const fetch = mockResponses(
      response(connection),
      response({ data: [order], total: 1, limit: 20, offset: 0 }),
    );
    const page = await client().listOrders({
      referencia_externa: 'checkout:test',
      data_inicio: '2026-10-01',
      data_fim: '2026-10-29',
    });
    expect(page.total).toBe(1);
    expect(fetch.mock.calls[1]?.[0]).toContain(
      'referencia_externa=checkout%3Atest',
    );
  });

  it('validates daily filters before contacting the provider', async () => {
    const fetch = mockResponses();
    await expect(
      client().listOrders({ data_inicio: '2026-02-30' }),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_INVALID_INPUT' });
    await expect(
      client().listOrders({
        data_inicio: '2026-10-30',
        data_fim: '2026-10-01',
      }),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_INVALID_INPUT' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sanitizes provider error messages and propagates bounded retry metadata', async () => {
    mockResponses(
      response(
        { message: secret },
        {
          status: 429,
          headers: { 'Retry-After': '42', 'X-Request-Id': 'a'.repeat(32) },
        },
      ),
    );
    const error = await client()
      .checkConnection()
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: 'MUIRASOFT_RATE_LIMITED',
      status: 503,
      retryAfterSeconds: 42,
      requestId: 'a'.repeat(32),
    });
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('refuses redirects and sanitizes network failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(
        new Error(`redirect to https://malicious.test/${secret}`),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(client().checkConnection()).rejects.toMatchObject({
      code: 'MUIRASOFT_UNAVAILABLE',
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('rejects HTML or invalid JSON from upstream as a contract failure', async () => {
    mockResponses(new Response('<html>private error</html>'));
    await expect(client().checkConnection()).rejects.toMatchObject({
      code: 'MUIRASOFT_INVALID_RESPONSE',
      status: 502,
    });
    mockResponses(
      new Response('not-json', {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(client().checkConnection()).rejects.toMatchObject({
      code: 'MUIRASOFT_INVALID_RESPONSE',
      status: 502,
    });
  });

  it('bounds chunked upstream responses even without Content-Length', async () => {
    mockResponses(
      new Response('a'.repeat(1024 * 1024 + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(client().checkConnection()).rejects.toMatchObject({
      code: 'MUIRASOFT_INVALID_RESPONSE',
      status: 502,
    });
  });

  it('times out once and never retries an inconclusive write', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(connection))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(
      client({ timeoutMs: 10 }).createOrder(payload, 'checkout:one'),
    ).rejects.toMatchObject({ code: 'MUIRASOFT_TIMEOUT', status: 504 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

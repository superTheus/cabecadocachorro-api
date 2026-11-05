import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { MuiraSoftError } from './muirasoft.error.js';
import { fiscalFile } from './muirasoft.fiscal.js';
import {
  trackingPage,
  trackingOrder,
  publicOrderId,
} from './muirasoft.tracking.js';
import {
  connectionResponse,
  orderDetailResponse,
  orderPageResponse,
  orderResponse,
  productPageResponse,
  productResponse,
} from './muirasoft.responses.js';
import type {
  MuiraSoftCancelOrder,
  MuiraSoftConnection,
  MuiraSoftCreateOrder,
  MuiraSoftOrder,
  MuiraSoftOrderDetail,
  MuiraSoftOrderFilter,
  MuiraSoftOrderPage,
  MuiraSoftProduct,
  MuiraSoftProductFilter,
  MuiraSoftProductPage,
  MuiraSoftScope,
} from './muirasoft.types.js';
import {
  cancelOrderInput,
  createOrderInput,
  idempotencyKey,
  orderFilter,
  positiveId,
  productFilter,
} from './muirasoft.validation.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
import {
  quoteResponse,
  optionsResponse,
  type CheckoutQuoteInput,
} from './muirasoft.checkout.js';
import {
  paymentInput,
  paymentKey,
  paymentResponse,
  paymentsResponse,
  pixResponse,
  type PaymentInput,
  type StorePayment,
} from './muirasoft.payments.js';

/** Internal adapter. Do not expose these connection-wide methods as customer HTTP routes. */
@Injectable()
export class MuiraSoftClient {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  async productImage(product: number, image: number) {
    positiveId(product); positiveId(image);
    await this.authorize('produtos:ler');
    const value = await this.request('GET', `produtos/${product}/imagens/${image}`, undefined, undefined, 15000, 15000000);
    const p = value as { mime?: unknown; content_base64?: unknown } | null;
    if (!p || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(p.mime as string)
      || typeof p.content_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(p.content_base64)) {
      throw new MuiraSoftError('MUIRASOFT_INVALID_RESPONSE', 502, 'Imagem indisponível.');
    }
    const content = Buffer.from(p.content_base64, 'base64');
    if (content.length > 10485760 || content.toString('base64') !== p.content_base64)
      throw new MuiraSoftError('MUIRASOFT_INVALID_RESPONSE', 502, 'Imagem indisponível.');
    return { content, mime: p.mime as string };
  }
  async customerFiscalFile(
    buyer: string,
    id: string,
    doc: string,
    format: 'pdf' | 'xml',
  ) {
    publicOrderId(id);
    publicOrderId(doc);
    await this.authorize('pedidos:ler');
    const data = await this.request(
      'GET',
      this.path(
        `compradores/pedidos/${id}/documentos/${doc}/${format}`,
        new URLSearchParams({ referencia_comprador: buyer }),
      ),
      undefined,
      undefined,
      15000,
      6 * 1024 * 1024,
    );
    return fiscalFile(data, doc, format);
  }
  async customerOrders(buyer: string, cursor?: string, limit = 20) {
    await this.authorize('pedidos:ler');
    return trackingPage(
      await this.request(
        'GET',
        this.path(
          'compradores/pedidos',
          new URLSearchParams({
            referencia_comprador: buyer,
            limit: String(limit),
            ...(cursor ? { cursor: publicOrderId(cursor) } : {}),
          }),
        ),
      ),
    );
  }
  async customerOrder(buyer: string, id: string) {
    publicOrderId(id);
    await this.authorize('pedidos:ler');
    return trackingOrder(
      await this.request(
        'GET',
        this.path(
          `compradores/pedidos/${id}`,
          new URLSearchParams({ referencia_comprador: buyer }),
        ),
      ),
      id,
    );
  }
  async customerOrderRequest(
    buyer: string,
    id: string,
    body: {
      type: string;
      message: string;
      items: { id: string; quantity: string }[];
    },
    key: string,
  ) {
    publicOrderId(id);
    paymentKey(key);
    await this.authorize('pedidos:criar');
    const result = await this.request(
      'POST',
      `compradores/pedidos/${id}/solicitacoes`,
      { ...body, referencia_comprador: buyer },
      key,
    );
    if (
      !result ||
      typeof result !== 'object' ||
      !('accepted' in result) ||
      result.accepted !== true ||
      !('id' in result)
    )
      throw new MuiraSoftError(
        'MUIRASOFT_INVALID_RESPONSE',
        502,
        'Solicitação indisponível.',
      );
    return { id: publicOrderId(result.id), accepted: true as const };
  }

  async checkConnection(): Promise<MuiraSoftConnection> {
    const connection = connectionResponse(await this.request('GET', 'conexao'));
    if (
      connection.empresa !== this.config.muirasoft.companyId ||
      connection.canal !== this.config.muirasoft.channel
    ) {
      throw new MuiraSoftError(
        'MUIRASOFT_CONTEXT_MISMATCH',
        503,
        'A conexão MuiraSoft não corresponde à loja configurada.',
      );
    }
    return connection;
  }

  async sendCustomerEmail(
    payload: {
      model: string;
      recipient: string;
      name: string;
      token: string;
      expires_at: string;
    },
    key: string,
  ): Promise<void> {
    await this.authorize('contas:email');
    const response = await this.request('POST', 'contas/emails', payload, key);
    if (
      !response ||
      typeof response !== 'object' ||
      !('queued' in response) ||
      response.queued !== true
    )
      throw new MuiraSoftError(
        'MUIRASOFT_INVALID_RESPONSE',
        502,
        'Resposta de comunicação inválida.',
      );
  }

  async listProducts(
    filter: MuiraSoftProductFilter = {},
  ): Promise<MuiraSoftProductPage> {
    const query = productFilter(filter);
    await this.authorize('produtos:ler');
    return productPageResponse(
      await this.request('GET', this.path('produtos', query)),
    );
  }

  async getProduct(productId: number): Promise<MuiraSoftProduct> {
    const id = positiveId(productId);
    await this.authorize('produtos:ler');
    return productResponse(await this.request('GET', `produtos/${id}`));
  }

  async createOrder(
    input: MuiraSoftCreateOrder,
    key: string,
  ): Promise<MuiraSoftOrder> {
    const body = createOrderInput(input);
    const validatedKey = idempotencyKey(key);
    await this.authorize('pedidos:criar');
    return this.validateOrderChannel(
      orderResponse(await this.request('POST', 'pedidos', body, validatedKey)),
    );
  }

  async listOrders(
    filter: MuiraSoftOrderFilter = {},
  ): Promise<MuiraSoftOrderPage> {
    const query = orderFilter(filter);
    await this.authorize('pedidos:ler');
    const page = orderPageResponse(
      await this.request('GET', this.path('pedidos', query)),
    );
    for (const order of page.data) this.validateOrderChannel(order);
    return page;
  }

  async createPayment(
    orderId: number,
    input: PaymentInput,
    key: string,
  ): Promise<StorePayment> {
    const id = positiveId(orderId),
      body = paymentInput(input),
      validatedKey = paymentKey(key);
    if (body.metodo === 'CREDIT_CARD' && this.config.observe.enabled)
      throw new MuiraSoftError(
        'MUIRASOFT_SENSITIVE_TRACING',
        503,
        'Desative a captura de dados sensíveis antes de processar cartão.',
      );
    await this.authorize('pagamentos:criar');
    return paymentResponse(
      await this.request(
        'POST',
        `pedidos/${id}/pagamentos`,
        body,
        validatedKey,
        180000,
      ),
      id,
    );
  }

  async listPayments(orderId: number, key?: string): Promise<StorePayment[]> {
    const id = positiveId(orderId);
    await this.authorize('pagamentos:ler');
    return paymentsResponse(
      await this.request(
        'GET',
        `pedidos/${id}/pagamentos` +
          (key === undefined ? '' : '?chave=' + paymentKey(key)),
      ),
      id,
    );
  }
  async checkoutOptions(cep: string) {
    if (!/^\d{8}$/u.test(cep))
      throw new MuiraSoftError('MUIRASOFT_INVALID_INPUT', 422, 'CEP inválido.');
    await this.authorize('checkout:ler');
    return optionsResponse(
      await this.request('GET', 'checkout/opcoes?cep=' + cep),
    );
  }
  async createCheckoutQuote(input: CheckoutQuoteInput, key: string) {
    await this.authorize('checkout:criar');
    return quoteResponse(
      await this.request('POST', 'checkout/cotacoes', input, paymentKey(key)),
    );
  }
  async getCheckoutQuote(id: string, buyer: string) {
    if (!/^[a-f0-9]{32}$/u.test(id))
      throw new MuiraSoftError(
        'MUIRASOFT_INVALID_INPUT',
        422,
        'Checkout inválido.',
      );
    await this.authorize('checkout:ler');
    return quoteResponse(
      await this.request(
        'GET',
        `checkout/cotacoes/${id}?referencia_comprador=${encodeURIComponent(buyer)}`,
      ),
    );
  }
  async confirmCheckoutQuote(id: string, buyer: string) {
    if (!/^[a-f0-9]{32}$/u.test(id))
      throw new MuiraSoftError(
        'MUIRASOFT_INVALID_INPUT',
        422,
        'Checkout inválido.',
      );
    await this.authorize('checkout:criar');
    return quoteResponse(
      await this.request(
        'POST',
        `checkout/cotacoes/${id}/confirmar`,
        { referencia_comprador: buyer },
        'confirmar-' + id,
      ),
    );
  }

  async getPaymentPix(orderId: number, paymentId: number) {
    const id = positiveId(orderId),
      payment = positiveId(paymentId);
    await this.authorize('pagamentos:ler');
    return pixResponse(
      await this.request('GET', `pedidos/${id}/pagamentos/${payment}/pix`),
    );
  }

  async getOrder(orderId: number): Promise<MuiraSoftOrderDetail> {
    const id = positiveId(orderId);
    await this.authorize('pedidos:ler');
    return this.validateOrderChannel(
      orderDetailResponse(await this.request('GET', `pedidos/${id}`)),
    );
  }

  async cancelOrder(
    orderId: number,
    input: MuiraSoftCancelOrder,
    key: string,
  ): Promise<MuiraSoftOrder> {
    const id = positiveId(orderId);
    const body = cancelOrderInput(input);
    const validatedKey = idempotencyKey(key);
    await this.authorize('pedidos:cancelar');
    return this.validateOrderChannel(
      orderResponse(
        await this.request(
          'POST',
          `pedidos/${id}/cancelar`,
          body,
          validatedKey,
        ),
      ),
    );
  }

  private async authorize(scope: MuiraSoftScope): Promise<void> {
    // No context cache: rotated credentials and changed permissions take effect on the next operation.
    const context = await this.checkConnection();
    if (!context.escopos.includes(scope)) {
      throw new MuiraSoftError(
        'MUIRASOFT_SCOPE_DENIED',
        503,
        'A conexão MuiraSoft não permite esta operação.',
      );
    }
  }

  private validateOrderChannel<T extends MuiraSoftOrder>(order: T): T {
    if (
      order.canal !== undefined &&
      order.canal !== this.config.muirasoft.channel
    ) {
      throw new MuiraSoftError(
        'MUIRASOFT_CONTEXT_MISMATCH',
        502,
        'O pedido recebido não corresponde à loja configurada.',
      );
    }
    return order;
  }

  private path(resource: string, query: URLSearchParams): string {
    return query.size > 0 ? `${resource}?${query.toString()}` : resource;
  }

  private async request(
    method: 'GET' | 'POST',
    resource: string,
    body?: unknown,
    key?: string,
    timeoutMs?: number,
    maxResponseBytes = MAX_RESPONSE_BYTES,
  ): Promise<unknown> {
    const settings = this.config.muirasoft;
    if (
      !settings.baseUrl ||
      !settings.token ||
      !settings.companyId ||
      !settings.channel
    ) {
      throw new MuiraSoftError(
        'MUIRASOFT_NOT_CONFIGURED',
        503,
        'A integração MuiraSoft não está configurada.',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs ?? settings.timeoutMs,
    );
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.token}`,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (key !== undefined) headers['Idempotency-Key'] = key;
      const response = await fetch(
        `${settings.baseUrl.replace(/\/$/u, '')}/integracao/v1/${resource}`,
        {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
          redirect: 'error',
        },
      );
      const text = await this.readBody(response, controller, maxResponseBytes);
      if (!response.ok) throw this.responseError(response);
      if (
        !/^application\/json(?:\s*;|$)/iu.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        throw new MuiraSoftError(
          'MUIRASOFT_INVALID_RESPONSE',
          502,
          'Resposta incompatível com o contrato MuiraSoft.',
        );
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new MuiraSoftError(
          'MUIRASOFT_INVALID_RESPONSE',
          502,
          'Resposta incompatível com o contrato MuiraSoft.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof MuiraSoftError) throw error;
      if (controller.signal.aborted) {
        // A timeout after POST does not prove rollback. The caller must reconcile or reuse the original key.
        throw new MuiraSoftError(
          'MUIRASOFT_TIMEOUT',
          504,
          'O MuiraSoft não respondeu dentro do prazo.',
        );
      }
      throw new MuiraSoftError(
        'MUIRASOFT_UNAVAILABLE',
        503,
        'Não foi possível comunicar com o MuiraSoft.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBody(
    response: Response,
    controller: AbortController,
    maxResponseBytes = MAX_RESPONSE_BYTES,
  ): Promise<string> {
    if (Number(response.headers.get('content-length')) > maxResponseBytes) {
      controller.abort();
      throw new MuiraSoftError(
        'MUIRASOFT_INVALID_RESPONSE',
        502,
        'Resposta incompatível com o contrato MuiraSoft.',
      );
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxResponseBytes) {
          controller.abort();
          throw new MuiraSoftError(
            'MUIRASOFT_INVALID_RESPONSE',
            502,
            'Resposta incompatível com o contrato MuiraSoft.',
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  private responseError(response: Response): MuiraSoftError {
    const rawRequestId = response.headers.get('x-request-id') ?? '';
    const requestId = /^[a-f0-9]{32}$/iu.test(rawRequestId)
      ? rawRequestId
      : undefined;
    const rawRetryAfter = response.headers.get('retry-after') ?? '';
    const retryAfterSeconds = /^\d{1,5}$/u.test(rawRetryAfter)
      ? Number(rawRetryAfter)
      : undefined;
    const errors: Record<number, [string, number, string]> = {
      401: [
        'MUIRASOFT_AUTHENTICATION_FAILED',
        503,
        'A credencial da integração MuiraSoft não está disponível.',
      ],
      402: [
        'MUIRASOFT_ACCOUNT_BLOCKED',
        503,
        'O acesso da integração MuiraSoft está bloqueado.',
      ],
      403: [
        'MUIRASOFT_SCOPE_DENIED',
        503,
        'A conexão MuiraSoft não permite esta operação.',
      ],
      404: [
        'MUIRASOFT_NOT_FOUND',
        404,
        'O recurso não foi encontrado no MuiraSoft.',
      ],
      409: [
        'MUIRASOFT_CONFLICT',
        409,
        'A operação conflita com o estado atual no MuiraSoft.',
      ],
      413: [
        'MUIRASOFT_PAYLOAD_TOO_LARGE',
        413,
        'A requisição excede o tamanho permitido.',
      ],
      422: [
        'MUIRASOFT_INVALID_INPUT',
        422,
        'O MuiraSoft recusou os dados da operação.',
      ],
      429: [
        'MUIRASOFT_RATE_LIMITED',
        503,
        'O limite da integração MuiraSoft foi atingido.',
      ],
    };
    const [code, status, message] = errors[response.status] ?? [
      'MUIRASOFT_UPSTREAM_ERROR',
      502,
      'O MuiraSoft não pôde concluir a operação.',
    ];
    return new MuiraSoftError(
      code,
      status,
      message,
      retryAfterSeconds,
      requestId,
    );
  }
}

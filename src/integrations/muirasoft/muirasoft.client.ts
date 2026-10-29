import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { MuiraSoftError } from './muirasoft.error.js';
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

/** Internal adapter. Do not expose these connection-wide methods as customer HTTP routes. */
@Injectable()
export class MuiraSoftClient {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

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
    const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
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
      const text = await this.readBody(response, controller);
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
  ): Promise<string> {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
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
        if (total > MAX_RESPONSE_BYTES) {
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

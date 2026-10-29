import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { MuiraSoftError } from '../../integrations/muirasoft/muirasoft.error.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Não foi possível concluir a solicitação.';
    if (exception instanceof MuiraSoftError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      if (exception.retryAfterSeconds)
        response.setHeader('Retry-After', exception.retryAfterSeconds);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      'type' in exception
    ) {
      if (exception.type === 'entity.too.large') status = 413;
      if (exception.type === 'entity.parse.failed') status = 400;
    }
    if (!(exception instanceof MuiraSoftError)) {
      const errors: Record<number, [string, string]> = {
        400: ['BAD_REQUEST', 'Solicitação inválida.'],
        401: ['UNAUTHENTICATED', 'Autenticação necessária.'],
        403: ['FORBIDDEN', 'Acesso não permitido.'],
        404: ['NOT_FOUND', 'Recurso não encontrado.'],
        409: ['CONFLICT', 'A solicitação está em conflito com o estado atual.'],
        413: [
          'BODY_TOO_LARGE',
          'Corpo da solicitação excede o limite permitido.',
        ],
        422: ['VALIDATION_ERROR', 'Dados inválidos.'],
        429: ['RATE_LIMITED', 'Limite de solicitações atingido.'],
        503: ['UNAVAILABLE', 'Serviço temporariamente indisponível.'],
      };
      [code, message] = errors[status] || [
        'INTERNAL_ERROR',
        'Não foi possível concluir a solicitação.',
      ];
    }
    const requestId = String(
      response.getHeader('X-Request-Id') || randomUUID(),
    );
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ code, message, request_id: requestId });
  }
}

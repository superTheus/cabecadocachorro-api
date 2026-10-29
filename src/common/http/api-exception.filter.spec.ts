import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { MuiraSoftError } from '../../integrations/muirasoft/muirasoft.error.js';

describe('Erros HTTP sanitizados', () => {
  const run = (error: unknown) => {
    const response = {
      headersSent: false,
      getHeader: vi.fn().mockReturnValue('request-id'),
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    new ApiExceptionFilter().catch(error, host);
    return response;
  };
  it('oculta erros internos que podem conter SQL, credenciais e stack', () => {
    const response = run(
      new Error('mysql://user:password@host/banco SQL SELECT *'),
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Não foi possível concluir a solicitação.',
      request_id: 'request-id',
    });
  });
  it('conserva instruções seguras de retomada da integração', () => {
    const response = run(
      new MuiraSoftError(
        'MUIRASOFT_RATE_LIMITED',
        503,
        'Limite da integração atingido.',
        30,
      ),
    );
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 30);
    expect(response.json).toHaveBeenCalledWith({
      code: 'MUIRASOFT_RATE_LIMITED',
      message: 'Limite da integração atingido.',
      request_id: 'request-id',
    });
  });
});

import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { CustomerService } from './customer.service.js';

function fixture(cookie?: string) {
  const auth = { me: vi.fn(), profile: vi.fn((user) => user) };
  const controller = new AuthController(auth as unknown as AuthService, {} as CustomerService);
  const request = { headers: { cookie } } as Request;
  return { auth, controller, request };
}

it('visitante consulta sessão normalmente sem acessar dados de clientes', async () => {
  const { auth, controller, request } = fixture();
  expect(await controller.currentSession(request)).toEqual({ user: null });
  expect(auth.me).not.toHaveBeenCalled();
});
it('sessão expirada volta ao estado de visitante sem erro', async () => {
  const { auth, controller, request } = fixture('cabeca_session=expired');
  auth.me.mockRejectedValue(new UnauthorizedException());
  expect(await controller.currentSession(request)).toEqual({ user: null });
});
it('sessão válida retorna apenas o perfil projetado', async () => {
  const { auth, controller, request } = fixture('cabeca_session=valid');
  auth.me.mockResolvedValue({ id: 'customer', password_hash: 'private' });
  auth.profile.mockReturnValue({ id: 'customer' });
  expect(await controller.currentSession(request)).toEqual({ user: { id: 'customer' } });
});
it('falhas de infraestrutura continuam visíveis como indisponibilidade', async () => {
  const { auth, controller, request } = fixture('cabeca_session=valid');
  auth.me.mockRejectedValue(new ServiceUnavailableException());
  await expect(controller.currentSession(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
});
it('consulta de perfil protegido continua exigindo sessão', async () => {
  const { auth, controller, request } = fixture();
  auth.me.mockRejectedValue(new UnauthorizedException());
  await expect(controller.me(request)).rejects.toBeInstanceOf(UnauthorizedException);
});

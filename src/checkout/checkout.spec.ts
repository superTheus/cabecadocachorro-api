import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { documentInput } from './checkout.service.js';
import { seal, unseal } from '../auth/auth.crypto.js';
import { loadConfig } from '../config/app-config.js';
describe('Segurança do checkout', () => {
  it('valida CPF/CNPJ e não aceita sequências ou dígito incorreto', () => {
    expect(documentInput('11144477735')).toBe('11144477735');
    expect(documentInput('11222333000181')).toBe('11222333000181');
    for (const value of ['11111111111', '11144477736', '123', null, {}])
      expect(() => documentInput(value)).toThrow();
  });
  it('cifra de checkout não é reutilizável em e-mail, outro checkout ou outra loja', () => {
    const key = randomBytes(32).toString('base64'),
      v = { endereco: 'Rua fixture' };
    const c = seal(v, key, 'store', 'checkout:1:review');
    expect(c).not.toContain(v.endereco);
    expect(unseal(c, key, 'store', 'checkout:1:review')).toEqual(v);
    expect(() => unseal(c, key, 'store')).toThrow();
    expect(() => unseal(c, key, 'store', 'checkout:2:review')).toThrow();
    expect(() => unseal(c, key, 'other', 'checkout:1:review')).toThrow();
  });
  it('confia somente em IPs de proxy explicitamente declarados', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).trustedProxies).toEqual([]);
    expect(
      loadConfig({ NODE_ENV: 'test', TRUSTED_PROXY_IPS: '127.0.0.1,::1' })
        .trustedProxies,
    ).toEqual(['127.0.0.1', '::1']);
    for (const value of ['*', '0.0.0.0/0', 'https://proxy.example'])
      expect(() =>
        loadConfig({ NODE_ENV: 'test', TRUSTED_PROXY_IPS: value }),
      ).toThrow();
  });
});

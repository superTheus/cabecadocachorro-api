import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  digest,
  passwordHash,
  passwordMatches,
  seal,
  unseal,
  token,
} from './auth.crypto.js';
import { loadConfig } from '../config/app-config.js';
describe('Proteção da conta do comprador', () => {
  it('usa tokens aleatórios de 256 bits e hashes estáveis', () => {
    const a = token();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token()).not.toBe(a);
    expect(digest(a)).toHaveLength(64);
  });
  it('scrypt usa salts independentes e recusa senhas incorretas', async () => {
    const p = 'Uma senha fixture longa!';
    const a = await passwordHash(p),
      b = await passwordHash(p);
    expect(a).not.toBe(b);
    expect(await passwordMatches(p, a)).toBe(true);
    expect(await passwordMatches('errada', a)).toBe(false);
    expect(await passwordMatches(p, 'inválido')).toBe(false);
  });
  it('envelope cifrado rejeita chave, loja ou conteúdo diferente', () => {
    const key = randomBytes(32).toString('base64');
    const a = seal({ token: 'secreto' }, key, 'loja-a');
    expect(a).not.toContain('secreto');
    expect(unseal(a, key, 'loja-a')).toEqual({ token: 'secreto' });
    expect(() => unseal(a, key, 'loja-b')).toThrow();
    expect(() =>
      unseal(a, randomBytes(32).toString('base64'), 'loja-a'),
    ).toThrow();
    expect(() => unseal(a.slice(0, -2) + 'xx', key, 'loja-a')).toThrow();
  });
  it('exige banco e chave válida para ativar autenticação', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'true' })).toThrow();
    expect(() =>
      loadConfig({
        AUTH_ENABLED: 'true',
        DATABASE_ENABLED: 'true',
        DATABASE_URL: 'mysql://user:fixture@localhost/test',
        AUTH_ENCRYPTION_KEY: 'inválida',
      }),
    ).toThrow();
  });
  it('não permite instrumentar corpos sensíveis pela observabilidade', () => {
    expect(() =>
      loadConfig({
        AUTH_ENABLED: 'true',
        DATABASE_ENABLED: 'true',
        DATABASE_URL: 'mysql://user:fixture@localhost/test',
        AUTH_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        OBSERVE_ENABLED: 'true',
        OBSERVE_APP_KEY: 'fixture',
        OBSERVE_APP_SECRET: 'fixture',
      }),
    ).toThrow();
  });
});

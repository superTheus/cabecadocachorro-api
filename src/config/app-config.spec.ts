import { loadConfig } from './app-config.js';

const integration = {
  MUIRASOFT_BASE_URL: 'https://erp.example/back/',
  MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
  MUIRASOFT_COMPANY_ID: '42',
  MUIRASOFT_CHANNEL: 'cabeca-do-cachorro',
};

describe('Configuração da fundação', () => {
  it('permite desenvolvimento sem serviços externos, com prontidão separada', () => {
    const config = loadConfig({});
    expect(config.database.enabled).toBe(false);
    expect(config.integrationConfigured).toBe(false);
    expect(config.observe.enabled).toBe(false);
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
  });
  it('normaliza base com subpasta e conserva o vínculo de empresa/canal', () => {
    const config = loadConfig(integration);
    expect(config.muirasoft.baseUrl).toBe('https://erp.example/back');
    expect(config.muirasoft.companyId).toBe(42);
    expect(config.integrationConfigured).toBe(true);
  });
  it.each([
    { PORT: '0' },
    { PORT: '3000abc' },
    { DATABASE_ENABLED: 'yes' },
    { DATABASE_ENABLED: 'true' },
    {
      DATABASE_ENABLED: 'true',
      DATABASE_URL: 'postgres://secret@localhost/shop',
    },
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://shop.example/path' },
    { MUIRASOFT_TOKEN: 'segredo-invalido' },
    { MUIRASOFT_BASE_URL: 'https://erp.example' },
    { ...integration, MUIRASOFT_BASE_URL: 'http://erp.example' },
    { ...integration, MUIRASOFT_BASE_URL: 'https://erp.example/integracao/v1' },
    { ...integration, MUIRASOFT_BASE_URL: 'https://user:secret@erp.example' },
    { ...integration, MUIRASOFT_BASE_URL: 'https://erp.example?token=secret' },
    { ...integration, MUIRASOFT_COMPANY_ID: '1.5' },
    { ...integration, MUIRASOFT_CHANNEL: '../other' },
    { MUIRASOFT_TIMEOUT_MS: '0' },
    { OBSERVE_ENABLED: 'true' },
  ])(
    'rejeita valores perigosos ou parciais sem mostrar segredos: %j',
    (env) => {
      expect(() => loadConfig(env)).toThrow('Configuração inválida:');
      try {
        loadConfig(env);
      } catch (error) {
        expect(String(error)).not.toContain('segredo-invalido');
        expect(String(error)).not.toContain('user:secret');
      }
    },
  );
  it('exige banco e origem explícitos em produção', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('STORE_URL');
    const base = {
      NODE_ENV: 'production',
      STORE_URL: 'https://loja.example',
      CORS_ORIGINS: 'https://loja.example',
      ...integration,
    };
    expect(() => loadConfig(base)).toThrow('DATABASE_ENABLED');
    expect(() =>
      loadConfig({
        ...base,
        DATABASE_ENABLED: 'true',
        DATABASE_URL: 'mysql://store:password@localhost/shop',
      }),
    ).not.toThrow();
  });

  it('exige TLS com certificado válido para banco remoto em produção', () => {
    const env = {
      NODE_ENV: 'production',
      STORE_URL: 'https://loja.example',
      CORS_ORIGINS: 'https://loja.example',
      DATABASE_ENABLED: 'true',
      DATABASE_URL: 'mysql://store:password@database.example/shop',
      ...integration,
    };
    expect(() => loadConfig(env)).toThrow('DATABASE_SSL');
    expect(loadConfig({ ...env, DATABASE_SSL: 'true' }).database.ssl).toBe(
      true,
    );
  });
});

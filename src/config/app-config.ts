export interface DatabaseConfig {
  readonly enabled: boolean;
  readonly url?: string;
  readonly ssl: boolean;
}

export interface MuiraSoftConfig {
  readonly baseUrl?: string;
  readonly token?: string;
  readonly companyId?: number;
  readonly channel?: string;
  readonly timeoutMs: number;
}

export class AppConfig {
  constructor(
    readonly environment: 'development' | 'test' | 'production',
    readonly port: number,
    readonly store: Readonly<{ id: string; url: string }>,
    readonly corsOrigins: readonly string[],
    readonly database: Readonly<DatabaseConfig>,
    readonly muirasoft: Readonly<MuiraSoftConfig>,
    readonly observe: Readonly<{
      enabled: boolean;
      appKey?: string;
      appSecret?: string;
    }>,
  ) {}

  get integrationConfigured(): boolean {
    return !!(
      this.muirasoft.baseUrl &&
      this.muirasoft.token &&
      this.muirasoft.companyId &&
      this.muirasoft.channel
    );
  }
}

function invalid(name: string): never {
  // Configuration errors name the variable, never its potentially secret value.
  throw new Error(`Configuração inválida: ${name}.`);
}

function boolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') invalid(name);
  return value === 'true';
}

function integer(
  value: string | undefined,
  name: string,
  fallback: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) invalid(name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
    invalid(name);
  return parsed;
}

function httpUrl(
  value: string,
  name: string,
  production: boolean,
  originOnly = false,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid(name);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid(name);
  if (production && url.protocol !== 'https:') invalid(name);
  if (originOnly && url.pathname !== '/') invalid(name);
  return originOnly ? url.origin : url.href.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(environment))
    invalid('NODE_ENV');
  const production = environment === 'production';
  const storeId = env.STORE_ID || 'cabeca-do-cachorro';
  if (!/^[a-z0-9][a-z0-9_-]{1,99}$/.test(storeId)) invalid('STORE_ID');
  if (production && !env.STORE_URL) invalid('STORE_URL');
  const storeUrl = httpUrl(
    env.STORE_URL || 'http://localhost:5173',
    'STORE_URL',
    production,
    true,
  );
  if (production && !env.CORS_ORIGINS) invalid('CORS_ORIGINS');
  const origins = (env.CORS_ORIGINS || storeUrl)
    .split(',')
    .map((origin) => httpUrl(origin.trim(), 'CORS_ORIGINS', production, true));

  const enabled = boolean(env, 'DATABASE_ENABLED', false);
  const databaseSsl = boolean(env, 'DATABASE_SSL', false);
  const databaseUrl = env.DATABASE_URL || undefined;
  if (enabled) {
    if (!databaseUrl) invalid('DATABASE_URL');
    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      invalid('DATABASE_URL');
    }
    if (
      parsed.protocol !== 'mysql:' ||
      !parsed.hostname ||
      !parsed.username ||
      !parsed.pathname.slice(1) ||
      parsed.search ||
      parsed.hash
    )
      invalid('DATABASE_URL');
    if (
      production &&
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
      !databaseSsl
    )
      invalid('DATABASE_SSL');
  }
  if (production && !enabled) invalid('DATABASE_ENABLED');

  const baseUrl = env.MUIRASOFT_BASE_URL
    ? httpUrl(env.MUIRASOFT_BASE_URL, 'MUIRASOFT_BASE_URL', production)
    : undefined;
  if (baseUrl) {
    const upstream = new URL(baseUrl);
    if (
      upstream.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname)
    )
      invalid('MUIRASOFT_BASE_URL');
  }
  if (baseUrl && /\/integracao\/v\d+$/.test(baseUrl))
    invalid('MUIRASOFT_BASE_URL');
  const token = env.MUIRASOFT_TOKEN || undefined;
  if (token && !/^muira_live_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token))
    invalid('MUIRASOFT_TOKEN');
  const companyId = env.MUIRASOFT_COMPANY_ID
    ? integer(
        env.MUIRASOFT_COMPANY_ID,
        'MUIRASOFT_COMPANY_ID',
        1,
        Number.MAX_SAFE_INTEGER,
      )
    : undefined;
  const channel = env.MUIRASOFT_CHANNEL || undefined;
  if (channel && !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(channel))
    invalid('MUIRASOFT_CHANNEL');
  const supplied = [baseUrl, token, companyId, channel].filter(
    (value) => value !== undefined,
  ).length;
  if ((supplied !== 0 && supplied !== 4) || (production && supplied !== 4))
    invalid('MUIRASOFT_BASE_URL/TOKEN/COMPANY_ID/CHANNEL');

  const observeEnabled = boolean(env, 'OBSERVE_ENABLED', false);
  if (
    observeEnabled &&
    (!env.OBSERVE_APP_KEY ||
      !env.OBSERVE_APP_SECRET ||
      env.OBSERVE_APP_KEY === 'YOUR_APP_KEY' ||
      env.OBSERVE_APP_SECRET === 'YOUR_APP_SECRET')
  )
    invalid('OBSERVE_APP_KEY/OBSERVE_APP_SECRET');

  return new AppConfig(
    environment as AppConfig['environment'],
    integer(env.PORT, 'PORT', 3000, 65535),
    Object.freeze({ id: storeId, url: storeUrl }),
    Object.freeze([...new Set(origins)]),
    Object.freeze({ enabled, url: databaseUrl, ssl: databaseSsl }),
    Object.freeze({
      baseUrl,
      token,
      companyId,
      channel,
      timeoutMs: integer(
        env.MUIRASOFT_TIMEOUT_MS,
        'MUIRASOFT_TIMEOUT_MS',
        5000,
        30000,
      ),
    }),
    Object.freeze({
      enabled: observeEnabled,
      appKey: env.OBSERVE_APP_KEY,
      appSecret: env.OBSERVE_APP_SECRET,
    }),
  );
}

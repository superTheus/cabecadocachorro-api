import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { AppConfig } from '../config/app-config.js';
import { databaseOptions } from './data-source-options.js';
import { DatabaseService } from './database.service.js';

function config(enabled = true): AppConfig {
  return {
    database: {
      enabled,
      url: 'mysql://store:password@127.0.0.1:3306/store_test',
    },
    store: { id: 'cabeca-do-cachorro' },
    muirasoft: {
      baseUrl: 'https://erp.example.test/back/',
      companyId: 7,
      channel: 'cabeca-do-cachorro',
    },
  } as unknown as AppConfig;
}

const binding = {
  muirasoft_base_url: 'https://erp.example.test/back',
  muirasoft_company_id: '7',
  muirasoft_channel: 'cabeca-do-cachorro',
};

type QueryCallback = (error: Error | null, rows?: unknown) => void;

function createSpies() {
  const query = vi.fn(
    (
      _options: { sql: string; timeout: number },
      _params: unknown[],
      done: QueryCallback,
    ) => {
      done(null, []);
    },
  );
  const connection = { query, destroy: vi.fn() };
  const runner = {
    connect: vi.fn().mockResolvedValue(connection),
    release: vi.fn().mockResolvedValue(undefined),
  };
  return {
    initialize: vi
      .spyOn(DataSource.prototype, 'initialize')
      .mockImplementation(function (this: DataSource) {
        Object.defineProperty(this, 'isInitialized', {
          value: true,
          writable: true,
        });
        return Promise.resolve(this);
      }),
    query,
    connection,
    runner,
    createRunner: vi
      .spyOn(DataSource.prototype, 'createQueryRunner')
      .mockReturnValue(runner as unknown as QueryRunner),
    destroy: vi.spyOn(DataSource.prototype, 'destroy').mockResolvedValue(),
  };
}

describe('DatabaseService', () => {
  let spies: ReturnType<typeof createSpies>;
  beforeEach(() => {
    spies = createSpies();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not connect or report readiness when explicitly disabled', async () => {
    const service = new DatabaseService(config(false));
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(spies.initialize).not.toHaveBeenCalled();
    expect(service.connection).toBeNull();
    expect(await service.isHealthy()).toBe(false);
    expect(await service.verifyBinding()).toBe(false);
  });

  it('never synchronizes or applies migrations at application startup', () => {
    const options = databaseOptions(config());
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.logging).toBe(false);
  });

  it('does not report a database with missing migration tables as healthy', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    spies.query
      .mockImplementationOnce((_options, _params, done) => {
        done(null, []);
      })
      .mockImplementationOnce((_options, _params, done) => {
        done(new Error('integration_operations is missing'));
      });
    expect(await service.isHealthy()).toBe(false);
  });

  it('checks both migration tables and closes its initialized connection', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    expect(await service.isHealthy()).toBe(true);
    expect(spies.query).toHaveBeenCalledWith(
      { sql: 'SELECT id FROM store_bindings LIMIT 1', timeout: 2000 },
      [],
      expect.any(Function),
    );
    expect(spies.query).toHaveBeenCalledWith(
      { sql: 'SELECT id FROM integration_operations LIMIT 1', timeout: 2000 },
      [],
      expect.any(Function),
    );
    await service.onModuleDestroy();
    expect(spies.destroy).toHaveBeenCalledOnce();
  });

  it('requires an explicit matching persisted storefront binding', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    expect(await service.verifyBinding()).toBe(false);
    spies.query.mockImplementation((_options, _params, done) => {
      done(null, [binding]);
    });
    expect(await service.verifyBinding()).toBe(true);
    expect(spies.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('WHERE store_id = ?'),
        timeout: 2000,
      }),
      ['cabeca-do-cachorro'],
      expect.any(Function),
    );
  });

  it.each([
    { ...binding, muirasoft_company_id: '8' },
    { ...binding, muirasoft_channel: 'outra-loja' },
    { ...binding, muirasoft_base_url: 'https://outro-erp.example.test/back' },
  ])(
    'rejects a different merchant context or MuiraSoft instance: %j',
    async (other) => {
      const service = new DatabaseService(config());
      await service.onModuleInit();
      spies.query.mockImplementation((_options, _params, done) => {
        done(null, [other]);
      });
      expect(await service.verifyBinding()).toBe(false);
    },
  );

  it('bounds a stalled SQL probe and destroys the busy connection', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    vi.useFakeTimers();
    spies.query.mockImplementation(() => undefined);
    const pending = service.isHealthy();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBe(false);
    expect(spies.connection.destroy).toHaveBeenCalledOnce();
    expect(spies.runner.release).toHaveBeenCalledOnce();
  });

  it('bounds binding verification even when SQL never responds', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    vi.useFakeTimers();
    spies.query.mockImplementation(() => undefined);
    const pending = service.verifyBinding();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBe(false);
    expect(spies.connection.destroy).toHaveBeenCalledOnce();
  });

  it('returns on pool timeout and releases a connection acquired later without querying', async () => {
    const service = new DatabaseService(config());
    await service.onModuleInit();
    vi.useFakeTimers();
    let acquired: (value: unknown) => void = () => undefined;
    spies.runner.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acquired = resolve;
        }),
    );
    const pending = service.isHealthy();
    await vi.advanceTimersByTimeAsync(2001);
    expect(await pending).toBe(false);
    expect(spies.query).not.toHaveBeenCalled();
    acquired(spies.connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(spies.runner.release).toHaveBeenCalledOnce();
    expect(spies.query).not.toHaveBeenCalled();
  });

  it('does not expose driver messages containing credentials', async () => {
    spies.initialize.mockRejectedValueOnce(
      new Error('Access denied: mysql://store:secret-password@127.0.0.1/store'),
    );
    await expect(new DatabaseService(config()).onModuleInit()).rejects.toThrow(
      /^Não foi possível conectar ao banco da loja\.$/,
    );
  });
});

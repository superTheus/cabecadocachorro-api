import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { PoolConnection } from 'mysql2';
import { AppConfig } from '../config/app-config.js';
import { createDatabaseSource } from './data-source-options.js';

type StoreBinding = {
  muirasoft_base_url: string;
  muirasoft_company_id: string | number;
  muirasoft_channel: string;
};

const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private source: DataSource | null = null;

  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}

  get isEnabled(): boolean {
    return this.config.database.enabled;
  }

  /** Server-side infrastructure access; never exposed through an HTTP route. */
  get connection(): DataSource | null {
    return this.source;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled) return;

    try {
      this.source = createDatabaseSource(this.config);
      await this.source.initialize();
    } catch {
      // Driver messages can include the URL, username or password.
      throw new Error('Não foi possível conectar ao banco da loja.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.source?.isInitialized) await this.source.destroy();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.source?.isInitialized) return false;
    try {
      // A reachable server without the application's migrations is not ready.
      await this.probeQuery('SELECT id FROM store_bindings LIMIT 1');
      await this.probeQuery('SELECT id FROM integration_operations LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** A changed token must not silently bind a storefront to another company. */
  async verifyBinding(): Promise<boolean> {
    const { baseUrl, companyId, channel } = this.config.muirasoft;
    if (!this.source?.isInitialized || !baseUrl || !companyId || !channel) {
      return false;
    }

    try {
      const rows = await this.probeQuery<StoreBinding>(
        `SELECT muirasoft_base_url, muirasoft_company_id, muirasoft_channel
           FROM store_bindings WHERE store_id = ? LIMIT 1`,
        [this.config.store.id],
      );
      const binding = rows[0];
      return (
        !!binding &&
        binding.muirasoft_base_url === baseUrl.replace(/\/+$/, '') &&
        String(binding.muirasoft_company_id) === String(companyId) &&
        binding.muirasoft_channel === channel
      );
    } catch {
      return false;
    }
  }

  /** Bounds pool acquisition and SQL execution, not merely the initial TCP connection. */
  private async probeQuery<T>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    if (!this.source?.isInitialized) throw new Error('Banco indisponível.');
    const runner = this.source.createQueryRunner();

    return new Promise<T[]>((resolve, reject) => {
      let connection: PoolConnection | undefined;
      let finished = false;
      const release = () => {
        void runner.release().catch(() => undefined);
      };
      const fail = (destroyConnection = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (connection) {
          if (destroyConnection) connection.destroy();
          release();
        }
        reject(new Error('Consulta de prontidão do banco indisponível.'));
      };
      const deadline = setTimeout(() => fail(true), PROBE_TIMEOUT_MS);

      // connect() is a public QueryRunner API. Late acquisitions are released
      // without issuing SQL, including when the pool stayed busy past our deadline.
      void runner
        .connect()
        .then((native: PoolConnection) => {
          connection = native;
          if (finished) {
            release();
            return;
          }
          native.query(
            { sql, timeout: PROBE_TIMEOUT_MS },
            parameters,
            (error, rows) => {
              if (finished) return;
              if (error) {
                fail(error.code === 'PROTOCOL_SEQUENCE_TIMEOUT');
                return;
              }
              if (!Array.isArray(rows)) {
                fail();
                return;
              }
              finished = true;
              clearTimeout(deadline);
              release();
              resolve(rows as T[]);
            },
          );
        })
        .catch(() => fail());
    });
  }
}

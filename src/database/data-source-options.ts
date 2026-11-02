import { CustomerAccounts1793383200000 } from './migrations/1793383200000-customer-accounts.js';
import { DataSource } from 'typeorm';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions.js';
import type { AppConfig } from '../config/app-config.js';
import { StoreIntegrationFoundation1793296800000 } from './migrations/1793296800000-store-integration-foundation.js';

/** This database belongs to the storefront, never to MuiraSoft. */
export function databaseOptions(config: AppConfig): MysqlConnectionOptions {
  if (!config.database.url) {
    throw new Error('Configure DATABASE_URL para acessar o banco da loja.');
  }

  return {
    type: 'mysql',
    connectorPackage: 'mysql2',
    url: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: true } : undefined,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 5_000,
    poolSize: 5,
    entities: [],
    migrations: [
      StoreIntegrationFoundation1793296800000,
      CustomerAccounts1793383200000,
    ],
    migrationsTableName: 'store_migrations',
    migrationsTransactionMode: 'each',
    synchronize: false,
    migrationsRun: false,
    logging: false,
  };
}

export function createDatabaseSource(config: AppConfig): DataSource {
  return new DataSource(databaseOptions(config));
}

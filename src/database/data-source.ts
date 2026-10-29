import 'reflect-metadata';
import { loadConfig } from '../config/app-config.js';
import { createDatabaseSource } from './data-source-options.js';

const config = loadConfig();
if (!config.database.enabled) {
  throw new Error('Ative DATABASE_ENABLED para executar migrations da loja.');
}

/** TypeORM CLI only: application startup never executes migrations. */
export default createDatabaseSource(config);

import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { loadConfig } from '../config/app-config.js';
import { createDatabaseSource } from '../database/data-source-options.js';

let source: DataSource | undefined;
try {
  const command = process.argv[2];
  if (!['run', 'show', 'revert'].includes(command ?? ''))
    throw new Error('Comando inválido.');
  const config = loadConfig();
  if (!config.database.enabled) throw new Error('Banco desabilitado.');
  source = createDatabaseSource(config);
  await source.initialize();
  if (command === 'run') {
    const migrations = await source.runMigrations();
    console.log(
      `${migrations.length} migration(s) aplicada(s) ao banco configurado da loja.`,
    );
  } else if (command === 'show') {
    console.log(
      (await source.showMigrations())
        ? 'Existem migrations pendentes.'
        : 'Nenhuma migration pendente.',
    );
  } else {
    await source.undoLastMigration();
    console.log('Reversão explícita da última migration concluída.');
  }
} catch {
  console.error(
    'Falha na operação de migrations. Verifique a configuração, as permissões e o estado do schema exclusivo da loja.',
  );
  process.exitCode = 1;
} finally {
  if (source?.isInitialized) await source.destroy();
}

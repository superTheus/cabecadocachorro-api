import { loadConfig } from '../config/app-config.js';
import { createDatabaseSource } from '../database/data-source-options.js';
import { AuthMailWorker } from '../auth/auth-mail.worker.js';
const config = loadConfig();
const db = createDatabaseSource(config);
try {
  if (!config.auth.enabled) throw new Error();
  await db.initialize();
  const worker = new AuthMailWorker(db, config);
  let count = 0;
  while (count < 50 && (await worker.runOne())) count++;
  console.log('Mensagens processadas:', count);
} catch {
  console.error(
    'Não foi possível processar as mensagens de conta. Confira configuração, banco e integração.',
  );
  process.exitCode = 1;
} finally {
  if (db.isInitialized) await db.destroy();
}

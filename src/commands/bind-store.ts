import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';

let database: DatabaseService | undefined;
try {
  const config = loadConfig();
  if (!config.database.enabled) throw new Error('Banco desabilitado.');
  // A binding can only be persisted after the real credential confirms its context.
  await new MuiraSoftClient(config).checkConnection();
  database = new DatabaseService(config);
  await database.onModuleInit();
  if (!(await database.isHealthy())) throw new Error('Execute as migrations.');
  const db = database.connection!;
  const existing = await db.query<Array<{ id: string }>>(
    'SELECT id FROM store_bindings WHERE store_id=?',
    [config.store.id],
  );
  if (existing.length) {
    if (!(await database.verifyBinding()))
      throw new Error('Vínculo divergente.');
    console.log('Vínculo existente confirmado.');
  } else {
    await db.query(
      'INSERT INTO store_bindings(id,store_id,muirasoft_base_url,muirasoft_company_id,muirasoft_channel) VALUES(?,?,?,?,?)',
      [
        randomUUID(),
        config.store.id,
        config.muirasoft.baseUrl,
        config.muirasoft.companyId,
        config.muirasoft.channel,
      ],
    );
    console.log('Vínculo da loja registrado após validação da integração.');
  }
} catch {
  console.error(
    'Não foi possível registrar o vínculo. Verifique migrations, integração e eventual vínculo anterior. Um vínculo existente não é sobrescrito.',
  );
  process.exitCode = 1;
} finally {
  await database?.onModuleDestroy();
}

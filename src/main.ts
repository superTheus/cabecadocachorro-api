import { createApplication } from './bootstrap.js';
import { loadConfig } from './config/app-config.js';

async function bootstrap() {
  const config = loadConfig();
  const app = await createApplication(config);
  try {
    await app.listen(config.port);
  } catch (error) {
    await app.close();
    throw error;
  }
}
await bootstrap().catch((error: unknown) => {
  // Never print arbitrary errors: network/driver errors can contain secrets.
  console.error(
    error instanceof Error && error.message.startsWith('Configuração inválida:')
      ? error.message
      : 'Não foi possível iniciar a API. Verifique a configuração e as dependências.',
  );
  process.exitCode = 1;
});

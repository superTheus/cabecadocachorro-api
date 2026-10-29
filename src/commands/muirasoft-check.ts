import { loadConfig } from '../config/app-config.js';
import { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';

try {
  await new MuiraSoftClient(loadConfig()).checkConnection();
  console.log(
    'Conexão MuiraSoft validada para a empresa e o canal configurados.',
  );
} catch {
  console.error(
    'Não foi possível validar a integração. Confira configuração, credencial e disponibilidade do MuiraSoft.',
  );
  process.exitCode = 1;
}

import { spawn } from 'node:child_process';
import { createApplication } from '../dist/bootstrap.js';
import { loadConfig } from '../dist/config/app-config.js';

const app = await createApplication(loadConfig({ NODE_ENV: 'test' }));
try {
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const child = spawn(
    'postman',
    [
      'collection',
      'run',
      'postman/collections/foundation.postman_collection.json',
      '--env-var',
      `base_url=${baseUrl}`,
      '--reporters',
      'cli',
    ],
    { stdio: 'inherit' },
  );
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) throw new Error('A coleção HTTP não passou.');
} finally {
  await app.close();
}

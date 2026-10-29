import type { Response } from 'express';
import { loadConfig } from '../config/app-config.js';
import type { DatabaseService } from '../database/database.service.js';
import type { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';
import { HealthController } from './health.controller.js';

it('agrupa probes pendentes e inicia a janela de cache somente após sua conclusão', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    MUIRASOFT_BASE_URL: 'http://127.0.0.1:4900',
    MUIRASOFT_TOKEN: `muira_live_${'a'.repeat(32)}.${'b'.repeat(43)}`,
    MUIRASOFT_COMPANY_ID: '42',
    MUIRASOFT_CHANNEL: 'loja-teste',
  });
  let finish!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const database = {
    isEnabled: true,
    isHealthy: vi.fn().mockReturnValue(pending),
    verifyBinding: vi.fn().mockResolvedValue(true),
  };
  const client = { checkConnection: vi.fn().mockResolvedValue({}) };
  const response = { status: vi.fn() } as unknown as Response;
  const controller = new HealthController(
    config,
    database as unknown as DatabaseService,
    client as unknown as MuiraSoftClient,
  );
  const time = vi.spyOn(Date, 'now').mockReturnValue(0);
  try {
    const first = controller.ready(response);
    time.mockReturnValue(10000);
    const second = controller.ready(response);
    expect(client.checkConnection).toHaveBeenCalledTimes(1);
    finish(true);
    await Promise.all([first, second]);
    time.mockReturnValue(14999);
    await controller.ready(response);
    expect(client.checkConnection).toHaveBeenCalledTimes(1);
    time.mockReturnValue(15001);
    await controller.ready(response);
    expect(client.checkConnection).toHaveBeenCalledTimes(2);
  } finally {
    time.mockRestore();
  }
});

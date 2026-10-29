import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { MuiraSoftClient } from '../integrations/muirasoft/muirasoft.client.js';

@Controller('health')
export class HealthController {
  private readiness?: Promise<{ databaseUp: boolean; muirasoftUp: boolean }>;
  private readinessExpiresAt = 0;
  private readinessPending = false;
  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MuiraSoftClient) private readonly muirasoft: MuiraSoftClient,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    // Coalesce public probes and bound upstream traffic (at most 12 probes/min/process).
    // This cache is only for health; commercial calls always revalidate their context.
    if (
      !this.readiness ||
      (!this.readinessPending && Date.now() >= this.readinessExpiresAt)
    ) {
      this.readinessPending = true;
      this.readiness = Promise.all([
        this.database
          .isHealthy()
          .then(
            async (healthy) => healthy && (await this.database.verifyBinding()),
          )
          .catch(() => false),
        this.config.integrationConfigured
          ? this.muirasoft
              .checkConnection()
              .then(() => true)
              .catch(() => false)
          : Promise.resolve(false),
      ])
        .then(([databaseUp, muirasoftUp]) => ({ databaseUp, muirasoftUp }))
        .finally(() => {
          this.readinessPending = false;
          this.readinessExpiresAt = Date.now() + 5000;
        });
    }
    const { databaseUp, muirasoftUp } = await this.readiness;
    const ready = databaseUp && muirasoftUp;
    response.status(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database: !this.database.isEnabled
          ? 'disabled'
          : databaseUp
            ? 'up'
            : 'down',
        muirasoft: !this.config.integrationConfigured
          ? 'not_configured'
          : muirasoftUp
            ? 'up'
            : 'down',
      },
    };
  }
}

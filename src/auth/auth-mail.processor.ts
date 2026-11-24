import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthMailWorker } from './auth-mail.worker.js';

@Injectable()
export class AuthMailProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private readonly logger = new Logger(AuthMailProcessor.name);

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.auth.enabled || this.config.environment === 'test') return;
    if (!this.config.mailConfigured) {
      this.logger.warn(
        'E-mails de conta aguardando configuração SMTP da loja.',
      );
      return;
    }
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.process().finally(() => this.schedule(5000));
    }, delay);
    this.timer.unref();
  }

  private async process(): Promise<void> {
    if (!this.database.connection?.isInitialized) return;
    try {
      const worker = new AuthMailWorker(this.database.connection, this.config);
      for (let i = 0; i < 20 && !this.stopped; i++) {
        if (!(await worker.runOne())) break;
      }
    } catch {
      this.logger.warn('Não foi possível processar a fila de e-mails da loja.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}

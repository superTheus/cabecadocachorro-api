import { ForbiddenException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createObserveModule } from '@nestjs/observe';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';
import { AppConfig, loadConfig } from './config/app-config.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';

export async function createApplication(
  config: AppConfig = loadConfig(),
): Promise<NestExpressApplication> {
  const observe = config.observe.enabled ? createObserveModule() : undefined;
  const observeModule = observe?.ObserveModule.forRoot({
    appKey: config.observe.appKey!,
    appSecret: config.observe.appSecret!,
    serviceId: 'cabeca-cachorro-api',
  });
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config, observeModule),
    {
      ...(observe ? { instrument: observe.ObserveInstrument } : {}),
      logger: config.environment === 'test' ? false : ['log', 'warn', 'error'],
      abortOnError: false,
    },
  );
  app.disable('x-powered-by');
  if (config.trustedProxies.length)
    app.set('trust proxy', config.trustedProxies);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', randomUUID());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: (origin, callback) =>
      callback(
        origin && !config.corsOrigins.includes(origin)
          ? new ForbiddenException()
          : null,
        true,
      ),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}

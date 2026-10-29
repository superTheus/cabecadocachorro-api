import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

@Module({})
export class AppModule {
  static register(config: AppConfig, observe?: DynamicModule): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        HealthModule,
        ...(observe ? [observe] : []),
      ],
    };
  }
}

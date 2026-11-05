import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { OrdersModule } from './orders/orders.module.js';
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
        AuthModule,
        CatalogModule,
        CheckoutModule,
        OrdersModule,
        ...(observe ? [observe] : []),
      ],
    };
  }
}

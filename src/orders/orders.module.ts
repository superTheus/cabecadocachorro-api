import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { MuiraSoftModule } from '../integrations/muirasoft/muirasoft.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
@Module({
  imports: [AuthModule, DatabaseModule, MuiraSoftModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}

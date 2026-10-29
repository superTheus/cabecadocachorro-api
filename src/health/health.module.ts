import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MuiraSoftModule } from '../integrations/muirasoft/muirasoft.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule, MuiraSoftModule],
  controllers: [HealthController],
})
export class HealthModule {}

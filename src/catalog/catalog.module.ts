import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { MuiraSoftModule } from '../integrations/muirasoft/muirasoft.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({
  imports: [DatabaseModule, MuiraSoftModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}

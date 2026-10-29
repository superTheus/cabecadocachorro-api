import { Module } from '@nestjs/common';
import { MuiraSoftClient } from './muirasoft.client.js';

@Module({
  providers: [MuiraSoftClient],
  exports: [MuiraSoftClient],
})
export class MuiraSoftModule {}

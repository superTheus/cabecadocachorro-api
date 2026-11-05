import { CustomerService } from './customer.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
@Module({
  imports: [DatabaseModule],
  providers: [AuthService, CustomerService],
  controllers: [AuthController],
  exports: [AuthService, CustomerService],
})
export class AuthModule {}

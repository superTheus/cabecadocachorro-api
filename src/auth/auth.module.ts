import { CustomerService } from './customer.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthMailProcessor } from './auth-mail.processor.js';
@Module({
  imports: [DatabaseModule],
  providers: [AuthService, CustomerService, AuthMailProcessor],
  controllers: [AuthController],
  exports: [AuthService, CustomerService],
})
export class AuthModule {}

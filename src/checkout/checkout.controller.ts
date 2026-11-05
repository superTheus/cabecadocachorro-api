import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { CheckoutService } from './checkout.service.js';
@Controller('checkout')
export class CheckoutController {
  private reads = new Map<string, { count: number; until: number }>();
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  private session(r: Request) {
    return (
      (r.headers.cookie || '')
        .split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('cabeca_session='))
        ?.slice(15) || ''
    );
  }
  private read(r: Request) {
    const ip = r.ip || 'unknown',
      now = Date.now();
    let row = this.reads.get(ip);
    if (!row || row.until < now) {
      for (const [k, v] of this.reads) if (v.until < now) this.reads.delete(k);
      if (this.reads.size >= 4096 && !this.reads.has(ip))
        throw new HttpException('Limite', 429);
      row = { count: 0, until: now + 60000 };
      this.reads.set(ip, row);
    }
    if (++row.count > 60) throw new HttpException('Limite', 429);
  }
  private async write(r: Request) {
    if (r.headers.origin !== this.auth.config.store.url)
      throw new ForbiddenException();
    await this.auth.rate(r.ip || 'unknown');
  }
  @Get('options') options(
    @Req() r: Request,
    @Query() q: Record<string, unknown>,
  ) {
    this.read(r);
    if (Object.keys(q).length !== 1 || typeof q.address_id !== 'string')
      throw new ForbiddenException();
    return this.checkout.options(this.session(r), q.address_id);
  }
  @Post() @HttpCode(200) async prepare(
    @Req() r: Request,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    await this.write(r);
    return this.checkout.prepare(this.session(r), b, key || '');
  }
  @Get(':id') get(@Req() r: Request, @Param('id') id: string) {
    this.read(r);
    return this.checkout.get(this.session(r), id);
  }
  @Post(':id/confirm') @HttpCode(200) async confirm(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    await this.write(r);
    return this.checkout.confirm(this.session(r), id, b);
  }
  @Post(':id/payments') @HttpCode(200) async pay(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    await this.write(r);
    if (
      this.auth.config.observe.enabled ||
      (this.auth.config.environment === 'production' && !r.secure)
    )
      throw new ForbiddenException();
    return this.checkout.pay(this.session(r), id, b, key || '', r.ip || '');
  }
  @Get(':id/payments/:payment/pix') pix(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('payment') p: string,
  ) {
    this.read(r);
    return this.checkout.pix(this.session(r), id, p);
  }
}

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
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { OrdersService } from './orders.service.js';
@Controller('orders')
export class OrdersController {
  private reads = new Map<string, { n: number; until: number }>();
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get(':id/documents/:document/:format') async download(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('document') document: string,
    @Param('format') format: string,
    @Query() q: Record<string, unknown>,
    @Res() response: Response,
  ) {
    this.read(r);
    if (Object.keys(q).length) throw new ForbiddenException();
    const file = await this.orders.download(
      this.session(r),
      id,
      document,
      format,
    );
    response.setHeader('Content-Type', file.mime);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'",
    );
    response.send(file.content);
  }
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
    for (const [key, v] of this.reads)
      if (v.until <= now) this.reads.delete(key);
    let v = this.reads.get(ip);
    if (!v) {
      if (this.reads.size >= 4096) throw new HttpException('Limite', 429);
      v = { n: 0, until: now + 60000 };
      this.reads.set(ip, v);
    }
    if (++v.n > 60) throw new HttpException('Limite', 429);
  }
  private async write(r: Request) {
    if (r.headers.origin !== this.auth.config.store.url)
      throw new ForbiddenException();
    await this.auth.rate(r.ip || 'unknown');
  }
  @Get() list(@Req() r: Request, @Query() q: Record<string, unknown>) {
    this.read(r);
    return this.orders.list(this.session(r), q);
  }
  @Get(':id') get(
    @Req() r: Request,
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
  ) {
    this.read(r);
    if (Object.keys(q).length) throw new ForbiddenException();
    return this.orders.get(this.session(r), id);
  }
  @Post(':id/requests') @HttpCode(202) async submit(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    await this.write(r);
    return this.orders.submit(this.session(r), id, b, key || '');
  }
  @Post(':id/requests/:request/retry') @HttpCode(202) async retry(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('request') request: string,
    @Body() b: unknown,
  ) {
    await this.write(r);
    if (
      !b ||
      typeof b !== 'object' ||
      Array.isArray(b) ||
      Object.keys(b).length
    )
      throw new ForbiddenException();
    return this.orders.retry(this.session(r), id, request);
  }
}

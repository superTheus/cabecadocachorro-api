import {
  Body,
  Controller,
  Get,
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
import { CatalogService } from './catalog.service.js';
@Controller()
export class CatalogController {
  private readonly buckets = new Map<string, { at: number; count: number }>();
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}
  private limit(req: Request, write = false): void {
    const key = `${write ? 'cart' : 'catalog'}:${req.ip || 'unknown'}`,
      now = Date.now(),
      max = write ? 10 : 60;
    const old = this.buckets.get(key);
    const bucket = old && now - old.at < 60000 ? old : { at: now, count: 0 };
    if (bucket.count >= max)
      throw new HttpException('Limite de consultas', 429);
    if (this.buckets.size >= 4096 && !this.buckets.has(key)) {
      for (const [k, b] of this.buckets)
        if (now - b.at >= 60000) this.buckets.delete(k);
      if (this.buckets.size >= 4096)
        throw new HttpException('Limite de consultas', 429);
    }
    bucket.count++;
    this.buckets.set(key, bucket);
  }
  @Get('catalog/products') list(@Req() req: Request, @Query() q: unknown) {
    this.limit(req);
    return this.catalog.list(q);
  }
  @Get('catalog/images/:product/:image')
  async image(@Req() req: Request, @Param('product') product: string, @Param('image') image: string, @Res() res: Response) {
    this.limit(req);
    const file = await this.catalog.image(product, image);
    res.type(file.mime).send(file.content);
  }
  @Get('catalog/products/:id') detail(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    this.limit(req);
    return this.catalog.detail(id);
  }
  @Post('cart/validate') @HttpCode(200) validate(
    @Req() req: Request,
    @Body() b: unknown,
  ) {
    this.limit(req, true);
    return this.catalog.validate(b);
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Req,
  Res,
  HttpCode,
  ForbiddenException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CustomerService } from './customer.service.js';
const COOKIE = 'cabeca_session';
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CustomerService) private readonly customer: CustomerService,
  ) {}
  private origin(req: Request): void {
    if (req.headers.origin !== this.auth.config.store.url)
      throw new ForbiddenException();
  }
  private session(req: Request): string {
    return (
      (req.headers.cookie || '')
        .split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith(COOKIE + '='))
        ?.slice(COOKIE.length + 1) || ''
    );
  }
  private cookie(res: Response, value: string): void {
    res.cookie(COOKIE, value, {
      httpOnly: true,
      secure: this.auth.config.environment === 'production',
      sameSite: 'lax',
      path: '/api/v1',
      maxAge: value ? 7 * 86400 * 1000 : 0,
    });
  }
  @Put('profile')
  updateProfile(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.customer.profile(this.session(r), b);
  }
  @Get('addresses')
  addresses(@Req() r: Request) {
    return this.customer.list(this.session(r));
  }
  @Post('addresses')
  createAddress(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.customer.save(this.session(r), b);
  }
  @Put('addresses/:id')
  updateAddress(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    this.origin(r);
    return this.customer.save(this.session(r), b, id);
  }
  @Put('addresses/:id/default')
  defaultAddress(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    this.origin(r);
    return this.customer.setDefault(this.session(r), id, b);
  }
  @Delete('addresses/:id')
  deleteAddress(@Req() r: Request, @Param('id') id: string) {
    this.origin(r);
    return this.customer.remove(this.session(r), id);
  }
  @Post('register')
  @HttpCode(202)
  register(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.auth.register(b, r.ip || 'unknown');
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() r: Request,
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.origin(r);
    const result = await this.auth.login(b, r.ip || 'unknown');
    this.cookie(res, result.session);
    return result.user;
  }
  @Get('me') async me(@Req() r: Request) {
    return this.auth.profile(await this.auth.me(this.session(r)));
  }
  @Get('session') async currentSession(@Req() r: Request) {
    const session = this.session(r);
    if (!session) return { user: null };
    try {
      return { user: this.auth.profile(await this.auth.me(session)) };
    } catch (error) {
      if (error instanceof UnauthorizedException) return { user: null };
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() r: Request, @Res({ passthrough: true }) res: Response) {
    this.origin(r);
    const result = await this.auth.logout(this.session(r));
    this.cookie(res, '');
    return result;
  }
  @Post('forgot-password')
  @HttpCode(202)
  forgot(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.auth.sendAction(b, r.ip || 'unknown', 'reset');
  }
  @Post('resend-verification')
  @HttpCode(202)
  resend(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.auth.sendAction(b, r.ip || 'unknown', 'verify');
  }
  @Post('verify-email')
  @HttpCode(200)
  verify(@Req() r: Request, @Body() b: unknown) {
    this.origin(r);
    return this.auth.consume(b, r.ip || 'unknown', 'verify');
  }
  @Post('reset-password')
  @HttpCode(200)
  async reset(
    @Req() r: Request,
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.origin(r);
    const result = await this.auth.consume(b, r.ip || 'unknown', 'reset');
    this.cookie(res, '');
    return result;
  }
  @Post('change-password')
  @HttpCode(200)
  async change(
    @Req() r: Request,
    @Body() b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.origin(r);
    const result = await this.auth.changePassword(
      this.session(r),
      b,
      r.ip || 'unknown',
    );
    this.cookie(res, '');
    return result;
  }
}

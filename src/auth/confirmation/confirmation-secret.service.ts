import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema.js';
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

@Injectable()
export class ConfirmationSecretService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  private get secret(): string {
    return this.configService.get('CONFIRMATION_HMAC_SECRET', {
      infer: true,
    });
  }

  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashOtp(attemptId: string, code: string): string {
    const hmacSecret = this.secret;
    const hmac = createHmac('sha256', hmacSecret);
    hmac.update(`${attemptId}:${code}`);
    return hmac.digest('hex');
  }

  verifyOtp(attemptId: string, code: string, storedHash: string): boolean {
    const hashedCode = this.hashOtp(attemptId, code);
    const a = Buffer.from(hashedCode, 'hex');
    const b = Buffer.from(storedHash, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    const hmacSecret = this.secret;
    const hmac = createHmac('sha256', hmacSecret);
    hmac.update(token);
    return hmac.digest('hex');
  }
}

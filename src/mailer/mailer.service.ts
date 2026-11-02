import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema.js';
import nodemailer, { type Transporter } from 'nodemailer';
import { MailMessage } from './mail-message.js';

@Injectable()
export class MailerService {
  private readonly mailer: Transporter;
  constructor(private readonly configService: ConfigService<Env, true>) {
    this.mailer = nodemailer.createTransport({
      host: this.configService.get('SMTP_HOST', { infer: true }),
      port: this.configService.get('SMTP_PORT', { infer: true }),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.mailer.sendMail({
      from: this.configService.get('MAIL_FROM', { infer: true }),
      ...message,
    });
  }
}

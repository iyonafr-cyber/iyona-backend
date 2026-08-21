import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  onModuleInit() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is not set — Stripe functionality will be unavailable',
      );
      return;
    }
    this.stripe = new Stripe(key);
    this.logger.log('Stripe client initialized');
  }

  getClient(): Stripe {
    if (!this.stripe) {
      throw new Error(
        'Stripe client is not initialized. Set STRIPE_SECRET_KEY in your environment.',
      );
    }
    return this.stripe;
  }
}

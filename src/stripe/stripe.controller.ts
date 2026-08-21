import {
  Controller,
  Post,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
// import { RolesGuard } from '../auth/guards/roles.guard';
// import { Roles } from '../auth/decorator/roles.decorator';
// import { UserRole } from '../user/roles/roles.enum';
import { StripeSeedService } from './stripe-seed.service';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeSeedService: StripeSeedService) {}

  @Get('subscription-packages')
  async listSubscriptionPackages() {
    try {
      const data = await this.stripeSeedService.listSubscriptionPackages();
      return { data };
    } catch (err) {
      this.mapStripeConfigError(err);
    }
  }

  @UseGuards(AuthGuard)
  // @UseGuards(AuthGuard, RolesGuard)
  // @Roles(UserRole.ADMIN)
  @Post('subscription-packages/sync')
  @HttpCode(HttpStatus.OK)
  async syncSubscriptionPackages() {
    try {
      const data = await this.stripeSeedService.seed();
      return { data: { message: 'Sync complete', ...data } };
    } catch (err) {
      this.mapStripeConfigError(err);
    }
  }

  private mapStripeConfigError(err: unknown): never {
    if (
      err instanceof Error &&
      err.message.includes('Stripe client is not initialized')
    ) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY in the environment.',
      );
    }
    throw err;
  }
}

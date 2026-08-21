import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CreditsService } from '../credits.service';
import { CREDIT_ACTIONS, CreditActionKey } from '../constants/credit-actions';
import { CREDIT_ACTION_KEY } from '../decorator/credit-action.decorator';
import { InsufficientCreditsException } from '../exceptions/insufficient-credits.exception';
import { AuthedRequest } from '../types/authed-request';

/**
 * Pre-flight balance check for `@CreditAction(...)`-annotated handlers.
 *
 * Runs AFTER `AuthGuard` (so `request.fullUser` is populated) and BEFORE
 * the controller executes. If the user's balance is below the action's
 * `minReserve` floor we fail fast with HTTP 402 — no LLM call is made,
 * no Stripe dispute, no wasted tokens.
 *
 * Also stashes the action config on the request as `request.creditAction`
 * so controllers can read it without duplicating lookups.
 */
@Injectable()
export class CreditsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly creditsService: CreditsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const actionKey = this.reflector.getAllAndOverride<CreditActionKey>(
      CREDIT_ACTION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!actionKey) return true;

    const request = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = request.fullUser;
    if (!user?._id) {
      throw new UnauthorizedException(
        'Authentication required before credit check',
      );
    }

    const config = CREDIT_ACTIONS[actionKey];
    const balance = await this.creditsService.getBalance(String(user._id));
    if (balance.total < config.minReserve) {
      throw new InsufficientCreditsException({
        required: config.minReserve,
        balance: balance.total,
        action: actionKey,
      });
    }

    request.creditAction = config;
    request.creditBalance = balance;
    return true;
  }
}

import { SetMetadata } from '@nestjs/common';
import { CreditActionKey } from '../constants/credit-actions';

export const CREDIT_ACTION_KEY = 'creditAction';

/**
 * Tag a controller handler as a billable AI action. The `CreditsGuard`
 * reads this metadata to:
 *
 *   1. Reject the request with HTTP 402 when the caller's balance is
 *      below the action's `minReserve` floor.
 *   2. Stash the action config on the request so controllers can pass
 *      it to `CreditsService.withCredits(...)` without re-deriving it.
 *
 * Usage:
 *
 *   ```ts
 *   @CreditAction('generate_full_app')
 *   @Post('generate-code')
 *   async generateCode(...) { ... }
 *   ```
 */
export const CreditAction = (action: CreditActionKey) =>
  SetMetadata(CREDIT_ACTION_KEY, action);

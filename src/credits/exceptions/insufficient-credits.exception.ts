import { HttpException, HttpStatus } from '@nestjs/common';
import { CreditActionKey } from '../constants/credit-actions';

/**
 * Dedicated 402 response for a user hitting an empty/low balance. The
 * payload is intentionally user-friendly (no tokens, no models) so the
 * frontend can surface it verbatim.
 */
export class InsufficientCreditsException extends HttpException {
  constructor(params: {
    required: number;
    balance: number;
    action: CreditActionKey;
  }) {
    const required = params.required;
    const balance = params.balance;
    const lowBalance = balance < required;
    const message = lowBalance
      ? `You need ${required} credit${required === 1 ? '' : 's'} to run this action, ` +
        `but your balance is ${balance}. Upgrade your plan or buy a top-up pack to continue.`
      : `We could not reserve ${required} credit${required === 1 ? '' : 's'} for this action ` +
        `(your balance is ${balance}). Please try again in a moment. If this keeps happening, contact support.`;

    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Insufficient Credits',
        message,
        required,
        balance,
        action: params.action,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

import { Request } from 'express';
import { Types } from 'mongoose';
import { CreditActionConfig } from '../constants/credit-actions';
import { CreditBalance } from '../credits.service';

/**
 * Subset of the user document that auth + credit middleware rely on.
 * Avoids a circular import on the full `User` mongoose model and keeps
 * `req.fullUser` typed without using `any`.
 */
export interface AuthedUser {
  _id: Types.ObjectId | string;
  email?: string;
  role?: string;
}

export interface AuthedRequest extends Request {
  /** Populated by `AuthGuard` after token verification. */
  fullUser: AuthedUser;
  /** Populated by `CreditsGuard` when `@CreditAction(...)` is present. */
  creditAction?: CreditActionConfig;
  creditBalance?: CreditBalance;
}

import {
  parseSignupBonusCreditsEnv,
  signupWelcomeReferenceId,
} from './signup-bonus-credits';

describe('signupWelcomeReferenceId', () => {
  it('is stable per user', () => {
    expect(signupWelcomeReferenceId('abc123')).toBe('signup:welcome:abc123');
  });
});

describe('parseSignupBonusCreditsEnv', () => {
  it('defaults to 100 when unset or empty', () => {
    expect(parseSignupBonusCreditsEnv({})).toBe(100);
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '' })).toBe(100);
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '   ' })).toBe(
      100,
    );
  });

  it('returns 0 for zero or negative', () => {
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '0' })).toBe(0);
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '-5' })).toBe(0);
  });

  it('truncates positive integers', () => {
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '100' })).toBe(
      100,
    );
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '  42  ' })).toBe(
      42,
    );
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: '12.9' })).toBe(
      12,
    );
  });

  it('returns 0 for non-numeric', () => {
    expect(parseSignupBonusCreditsEnv({ SIGNUP_BONUS_CREDITS: 'abc' })).toBe(0);
  });
});

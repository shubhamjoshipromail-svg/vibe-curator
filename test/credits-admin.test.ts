import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { adminEmails, isAdminEmail, generationBudgets } from '../server/beta.ts';
import { reserveFailureMessage } from '../server/credit-messages.ts';

/**
 * The admin allowlist is a privilege boundary: matching it skips the credit
 * balance and both spend caps. These tests exist to keep three properties true
 * no matter how the surrounding code moves.
 *
 *   1. The allowlist comes only from server environment.
 *   2. An anonymous viewer carries no email and can never match.
 *   3. A signed-in address that is not listed is still limited.
 */

const ORIGINAL = process.env.ADMIN_EMAILS;

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

after(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL;
});

describe('admin allowlist', () => {
  it('matches nobody when ADMIN_EMAILS is unset', () => {
    assert.equal(adminEmails().size, 0);
    assert.equal(isAdminEmail('owner@example.com'), false);
    assert.equal(isAdminEmail(undefined), false);
  });

  it('matches nobody when ADMIN_EMAILS is empty or only separators', () => {
    for (const value of ['', '   ', ',', ' , , ']) {
      process.env.ADMIN_EMAILS = value;
      assert.equal(adminEmails().size, 0, `expected no entries for ${JSON.stringify(value)}`);
      assert.equal(isAdminEmail('owner@example.com'), false);
      assert.equal(isAdminEmail(undefined), false);
    }
  });

  it('matches a listed address case-insensitively and ignores padding', () => {
    process.env.ADMIN_EMAILS = ' Owner@Example.com , second@example.com ';
    assert.equal(isAdminEmail('owner@example.com'), true);
    assert.equal(isAdminEmail('OWNER@EXAMPLE.COM'), true);
    assert.equal(isAdminEmail('  owner@example.com  '), true);
    assert.equal(isAdminEmail('second@example.com'), true);
  });

  it('still limits a signed-in address that is not listed', () => {
    process.env.ADMIN_EMAILS = 'owner@example.com';
    assert.equal(isAdminEmail('someone-else@example.com'), false);
    // Not a prefix, suffix or substring match.
    assert.equal(isAdminEmail('owner@example.com.attacker.test'), false);
    assert.equal(isAdminEmail('xowner@example.com'), false);
    assert.equal(isAdminEmail('owner@example.co'), false);
  });

  it('never matches an anonymous viewer, even alongside a populated allowlist', () => {
    process.env.ADMIN_EMAILS = 'owner@example.com';
    // `viewerFor` sets email to undefined for anonymous accounts.
    assert.equal(isAdminEmail(undefined), false);
    assert.equal(isAdminEmail(null), false);
    assert.equal(isAdminEmail(''), false);
    assert.equal(isAdminEmail('   '), false);
  });

  it('ignores non-string values that could arrive from untyped callers', () => {
    process.env.ADMIN_EMAILS = 'owner@example.com';
    for (const value of [0, 1, true, {}, [], ['owner@example.com']]) {
      assert.equal(isAdminEmail(value as unknown as string), false);
    }
  });
});

describe('spend caps', () => {
  it('keeps the per-user daily cap above the maximum spend a full balance allows', () => {
    delete process.env.BETA_USER_DAILY_SPEND_CAP_USD;
    delete process.env.BETA_DAILY_SPEND_CAP_USD;
    const budgets = generationBudgets();
    // 100 welcome credits buy 12 music generations (8 credits each) at $0.226,
    // which is the most expensive way to spend a full balance: ~$2.71.
    const maxSpendWithFullBalance = Math.floor(100 / 8) * 0.226;
    assert.ok(
      budgets.userDailyUsd > maxSpendWithFullBalance,
      `per-user cap ${budgets.userDailyUsd} must exceed ${maxSpendWithFullBalance.toFixed(2)} or the credit balance is a lie`,
    );
    assert.ok(budgets.globalDailyUsd > budgets.userDailyUsd, 'global cap must leave room for more than one user');
  });

  it('still honours environment overrides', () => {
    process.env.BETA_USER_DAILY_SPEND_CAP_USD = '9';
    process.env.BETA_DAILY_SPEND_CAP_USD = '99';
    const budgets = generationBudgets();
    assert.equal(budgets.userDailyUsd, 9);
    assert.equal(budgets.globalDailyUsd, 99);
    delete process.env.BETA_USER_DAILY_SPEND_CAP_USD;
    delete process.env.BETA_DAILY_SPEND_CAP_USD;
  });
});

describe('refusal messages', () => {
  it('never tells a capped user they are out of credits', () => {
    const capped = reserveFailureMessage('user_daily_cap', 'music generation');
    assert.match(capped, /generation limit/i);
    assert.match(capped, /00:00 UTC/);
    assert.match(capped, /balance is unchanged/i);
    assert.doesNotMatch(capped, /enough Vibe Credits/i);
  });

  it('describes a global pause without exposing the provider ceiling', () => {
    const paused = reserveFailureMessage('global_daily_cap', 'music generation');
    assert.match(paused, /paused/i);
    assert.doesNotMatch(paused, /enough Vibe Credits/i);
    assert.doesNotMatch(paused, /\$/, 'the global figure is the owner’s provider account, not the user’s business');
  });

  it('keeps the credit message only for an actual credit shortfall', () => {
    assert.match(reserveFailureMessage('insufficient_credits', 'this image'), /enough Vibe Credits for this image/);
  });

  it('gives every reason a distinct message', () => {
    const reasons = ['insufficient_credits', 'user_daily_cap', 'global_daily_cap', 'duplicate_request'] as const;
    const messages = reasons.map((reason) => reserveFailureMessage(reason, 'music generation'));
    assert.equal(new Set(messages).size, reasons.length);
  });
});

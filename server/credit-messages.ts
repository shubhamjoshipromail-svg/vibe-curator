/**
 * Refusal reasons and their user-facing text.
 *
 * Deliberately a leaf module with no imports. `credits.ts` reaches the database
 * layer, so anything that wants only the vocabulary — tests, and any future
 * route that formats a refusal without reserving — can import this without
 * dragging a Postgres pool behind it.
 */

/**
 * Why a reservation was refused.
 *
 * Previously every one of these returned `undefined` and every caller reported
 * "not enough credits", so a user holding 100 credits was told they had none.
 * The reason has to survive the return trip for the message to be true.
 */
export type ReserveFailureReason =
  | 'insufficient_credits'
  | 'user_daily_cap'
  | 'global_daily_cap'
  | 'duplicate_request';

/**
 * The user-facing 402 text for a refusal. Shared by every generation route so
 * the six call sites cannot describe the same condition differently.
 *
 * `subject` names the thing that was refused, e.g. 'this image'.
 */
export function reserveFailureMessage(reason: ReserveFailureReason, subject: string): string {
  switch (reason) {
    case 'insufficient_credits':
      return `You do not have enough Vibe Credits for ${subject}.`;
    case 'user_daily_cap':
      return "You have reached today's generation limit. It resets at 00:00 UTC, and your Vibe Credits balance is unchanged.";
    case 'global_daily_cap':
      // Deliberately no figure: the global ceiling is the owner's provider
      // account, not the user's business.
      return 'AI generation is paused for the rest of today across the beta. Your Vibe Credits are unaffected.';
    case 'duplicate_request':
      return 'That generation is already running. Wait for it to finish before starting another.';
  }
}

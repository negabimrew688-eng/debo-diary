import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * Telebirr payment adapter.
 *
 * SANDBOX mode (default) simulates the hosted-checkout flow so the whole escrow lifecycle can be demonstrated
 * without credentials: initiate() returns a reference, and the buyer "approves" it through the sandbox
 * confirmation endpoint, standing in for Telebirr's server-to-server notification.
 *
 * LIVE mode needs Ethio telecom merchant credentials (app id/key, short code, signed requests and the
 * notification callback). That integration is intentionally NOT implemented here; live mode fails loudly
 * rather than pretending to take real money.
 */
export function initiatePayment({ orderId, amount }) {
  if (env.telebirrMode !== 'sandbox') {
    if (!env.telebirrAppId || !env.telebirrAppKey) {
      throw new AppError(501, 'Telebirr live mode requires merchant credentials (TELEBIRR_APP_ID, TELEBIRR_APP_KEY)');
    }
    throw new AppError(501, 'Telebirr live checkout is not implemented in this build; use TELEBIRR_MODE=sandbox');
  }
  return {
    provider: 'telebirr',
    mode: 'sandbox',
    reference: `TB-SBX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    amount,
    orderId,
  };
}

export const isSandbox = () => env.telebirrMode === 'sandbox';

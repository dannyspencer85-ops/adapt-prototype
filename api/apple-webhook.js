// api/apple-webhook.js
// Receives Apple App Store Server Notifications (V2) — one POST per
// subscription lifecycle event (subscribe, renew, cancel, refund, billing
// failure...). Keeps the `subscriptions` table in sync so the app's
// /api/subscription/status endpoint is the single source of truth.
//
// SIGNATURE VERIFICATION: every signedPayload (and the nested transaction /
// renewal JWSs) is verified with Apple's official
// @apple/app-store-server-library — x5c chain validation against the pinned
// Apple root CAs in _utils/appleRootCerts.js, plus bundle-id and
// environment checks. Forged or tampered payloads are rejected with 401.
// This requires the Node runtime (Node crypto/x509), not edge.
//
// The one unverified read is the environment field, used only to pick which
// verifier (Sandbox vs Production) to run — the accept/reject decision
// always comes from full verification.
//
// Linkage: when the native app initiates a purchase it passes our
// apple_account_token (a UUID minted per user in /api/subscription/status)
// as StoreKit's appAccountToken. Apple echoes it back in every
// notification, letting us map the transaction to a Supabase user.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPLE_BUNDLE_ID
// (defaults to com.adaptcoach.app), and — required before production
// launch — APPLE_APP_ID (the numeric Apple ID of the app record in App
// Store Connect; production notifications are rejected until it's set).

import { createClient } from '@supabase/supabase-js';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { getAppleRootCerts } from './_utils/appleRootCerts.js';

export const config = { maxDuration: 30 };

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.adaptcoach.app';

// Apple notificationType → our subscription status. null = informational,
// acknowledge and ignore.
const STATUS_MAP = {
  SUBSCRIBED: 'active',
  DID_RENEW: 'active',
  DID_RECOVER: 'active',
  OFFER_REDEEMED: 'active',
  DID_CHANGE_RENEWAL_STATUS: null,   // intent change — access unchanged until expiry
  DID_CHANGE_RENEWAL_PREF: null,
  GRACE_PERIOD_EXPIRED: 'expired',
  EXPIRED: 'expired',
  REVOKE: 'expired',
  REFUND: 'refunded',
  DID_FAIL_TO_RENEW: 'grace_period',
  CONSUMPTION_REQUEST: null,
  PRICE_INCREASE: null,
  RENEWAL_EXTENDED: null,
  RENEWAL_EXTENSION: null,
  TEST: null,                        // App Store Connect "Send Test Notification"
};

// Unverified peek at the JWS payload — ONLY to select the right verifier
// environment. Never used for the accept decision.
function peekJwsPayload(jws) {
  try {
    const part = String(jws).split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function buildVerifier(environment) {
  const roots = getAppleRootCerts();
  if (environment === 'Sandbox') {
    return new SignedDataVerifier(roots, true, Environment.SANDBOX, BUNDLE_ID);
  }
  const appAppleId = parseInt(process.env.APPLE_APP_ID || '', 10);
  if (!Number.isFinite(appAppleId)) {
    // Misconfiguration on our side — production notifications can't be
    // verified without the app's numeric Apple ID. Throwing surfaces a 500
    // so Apple retries once APPLE_APP_ID is set.
    throw new Error('APPLE_APP_ID env var missing — required to verify production notifications');
  }
  return new SignedDataVerifier(roots, true, Environment.PRODUCTION, BUNDLE_ID, appAppleId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[apple-webhook] missing env vars');
    return res.status(500).send('Server misconfigured');
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const signedPayload = req.body?.signedPayload;
  if (!signedPayload || typeof signedPayload !== 'string') {
    return res.status(400).send('Missing signedPayload');
  }

  // Peek (unverified) at the environment to pick the verifier, then verify.
  const peeked = peekJwsPayload(signedPayload);
  const environment = peeked?.data?.environment === 'Sandbox' ? 'Sandbox' : 'Production';

  let verifier;
  try {
    verifier = buildVerifier(environment);
  } catch (err) {
    console.error('[apple-webhook]', err.message);
    return res.status(500).send('Server misconfigured');
  }

  let notification;
  try {
    notification = await verifier.verifyAndDecodeNotification(signedPayload);
  } catch (err) {
    console.error('[apple-webhook] signature verification FAILED:', err?.message || err);
    return res.status(401).send('Invalid signature');
  }

  const notificationType = notification.notificationType;
  const subtype = notification.subtype || null;
  const data = notification.data || {};

  // Nested JWSs are verified too — a forged inner transaction inside a
  // validly-signed envelope isn't possible, but defense in depth is cheap.
  let transactionInfo = null;
  if (data.signedTransactionInfo) {
    try { transactionInfo = await verifier.verifyAndDecodeTransaction(data.signedTransactionInfo); }
    catch (err) { console.error('[apple-webhook] transaction info verification failed:', err?.message); }
  }
  let renewalInfo = null;
  if (data.signedRenewalInfo) {
    try { renewalInfo = await verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo); }
    catch (err) { console.error('[apple-webhook] renewal info verification failed:', err?.message); }
  }

  const appAccountToken = transactionInfo?.appAccountToken || null;
  const expiresDateMs = transactionInfo?.expiresDate;
  const productId = transactionInfo?.productId || renewalInfo?.productId || null;
  const originalTransactionId = transactionInfo?.originalTransactionId || null;

  // Log every event first — even ones we ignore — so sandbox testing and
  // production incidents are debuggable from the subscription_events table.
  const { error: logError } = await admin.from('subscription_events').insert({
    apple_account_token: appAccountToken,
    notification_type: notificationType,
    subtype,
    product_id: productId,
    transaction_id: originalTransactionId,
    expires_date: expiresDateMs ? new Date(expiresDateMs).toISOString() : null,
    environment,
    raw_payload: notification,
  });
  if (logError) console.error('[apple-webhook] event log error:', logError.message);

  const newStatus = STATUS_MAP[notificationType];
  if (newStatus == null) {
    // Informational or unrecognized — acknowledge so Apple doesn't retry.
    console.log('[apple-webhook] ignoring type:', notificationType, subtype || '');
    return res.status(200).send('OK');
  }

  if (!appAccountToken) {
    // Purchase made without our token (e.g. bought before account linkage
    // existed). Logged above; nothing to update. 200 so Apple stops retrying.
    console.error('[apple-webhook] no appAccountToken for', notificationType);
    return res.status(200).send('OK');
  }

  const { data: row, error: findError } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('apple_account_token', appAccountToken)
    .single();

  if (findError || !row) {
    console.error('[apple-webhook] no user for token:', appAccountToken);
    return res.status(200).send('OK');
  }

  const { error: updateError } = await admin
    .from('subscriptions')
    .update({
      status: newStatus,
      expires_at: expiresDateMs ? new Date(expiresDateMs).toISOString() : null,
      product_id: productId,
      original_transaction_id: originalTransactionId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', row.user_id);

  if (updateError) {
    console.error('[apple-webhook] update error:', updateError.message);
    // 500 → Apple retries. A failed write is a real problem we want retried.
    return res.status(500).send('Database error');
  }

  console.log(`[apple-webhook] ${row.user_id}: ${notificationType} → ${newStatus}`);
  return res.status(200).send('OK');
}

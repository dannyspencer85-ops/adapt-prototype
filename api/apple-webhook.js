// api/apple-webhook.js
// Receives Apple App Store Server Notifications (V2) — one POST per
// subscription lifecycle event (subscribe, renew, cancel, refund, billing
// failure...). Keeps the `subscriptions` table in sync so the app's
// /api/subscription/status endpoint is the single source of truth.
//
// Linkage: when the native app initiates a purchase it passes our
// apple_account_token (a UUID minted per user in /api/subscription/status)
// as StoreKit's appAccountToken. Apple echoes it back in every
// notification, letting us map the transaction to a Supabase user.
//
// TODO before App Store submission: verify the signedPayload JWT signature
// against Apple's public keys (x5c chain → Apple Root CA). Until then this
// endpoint decodes without verification, which is acceptable for sandbox
// testing only. The endpoint URL is unguessable-ish but NOT secret — do not
// rely on obscurity in production.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

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

// Edge runtime has no Buffer — decode base64url JWT sections with atob.
function decodeJwtPayload(jwt) {
  const part = (jwt || '').split('.')[1];
  if (!part) return null;
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[apple-webhook] missing env vars');
    return new Response('Server misconfigured', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  let notification;
  try {
    if (!body.signedPayload) return new Response('Missing signedPayload', { status: 400 });
    notification = decodeJwtPayload(body.signedPayload);
  } catch (err) {
    console.error('[apple-webhook] decode error:', err);
    return new Response('Decode error', { status: 400 });
  }
  if (!notification) return new Response('Decode error', { status: 400 });

  const notificationType = notification.notificationType;
  const subtype = notification.subtype || null;
  const data = notification.data || {};

  let transactionInfo = null;
  try { transactionInfo = data.signedTransactionInfo ? decodeJwtPayload(data.signedTransactionInfo) : null; }
  catch { transactionInfo = null; }
  let renewalInfo = null;
  try { renewalInfo = data.signedRenewalInfo ? decodeJwtPayload(data.signedRenewalInfo) : null; }
  catch { renewalInfo = null; }

  const appAccountToken = transactionInfo?.appAccountToken || data?.appAccountToken || null;
  const expiresDateMs = transactionInfo?.expiresDate;
  const productId = transactionInfo?.productId || renewalInfo?.productId || null;
  const originalTransactionId = transactionInfo?.originalTransactionId || null;
  const environment = data?.environment || notification?.data?.environment || null;

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
    return new Response('OK', { status: 200 });
  }

  if (!appAccountToken) {
    // Purchase made without our token (e.g. bought before account linkage
    // existed). Logged above; nothing to update. 200 so Apple stops retrying.
    console.error('[apple-webhook] no appAccountToken for', notificationType);
    return new Response('OK', { status: 200 });
  }

  const { data: row, error: findError } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('apple_account_token', appAccountToken)
    .single();

  if (findError || !row) {
    console.error('[apple-webhook] no user for token:', appAccountToken);
    return new Response('OK', { status: 200 });
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
    return new Response('Database error', { status: 500 });
  }

  console.log(`[apple-webhook] ${row.user_id}: ${notificationType} → ${newStatus}`);
  return new Response('OK', { status: 200 });
}

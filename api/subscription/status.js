// api/subscription/status.js
// Returns the calling user's subscription status — the app's single source
// of truth for premium access. Called on app load (after auth) and after a
// purchase completes.
//
// Also LAZILY PROVISIONS the user's subscriptions row: the first call mints
// their apple_account_token (a UUID). The native app passes that token as
// StoreKit's appAccountToken when purchasing, which is how Apple's webhook
// notifications get linked back to this user. Writes use the service role —
// the table has no client write policies.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') return jsonResp(405, { error: 'Method not allowed' });

  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResp(401, { error: 'Missing Authorization header' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[subscription/status] missing env vars');
    return jsonResp(500, { error: 'Server misconfigured' });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return jsonResp(401, { error: 'Invalid or expired session' });

  let { data: sub, error } = await admin
    .from('subscriptions')
    .select('status, expires_at, apple_account_token')
    .eq('user_id', user.id)
    .single();

  // First call for this user — provision the row (mints apple_account_token).
  if (error && error.code === 'PGRST116') {
    const ins = await admin
      .from('subscriptions')
      .insert({ user_id: user.id })
      .select('status, expires_at, apple_account_token')
      .single();
    sub = ins.data;
    error = ins.error;
  }
  if (error || !sub) {
    console.error('[subscription/status] lookup error:', error?.message);
    return jsonResp(500, { error: 'Subscription lookup failed' });
  }

  // Expiry beats stored status: an 'active' row past its expiry is expired
  // even if the webhook that would have said so never arrived.
  const isExpired = sub.expires_at ? new Date(sub.expires_at) < new Date() : false;
  const effectiveStatus = isExpired && sub.status === 'active' ? 'expired' : sub.status;

  return jsonResp(200, {
    status: effectiveStatus,
    expiresAt: sub.expires_at,
    appleAccountToken: sub.apple_account_token,
    hasAccess: effectiveStatus === 'active' || effectiveStatus === 'grace_period',
  });
}

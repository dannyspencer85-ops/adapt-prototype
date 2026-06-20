// api/delete-account.js
// Permanently deletes a user's account and ALL their data from Supabase.
// Must be called with a valid session JWT in the Authorization header.
// Uses the SUPABASE_SERVICE_ROLE_KEY server-side — never expose that key to the client.
//
// Tables wiped (all rows matching user_id):
//   user_data, push_subscriptions, notification_preferences
// Then: deletes the Supabase auth user itself (irreversible).

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return jsonResp(405, { error: 'Method not allowed' });

  // Extract bearer token from the Authorization header.
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResp(401, { error: 'Missing Authorization header' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[delete-account] missing env vars');
    return jsonResp(500, { error: 'Server misconfigured — missing env vars' });
  }

  // Admin client — bypasses RLS and can call auth.admin.deleteUser().
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Validate the caller's JWT and retrieve their user_id.
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) {
    return jsonResp(401, { error: 'Invalid or expired session. Please log in again.' });
  }
  const userId = user.id;

  // Delete all per-user data rows. Run in parallel for speed.
  const [r1, r2, r3] = await Promise.all([
    admin.from('user_data').delete().eq('user_id', userId),
    admin.from('push_subscriptions').delete().eq('user_id', userId),
    admin.from('notification_preferences').delete().eq('user_id', userId),
  ]);

  for (const { error } of [r1, r2, r3]) {
    if (error) {
      console.error('[delete-account] row delete error:', error.message);
      return jsonResp(500, { error: 'Failed to delete user data: ' + error.message });
    }
  }

  // Finally, delete the auth user — this is the point of no return.
  const { error: deleteAuthErr } = await admin.auth.admin.deleteUser(userId);
  if (deleteAuthErr) {
    console.error('[delete-account] auth deleteUser error:', deleteAuthErr.message);
    return jsonResp(500, { error: 'Failed to delete auth user: ' + deleteAuthErr.message });
  }

  return jsonResp(200, { ok: true });
}

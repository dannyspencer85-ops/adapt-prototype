// api/_utils/sendPush.js
// Shared helper: send Web Push notifications.
// Uses web-push (Node.js runtime only — not edge).
//
// Server-only env vars (never expose to client):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/** Service-role Supabase client — bypasses RLS for server-side reads */
export function makeServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

/**
 * Send a push notification to one subscription.
 * Returns { success, expired?, endpoint? }
 */
export async function sendPushToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { success: true };
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expired — caller should delete it
      return { success: false, expired: true, endpoint: sub.endpoint };
    }
    console.error('[sendPush] error:', err.statusCode, err.body?.slice?.(0, 200));
    return { success: false, error: err.message };
  }
}

/**
 * Send a push notification to ALL devices registered for userId.
 * Auto-deletes expired subscriptions.
 * @param {string} userId
 * @param {object} payload   — { title, body, tag, url, notificationType, ... }
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function sendPushToUser(userId, payload, supabase) {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error || !subs?.length) return;

  const expired = [];
  await Promise.all(subs.map(async (sub) => {
    const res = await sendPushToSubscription(sub, payload);
    if (res.expired) expired.push(res.endpoint);
  }));

  if (expired.length) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expired);
  }
}

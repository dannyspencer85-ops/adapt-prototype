// api/notifications/plan-adjustment.js
// NOT a cron — called via POST from the client after a confirmed plan adaptation.
//
// POST body: { userId, sessionName, dayName, reason }
// reason values: 'high_fatigue' | 'low_hrv' | 'missed_session' |
//                'user_request' | 'illness_signal' | any free string
//
// Category: "adaptations" → plan_adjustment_enabled column in notification_preferences.
//
// Guardrails:
//   - Skips users with plan_adjustment_enabled = false.
//   - Caps at MAX_PER_DAY (2) adaptation notifications per user per UTC day.
//     Counter stored in plan_adj_sends_today / plan_adj_sends_date columns.
//   - Tag dedup on device: 'adaptation' (one notification slot; new ones replace old).
//
// TODO: authenticate the caller — currently any client can POST any userId.
// Impact is limited to sending a push notification (no data mutation).
// Future fix: require the user's own JWT in Authorization header, validate via
// supabase.auth.getUser(token), and assert userId === authenticated user.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

const MAX_PER_DAY = 2; // max plan-adaptation pushes per user per UTC day

const REASON_TEXT = {
  high_fatigue:    'eased back based on fatigue',
  low_hrv:         'adjusted for low HRV',
  missed_session:  'reshuffled after a missed session',
  user_request:    'updated as requested',
  illness_signal:  'reduced — body signals suggest recovery needed',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const { userId, sessionName = 'your session', dayName = 'Tomorrow', reason } = body;
  if (!userId) return new Response('Missing userId', { status: 400 });

  const supabase = makeServiceClient();
  const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  // Fetch prefs + per-day counter
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('plan_adjustment_enabled, plan_adj_sends_today, plan_adj_sends_date')
    .eq('user_id', userId)
    .maybeSingle();

  if (!prefs?.plan_adjustment_enabled) {
    return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200 });
  }

  // Per-day cap: reset counter when date changes
  const sendsToday = prefs.plan_adj_sends_date === todayStr ? (prefs.plan_adj_sends_today ?? 0) : 0;
  if (sendsToday >= MAX_PER_DAY) {
    return new Response(JSON.stringify({ skipped: 'daily_cap', cap: MAX_PER_DAY }), { status: 200 });
  }

  const reasonText = REASON_TEXT[reason] || (typeof reason === 'string' && reason) || 'updated by your coach';

  await sendPushToUser(userId, {
    title: 'Plan updated',
    body: `${dayName}'s ${sessionName} ${reasonText}.`,
    tag: 'adaptation', // dedup: one slot — newer adaptations replace older ones
    url: '/#home',
    notificationType: 'plan_adjustment',
  }, supabase);

  // Increment and persist the daily counter
  await supabase.from('notification_preferences').upsert({
    user_id: userId,
    plan_adj_sends_today: sendsToday + 1,
    plan_adj_sends_date: todayStr,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

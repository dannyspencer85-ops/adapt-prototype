// api/notifications/morning-checkin.js
// Cron: 0 12 * * *
// = 7 am CDT (UTC-5, daylight saving time).
// DRIFTS: when clocks fall back to CST (UTC-6) this fires at 6 am Central.
// [CHANGE ME if you want a different time — update vercel.json schedule to match.]
//
// Category: "check_in" → morning_checkin_enabled column in notification_preferences.
// Audience: users with morning_checkin_enabled = true who have NOT already
//   completed today's check-in.
// Payload: fixed coaching-voice copy.
// Guardrails:
//   - Skips users who already checked in today (reads plan_state.lastCheckin.when).
//   - Max once/day enforced by cron schedule (single daily run) + tag dedup on device.
//   - "Opened app in last hour" suppression: OUT OF SCOPE (app-open events not stored
//     server-side). Future work: write a last_active_at timestamp to user_data on login.
//
// TODO: per-user timezone scheduling is OUT OF SCOPE for this pass.
// All users receive this at the same UTC time (7 am CDT).

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

export default async function handler(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] ?? req.headers.get?.('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = makeServiceClient();
  // "today" in UTC — at 12:00 UTC (7am CDT) this matches the user's calendar day.
  const todayStr = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

  const { data: prefs, error: prefsErr } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('morning_checkin_enabled', true);

  if (prefsErr) {
    console.error('[morning-checkin] prefs error:', prefsErr.message);
    return new Response(JSON.stringify({ error: prefsErr.message }), { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const pref of (prefs ?? [])) {
    // Check if user already completed today's check-in.
    // planState.lastCheckin.when is stored as a Unix ms timestamp.
    const { data: row } = await supabase
      .from('user_data')
      .select('plan_state')
      .eq('user_id', pref.user_id)
      .maybeSingle();

    const lastCheckin = row?.plan_state?.lastCheckin;
    if (lastCheckin?.when) {
      const checkinDate = new Date(lastCheckin.when).toISOString().split('T')[0];
      if (checkinDate === todayStr) {
        skipped++; // already checked in — don't nudge
        continue;
      }
    }

    await sendPushToUser(pref.user_id, {
      title: 'Daily check-in',
      body: "How's your body today? 30 seconds — shapes today's session.",
      tag: 'check-in', // dedup: only one per device per day
      url: '/#home',
      notificationType: 'morning_checkin',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

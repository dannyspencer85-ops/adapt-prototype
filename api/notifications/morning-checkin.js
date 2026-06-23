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
// Per-user timezone scheduling: if the user's device timezone is stored in
// plan_state.timezone, only send when it is currently 7 am ± 30 min in their
// local time. Users without a stored timezone always receive the notification
// (preserves previous behaviour for existing accounts).

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

// Returns true if it is currently targetHour ± windowMins in the given IANA timezone.
// Falls back to true (always send) for unknown/missing timezones.
function isLocalHour(timezone, targetHour, windowMins = 30) {
  if (!timezone) return true;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const diff = Math.abs(h * 60 + m - targetHour * 60);
    return diff <= windowMins || diff >= (24 * 60 - windowMins);
  } catch { return true; }
}

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

    // Timezone gate: only send if it's currently 7 am ± 30 min for this user.
    if (!isLocalHour(row?.plan_state?.timezone, 7)) { skipped++; continue; }

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

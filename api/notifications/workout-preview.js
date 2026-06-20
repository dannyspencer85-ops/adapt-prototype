// api/notifications/workout-preview.js
// Cron: 0 23 * * *
// = 6 pm CDT (UTC-5, daylight saving time).
// DRIFTS: when clocks fall back to CST (UTC-6) this fires at 5 pm Central.
// [CHANGE ME if you want a different time — update vercel.json schedule to match.]
//
// Category: "workout_reminders" → workout_reminders_enabled column.
// Audience: users with workout_reminders_enabled = true who have a non-rest
//   session scheduled for tomorrow.
// Payload: "Tomorrow: {session name} · {N} min"
// Guardrails:
//   - Skips rest days and sessions with no duration.
//   - Max once/day enforced by cron schedule (single daily run) + tag dedup on device.
//   - Monday boundary: if plan hasn't rotated yet, checks fullPlan next week as fallback.
//
// TODO: per-user timezone scheduling is OUT OF SCOPE for this pass.
// All users receive this at the same UTC time (6 pm CDT).
// Future work: store user timezone in notification_preferences and schedule per-user.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

// Day abbreviations matching planState.sessions keys
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function handler(req) {
  // Mandatory CRON_SECRET check (must be set in Vercel env vars).
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] ?? req.headers.get?.('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = makeServiceClient();

  // Determine tomorrow's day key in Central time.
  // At 23:00 UTC (= 6 pm CDT), "tomorrow" in Central = tomorrow in UTC.
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  const tomorrowDay = DAYS[tomorrow.getUTCDay()]; // e.g. "Tue"

  // Fetch all opted-in users
  const { data: prefs, error: prefsErr } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('workout_reminders_enabled', true);

  if (prefsErr) {
    console.error('[workout-preview] prefs error:', prefsErr.message);
    return new Response(JSON.stringify({ error: prefsErr.message }), { status: 500 });
  }

  let sent = 0;
  let skipped = 0;

  for (const pref of (prefs ?? [])) {
    // Read user's plan_state (stored as JSONB in user_data.plan_state)
    const { data: row } = await supabase
      .from('user_data')
      .select('plan_state')
      .eq('user_id', pref.user_id)
      .maybeSingle();

    if (!row?.plan_state) { skipped++; continue; }

    const ps = row.plan_state;

    // Primary: current week sessions
    let session = ps.sessions?.[tomorrowDay];

    // Monday boundary fallback: if current sessions show rest for Monday,
    // check next week in fullPlan (app may not have rotated the week yet).
    if (tomorrowDay === 'Mon' && (!session || session.type === 'rest' || !session.duration)) {
      const nextIdx = (ps.activeWeekIdx ?? 0) + 1;
      const nextWeekSession = ps.fullPlan?.weeks?.[nextIdx]?.sessions?.[tomorrowDay];
      if (nextWeekSession) session = nextWeekSession;
    }

    // Skip rest days and zero-duration sessions
    if (!session || session.type === 'rest' || !session.duration || session.duration === 0) {
      skipped++;
      continue;
    }

    // TODO: pull richer session details (e.g. session.meta) once that field
    // is confirmed consistently populated in plan_state for all plan sources.
    const sessionName = session.name || 'Training session';
    const minutes = session.duration;

    await sendPushToUser(pref.user_id, {
      title: "Tomorrow's session",
      body: `${sessionName} · ${minutes} min`,
      tag: 'workout-preview', // dedup: replaces any earlier preview on device
      url: '/#home',
      notificationType: 'workout_preview',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

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
// Per-user timezone scheduling: if the user's device timezone is stored in
// plan_state.timezone, only send when it is currently 6 pm ± 30 min in their
// local time, and compute "tomorrow" in their local timezone. Users without a
// stored timezone always receive the notification at the fixed UTC cron time.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

// Day abbreviations matching planState.sessions keys
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Returns true if it is currently targetHour ± windowMins in the given IANA timezone.
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

// Returns the 3-letter weekday key for "tomorrow" in the given IANA timezone,
// e.g. "Tue". Falls back to UTC-based calculation if timezone is missing/invalid.
function getTomorrowDayKey(timezone) {
  try {
    const tz = timezone || 'UTC';
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(tomorrow);
    return weekday.slice(0, 3); // 'Mon', 'Tue', …
  } catch {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    return DAYS[tomorrow.getUTCDay()];
  }
}

export default async function handler(req) {
  // Mandatory CRON_SECRET check (must be set in Vercel env vars).
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] ?? req.headers.get?.('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = makeServiceClient();

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
    const userTz = ps.timezone || null;

    // Timezone gate: only send if it's currently 6 pm ± 30 min for this user.
    if (!isLocalHour(userTz, 18)) { skipped++; continue; }

    // Compute tomorrow's day key in the user's local timezone.
    const tomorrowDay = getTomorrowDayKey(userTz);

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

    const sessionName = session.name || 'Training session';
    // Prefer session.meta ("45 min · Z2") for richer context; fall back to raw minutes.
    const detail = session.meta || (session.duration ? `${session.duration} min` : null);
    const body = detail ? `${sessionName} · ${detail}` : sessionName;

    await sendPushToUser(pref.user_id, {
      title: "Tomorrow's session",
      body: body.slice(0, 100), // push body hard cap
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

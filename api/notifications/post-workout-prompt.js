// api/notifications/post-workout-prompt.js
// Cron: every 15 min  (*/15 * * * *)
//
// Fires ~90 min after a workout ends (approximated by scheduled end time).
// In Adapt's data model the plan lives in localStorage/Supabase planState —
// we don't have per-user session rows with exact end times.
// Strategy: if the user has a push subscription and hasn't logged RPE for
// today's session by 90 min past the typical workout end window, send once.
//
// Practical implementation: fire for users whose notification window aligns
// with "90 min after typical morning workout" (08:00–11:00 UTC default).
// A more precise trigger can be added once session times are tracked server-side.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

export default async function handler(req) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get?.('authorization') ?? req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = makeServiceClient();
  const now = new Date();
  const utcH = now.getUTCHours();
  const todayStr = now.toISOString().split('T')[0];

  // Only run between 09:00–12:00 UTC (approx 90 min after 07:30–10:30 workouts)
  if (utcH < 9 || utcH > 12) {
    return new Response('Outside window', { status: 200 });
  }

  // Find users with post-workout notifications enabled who have subscriptions
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('post_workout_enabled', true);

  let sent = 0;
  for (const pref of (prefs ?? [])) {
    // Skip if user already logged today (last_log_date column)
    const { data: state } = await supabase
      .from('user_plan_state')
      .select('last_log_date, today_session_type')
      .eq('user_id', pref.user_id)
      .maybeSingle();

    // Don't prompt on rest days or if already logged
    if (!state || state.today_session_type === 'rest') continue;
    if (state.last_log_date === todayStr) continue;

    await sendPushToUser(pref.user_id, {
      title: 'How did it go?',
      body: "Log your effort — it sharpens tomorrow's plan.",
      tag: 'post-workout-prompt',
      url: '/?action=log-session',
      notificationType: 'post_workout',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

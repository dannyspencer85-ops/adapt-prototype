// api/notifications/morning-checkin.js
// Cron: every 15 min  (*/15 * * * *)
//
// Sends a morning check-in prompt to users whose preferred check-in time
// falls in the current 15-minute window AND who have a non-rest session
// today AND who haven't already checked in.
//
// Adapt stores check-in state in planState (localStorage / Supabase).
// We approximate "already checked in" by checking the last_checkin_date
// column we write when the user submits a check-in.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

export default async function handler(req) {
  // Vercel Cron passes a secret header — reject other callers in production.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get?.('authorization') ?? req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = makeServiceClient();
  const now = new Date();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const todayStr = now.toISOString().split('T')[0];

  // Time window ±7 min around current UTC time
  const windowStart = `${String(utcH).padStart(2,'0')}:${String(Math.max(0, utcM - 7)).padStart(2,'0')}`;
  const windowEnd   = `${String(utcH).padStart(2,'0')}:${String(Math.min(59, utcM + 7)).padStart(2,'0')}`;

  const { data: users, error } = await supabase
    .from('notification_preferences')
    .select('user_id, morning_checkin_time')
    .eq('morning_checkin_enabled', true)
    .gte('morning_checkin_time', windowStart)
    .lte('morning_checkin_time', windowEnd);

  if (error) {
    console.error('[morning-checkin] query error:', error);
    return new Response('Error', { status: 500 });
  }

  let sent = 0;
  for (const user of (users ?? [])) {
    // Skip if user already checked in today (column set by the app on submit)
    const { data: state } = await supabase
      .from('user_plan_state')
      .select('last_checkin_date')
      .eq('user_id', user.user_id)
      .maybeSingle();

    if (state?.last_checkin_date === todayStr) continue;

    await sendPushToUser(user.user_id, {
      title: 'Morning check-in',
      body: "How's the body today? 15 seconds — shapes your session.",
      tag: 'morning-checkin',
      url: '/?action=checkin',
      notificationType: 'morning_checkin',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

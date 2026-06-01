// api/notifications/weekly-review.js
// Cron: Sundays at 19:00 UTC  (0 19 * * 0)
//
// Notifies users with weekly_review_enabled that their next week is ready.
// We don't count completed sessions server-side yet — send to all opted-in
// users who have at least one active push subscription.

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

export default async function handler(req) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get?.('authorization') ?? req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = makeServiceClient();

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('weekly_review_enabled', true);

  let sent = 0;
  for (const pref of (prefs ?? [])) {
    // Confirm user has at least one live subscription before querying
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .eq('user_id', pref.user_id)
      .limit(1);

    if (!subs?.length) continue;

    await sendPushToUser(pref.user_id, {
      title: 'Week in review',
      body: "Next week is shaped and ready. Check what's coming.",
      tag: 'weekly-review',
      url: '/?action=weekly-review',
      notificationType: 'weekly_review',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

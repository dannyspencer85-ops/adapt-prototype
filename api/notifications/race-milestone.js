// api/notifications/race-milestone.js
// Cron: daily at 08:00 UTC  (0 8 * * *)
//
// Reads each user's race date from their planState snapshot and fires a
// notification on milestone days (84, 56, 28, 14, 7, 3, 1 days out).

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

const MILESTONES = {
  84: { title: '12 weeks to race',  body: 'The training block begins. Consistency beats intensity right now.' },
  56: { title: '8 weeks out',       body: 'Base is built. Quality sessions start to matter more now.' },
  28: { title: '4 weeks to go',     body: 'Final build phase. Make the hard sessions count.' },
  14: { title: '2 weeks out',       body: 'Taper begins. Less volume, same sharpness. Trust the work.' },
   7: { title: 'Race week',         body: 'Seven days. Stay fresh, stay sharp. Everything is ready.' },
   3: { title: '3 days out',        body: "Final sharpener tomorrow, then rest. You're ready." },
   1: { title: 'Race tomorrow',     body: 'Everything you need is already in you. Sleep well tonight.' },
};

export default async function handler(req) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.get?.('authorization') ?? req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const supabase = makeServiceClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('race_milestone_enabled', true);

  let sent = 0;
  for (const pref of (prefs ?? [])) {
    // Read race_date from the user's plan state snapshot
    const { data: state } = await supabase
      .from('user_plan_state')
      .select('race_date')
      .eq('user_id', pref.user_id)
      .maybeSingle();

    if (!state?.race_date) continue;

    const raceDate = new Date(state.race_date);
    raceDate.setUTCHours(0, 0, 0, 0);
    const daysOut = Math.round((raceDate - today) / 86400000);

    const milestone = MILESTONES[daysOut];
    if (!milestone) continue;

    await sendPushToUser(pref.user_id, {
      title: milestone.title,
      body: milestone.body,
      tag: `race-milestone-${daysOut}`,
      url: '/',
      notificationType: 'race_milestone',
    }, supabase);
    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

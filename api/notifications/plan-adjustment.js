// api/notifications/plan-adjustment.js
// NOT a cron — called directly from the coach/plan endpoint after a plan
// change is saved, or from client-side JS after an AI plan adjustment.
//
// POST body: { userId, sessionName, dayName, reason }
// reason values: 'high_fatigue' | 'low_hrv' | 'missed_session' |
//                'user_request' | 'illness_signal'

import { makeServiceClient, sendPushToUser } from '../_utils/sendPush.js';

const REASON_TEXT = {
  high_fatigue:    'eased back based on fatigue',
  low_hrv:         'adjusted for low HRV',
  missed_session:  'reshuffled after a missed session',
  user_request:    'updated as requested',
  illness_signal:  'reduced. body signals suggest recovery needed',
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

  // Check user preference
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('plan_adjustment_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (!prefs?.plan_adjustment_enabled) {
    return new Response('Notifications disabled', { status: 200 });
  }

  const reasonText = REASON_TEXT[reason] || 'updated by your coach';

  await sendPushToUser(userId, {
    title: 'Plan updated',
    body: `${dayName}'s ${sessionName} ${reasonText}.`,
    tag: 'plan-adjustment',
    url: '/',
    notificationType: 'plan_adjustment',
  }, supabase);

  return new Response('OK', { status: 200 });
}

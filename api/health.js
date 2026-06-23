// /api/health — quick env-var presence check.
//
// Hit this from a browser to verify ALL required env vars are set in the
// deployed environment WITHOUT triggering any upstream API call. Returns
// only booleans — the key values are never exposed.
//
//   GET https://your-app.vercel.app/api/health
//
// Response shape:
// {
//   ok: true,
//   ready: true,          // false if any REQUIRED env var is missing
//   timestamp: "...",
//   env: "production" | "preview" | "development",
//   region: "iad1",
//   vars: {
//     mistral: true,      // MISTRAL_API_KEY — required for AI coaching
//     supabaseUrl: true,  // SUPABASE_URL    — required for account deletion
//     supabaseServiceRole: true, // SUPABASE_SERVICE_ROLE_KEY — required for account deletion
//     vapid: true,        // VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY — required for push notifications
//     googleCse: false    // optional — race search feature only
//   },
//   issues: []            // human-readable list of missing required vars
// }

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const hasMistral           = !!process.env.MISTRAL_API_KEY;
  const hasSupabaseUrl       = !!process.env.SUPABASE_URL;
  const hasSupabaseServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasVapid             = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  const hasCronSecret        = !!process.env.CRON_SECRET;
  const hasGoogleCse         = !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID);

  const issues = [];
  if (!hasMistral)            issues.push('MISTRAL_API_KEY missing — AI coaching will not work');
  if (!hasSupabaseUrl)        issues.push('SUPABASE_URL missing — account deletion will fail');
  if (!hasSupabaseServiceRole) issues.push('SUPABASE_SERVICE_ROLE_KEY missing — account deletion will fail (App Store blocker)');
  if (!hasVapid)              issues.push('VAPID keys missing — push notifications will not work');
  if (!hasCronSecret)         issues.push('CRON_SECRET missing — notification crons will return 401 and never fire');

  const body = {
    ok: true,
    ready: issues.length === 0,
    timestamp: new Date().toISOString(),
    env: process.env.VERCEL_ENV || 'unknown',
    region: process.env.VERCEL_REGION || 'unknown',
    vars: {
      mistral: hasMistral,
      supabaseUrl: hasSupabaseUrl,
      supabaseServiceRole: hasSupabaseServiceRole,
      vapid: hasVapid,
      cronSecret: hasCronSecret,
      googleCse: hasGoogleCse,
    },
    issues,
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

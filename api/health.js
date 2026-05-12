// /api/health — quick env-var presence check.
//
// Hit this from a browser to verify env vars are set in the deployed
// environment WITHOUT triggering an actual Mistral/Google call. Returns
// only booleans, never the keys themselves.
//
//   GET https://your-app.vercel.app/api/health
//
// Response shape:
// {
//   ok: true,
//   timestamp: "2026-05-11T...",
//   env: "production" | "preview" | "development",
//   mistral: true|false,
//   googleCse: true|false,
//   region: "iad1"  // Vercel region serving this request
// }
//
// If `mistral: false`, every Coach Chat + AI plan call falls back to the
// rule engine for this environment. That's the most common reason testers
// see degraded behavior on a preview URL.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const hasMistral = !!process.env.MISTRAL_API_KEY;
  const hasGoogleCse = !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_ID);
  const body = {
    ok: true,
    timestamp: new Date().toISOString(),
    env: process.env.VERCEL_ENV || 'unknown',
    mistral: hasMistral,
    googleCse: hasGoogleCse,
    region: process.env.VERCEL_REGION || 'unknown',
    note: hasMistral
      ? 'Coach Chat + AI plan generation will use Mistral.'
      : 'MISTRAL_API_KEY is NOT set in this environment — every chat/plan call falls back to the rule engine. Set it in Vercel → Settings → Environment Variables for all environments and redeploy.',
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

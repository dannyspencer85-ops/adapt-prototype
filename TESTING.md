# Testing Adapt — for testers

Thanks for taking this for a spin. This is a **prototype**, not a polished product — your job is to find what breaks, confuses, or feels wrong.

## What is Adapt?

An adaptive endurance training coach. You tell it your race + schedule + ability, it builds a periodized plan, and a Coach Chat helps you modify the plan when life happens.

Supports: 5K · 10K · Half Marathon · Marathon · Sprint Tri · Olympic Tri · Half Ironman · Full Ironman.

## How to install

**iOS (Safari):**
1. Open the URL the team shared with you.
2. Tap the **share** icon at the bottom of Safari.
3. Tap **Add to Home Screen**.
4. Open Adapt from your home screen — it runs full-screen, like a native app.

**Android (Chrome):** open the URL, tap the install prompt that appears, or use the menu → "Install app."

Installing matters: notifications + offline only work after install.

## What to try (in order)

1. **Onboarding** — go through all 5 steps. Pick the event closest to a real goal you'd train for. Pick a race date 8–16 weeks out for the cleanest test.
2. **The first-session moment** — modal appears after onboarding completes. Read it.
3. **Today screen** — readiness card, today's workout, race-week card if you're inside 7 days.
4. **Plan tab** — month-grid calendar. Tap a training day → session detail with prescription. Tap a rest day → "why am I resting" popover. Tap race day → pep-talk modal.
5. **Coach Chat** — try these:
   - "what race am I training for?"
   - "move Saturday to Sunday"
   - "I only have 30 minutes on Wednesday"
   - "I'm bad at running, focus on that"
   - "this plan is too hard / too easy"
   - "my knee hurts" (try moderate severity)
   The chat shows an **Apply / Cancel** card for plan changes. Tap Apply to commit.
6. **Strava** — Profile → Connect Strava. Go through OAuth. Activities should sync; Pulse tab populates with your training history.
7. **Edit goals / start over** — Profile → "Start over with a new plan." Re-onboard with a different event to see how the engine handles a different sport.

## What we want feedback on most

- **Did the plan feel right?** Was your first week's volume appropriate? Was the long session at the right distance? Was strength included if you have gym access?
- **Did Coach Chat understand what you meant?** Especially modify-plan asks ("move X to Y", "I'm tired today").
- **Were any sessions WRONG?** A 45-min Easy swim when you expected 20-min activation, a long run before race day, training programmed after race day, etc. Screenshot these.
- **What did the app FAIL to do** that you expected it to?
- **First impression in the first 5 minutes** — did onboarding feel clear? Did you know what the app does?

## Known limits (don't waste your time reporting these)

- **No cloud sync.** Your plan lives in your browser's storage. If you clear your browser data or switch devices, your plan is gone. Don't expect cross-device sync yet.
- **Mistral rate limit.** Coach Chat is capped at 50 messages/day per device while we're in prototype.
- **Notifications only fire when the app is open or recently focused.** Push notifications when the app is closed need a backend we haven't built yet.
- **Strava tokens expire every ~6 hours.** Refresh is automatic; if it ever shows "Strava connection lost," tap Profile → reconnect.
- **Apple HealthKit + Garmin Connect direct integration are not yet wired** (use Strava for now).
- **iOS Safari notification permission requires installing to Home Screen first.** Inside the regular Safari browser, the notification prompt won't appear.
- **General fitness (no event) is intentionally not supported yet** — pick a specific race.

## How to log in

You have a pre-provisioned account waiting for you. On the login screen:

- **Username**: your first name, lowercase (e.g. `bridget`)
- **Password**: same as your username (e.g. `bridget`)

| Tester | Username | Password |
|---|---|---|
| Bridget | `bridget` | `bridget` |
| Jane | `jane` | `jane` |
| Connor | `connor` | `connor` |
| Luke | `luke` | `luke` |
| Gabe | `gabe` | `gabe` |

After logging in, you'll go through **onboarding** — pick a real race you'd actually train for (5K through Full Ironman), enter a race date 8–16 weeks out, and configure your training days + weekly hours.

> Note: accounts live in your browser only — they don't sync across devices. If you want to test on phone + laptop, log in on each separately and you'll need to go through onboarding twice.

## How to send feedback

[INSERT FEEDBACK CHANNEL HERE — Google Form, Slack, email, Notion page, etc.]

For each issue, please include:
1. What you were doing (screen + action)
2. What you expected
3. What actually happened
4. Screenshot if possible

## Dev-console sanity check (optional, for technical testers)

If you want to run the plan sanity harness, open browser dev tools (Cmd+Opt+I) → Console → run:

```js
runAllSanityScenarios()
```

This generates plans across every event × hours × ability × weeks-out combination and reports any violations to the console. Useful for finding edge cases.

Thanks. Honest feedback > polite feedback.

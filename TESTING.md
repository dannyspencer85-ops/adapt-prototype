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

## How to log in

You have a pre-provisioned account waiting for you. On the login screen enter your **email** and **password** from the table below — then tap **Log in**.

| Tester | Email | Password |
|--------|-------|----------|
| Bridget | `bridget@adapt-test.app` | `AdaptBeta2026!` |
| Jane | `jane@adapt-test.app` | `AdaptBeta2026!` |
| Connor | `connor@adapt-test.app` | `AdaptBeta2026!` |
| Luke | `luke@adapt-test.app` | `AdaptBeta2026!` |
| Gabe | `gabe@adapt-test.app` | `AdaptBeta2026!` |

After logging in you'll go through **onboarding** — pick a real race you'd actually train for (5K through Full Ironman), enter a race date 8–16 weeks out, and configure your training days + weekly hours.

> Your plan syncs to the cloud via your account. Logging into the same account on a second device will restore your plan there too.

## What to try (in order)

1. **Onboarding** — go through all 5 steps. Pick the event closest to a real goal you'd train for. Pick a race date 8–16 weeks out for the cleanest test.
2. **The first-session moment** — modal appears after onboarding completes. Read it.
3. **Today screen** — readiness card, today's workout, race-week card if you're inside 7 days.
4. **Morning check-in** — tap the check-in card on the Today screen. Select how your body feels, sleep quality, stress level. Save it. Check that it sticks.
5. **Plan tab** — month-grid calendar. Tap a training day → session detail with prescription. Tap a rest day → "why am I resting" popover. Tap race day → pep-talk modal.
6. **Coach Chat** — try these:
   - "what race am I training for?"
   - "move Saturday to Sunday"
   - "I only have 30 minutes on Wednesday"
   - "I'm bad at running, focus on that"
   - "this plan is too hard / too easy"
   - "my knee hurts" (try moderate severity)

   The chat shows an **Apply / Cancel** card for plan changes. Tap Apply to commit.
7. **Edit goals / start over** — Profile → "Start over with a new plan." Re-onboard with a different event to see how the engine handles a different sport.

## What we want feedback on most

- **Did the plan feel right?** Was your first week's volume appropriate? Was the long session at the right distance? Was strength included if you have gym access?
- **Did Coach Chat understand what you meant?** Especially modify-plan asks ("move X to Y", "I'm tired today").
- **Were any sessions WRONG?** A swim session in a 5K plan, a long run the day before race day, training scheduled after race day, etc. Screenshot these.
- **What did the app FAIL to do** that you expected it to?
- **First impression in the first 5 minutes** — did onboarding feel clear? Did you know what the app does?
- **Color / theme** — did changing the theme in onboarding (step 4) actually change the color? Tap a color and let us know if it updates immediately or not at all.

## Known limits (don't waste your time reporting these)

- **AI chat rate limit.** Coach Chat is capped at 50 messages/day per device and plan generation at 5 rebuilds/day per IP while we're in prototype. The app shows a warning when you're close to the daily limit.
- **Notifications only fire when the app is open or recently focused.** Push notifications when the app is closed need a backend we haven't built yet.
- **Apple HealthKit** syncs automatically on the native iOS build (TestFlight). On the web version, HealthKit data won't appear.
- **iOS Safari notification permission requires installing to Home Screen first.** Inside the regular Safari browser, the notification prompt won't appear.
- **General fitness (no event) is intentionally not supported yet** — pick a specific race.

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

-- ── Push subscriptions ───────────────────────────────────────────────────────
-- Stores Web Push subscription objects per user.
-- One user can have multiple subscriptions (phone + laptop, etc.).

create table if not exists push_subscriptions (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade not null,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table push_subscriptions enable row level security;

create policy "Users can manage own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Notification preferences ──────────────────────────────────────────────────
-- One row per user. Created on first save; defaults match the spec.

create table if not exists notification_preferences (
  user_id                    uuid references auth.users(id) on delete cascade primary key,
  pre_workout_enabled        boolean default true,
  pre_workout_minutes_before integer default 60,
  post_workout_enabled       boolean default true,
  morning_checkin_enabled    boolean default true,
  morning_checkin_time       time    default '07:30:00',
  plan_adjustment_enabled    boolean default true,
  weekly_review_enabled      boolean default true,
  race_milestone_enabled     boolean default true,
  key_session_enabled        boolean default true,
  updated_at                 timestamptz default now()
);

alter table notification_preferences enable row level security;

create policy "Users can manage own notification preferences"
  on notification_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Adapt — subscription tracking schema
-- Run this in Supabase Dashboard → SQL Editor → New query.
--
-- DESIGN NOTE: the app has no `profiles` table (user data lives in
-- `user_data`, which the CLIENT can upsert with the anon key). Putting
-- subscription columns there would let a user grant themselves premium,
-- because Postgres RLS is row-level, not column-level. So subscriptions
-- get their OWN table: users can SELECT their row; there are NO
-- insert/update policies, so only the service role (used by
-- /api/apple-webhook and /api/subscription/status) can write.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  apple_account_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status text NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'active', 'expired', 'refunded', 'grace_period')),
  product_id text,
  original_transaction_id text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_apple_token
  ON subscriptions(apple_account_token);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Users may read their own subscription row. No write policies exist:
-- writes happen only through the service role in the API layer.
DROP POLICY IF EXISTS "Users can view own subscription" ON subscriptions;
CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- Event log — every Apple server notification, for debugging.
-- Service-role only (RLS enabled, no policies).
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  apple_account_token uuid,
  notification_type text,
  subtype text,
  product_id text,
  transaction_id text,
  expires_date timestamptz,
  environment text,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

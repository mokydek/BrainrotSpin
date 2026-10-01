-- BrainrotSpin schema. All tables are prefixed with bs_ so the bot can share a
-- database (e.g. an existing Supabase project) with other apps.

CREATE TABLE IF NOT EXISTS bs_users (
  id              BIGINT PRIMARY KEY,
  username        TEXT,
  first_name      TEXT NOT NULL DEFAULT '',
  last_name       TEXT,
  photo_url       TEXT,
  lang            TEXT NOT NULL DEFAULT 'ru',
  theme           TEXT NOT NULL DEFAULT 'sunset',
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  cases_opened    INTEGER NOT NULL DEFAULT 0,
  total_spent     BIGINT NOT NULL DEFAULT 0,
  total_won       BIGINT NOT NULL DEFAULT 0,
  best_item_id    INTEGER,
  best_value      BIGINT NOT NULL DEFAULT 0,
  upgrades_total  INTEGER NOT NULL DEFAULT 0,
  upgrades_won    INTEGER NOT NULL DEFAULT 0,
  sold_value      BIGINT NOT NULL DEFAULT 0,
  free_last_at    TIMESTAMPTZ,
  shared_at       TIMESTAMPTZ,
  awaiting        TEXT,
  web_ver         INTEGER NOT NULL DEFAULT 1,
  started_bot     BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_bot     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_users_username_idx ON bs_users (lower(username));
CREATE INDEX IF NOT EXISTS bs_users_created_idx ON bs_users (created_at);

CREATE TABLE IF NOT EXISTS bs_items (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value >= 0),
  emoji       TEXT NOT NULL DEFAULT '🎁',
  rarity      TEXT,
  image_url   TEXT,
  image_data  TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bs_cases (
  id       SERIAL PRIMARY KEY,
  slug     TEXT UNIQUE NOT NULL,
  name_ru  TEXT NOT NULL,
  name_uk  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  price    INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_free  BOOLEAN NOT NULL DEFAULT FALSE,
  emoji    TEXT NOT NULL DEFAULT '📦',
  color    TEXT NOT NULL DEFAULT '#f59e0b',
  sort     INTEGER NOT NULL DEFAULT 0,
  enabled  BOOLEAN NOT NULL DEFAULT TRUE
);
-- case picture uploaded in the admin panel (data URL); without it the app draws a chest
ALTER TABLE bs_cases ADD COLUMN IF NOT EXISTS image_data TEXT;

CREATE TABLE IF NOT EXISTS bs_case_items (
  case_id  INTEGER NOT NULL REFERENCES bs_cases(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES bs_items(id) ON DELETE CASCADE,
  chance   NUMERIC(10,4) NOT NULL CHECK (chance > 0),
  PRIMARY KEY (case_id, item_id)
);

CREATE TABLE IF NOT EXISTS bs_inventory (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES bs_items(id),
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_inventory_user_idx ON bs_inventory (user_id);

CREATE TABLE IF NOT EXISTS bs_drops (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES bs_items(id),
  value       INTEGER NOT NULL,
  case_id     INTEGER REFERENCES bs_cases(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_drops_created_idx ON bs_drops (created_at DESC);
CREATE INDEX IF NOT EXISTS bs_drops_user_idx ON bs_drops (user_id);

CREATE TABLE IF NOT EXISTS bs_upgrades (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  bet_value       INTEGER NOT NULL,
  target_item_id  INTEGER NOT NULL REFERENCES bs_items(id),
  chance          NUMERIC(7,3) NOT NULL,
  roll            NUMERIC(7,3) NOT NULL,
  won             BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_upgrades_user_idx ON bs_upgrades (user_id);

CREATE TABLE IF NOT EXISTS bs_promo_codes (
  code        TEXT PRIMARY KEY,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses        INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bs_promo_uses (
  code     TEXT NOT NULL REFERENCES bs_promo_codes(code) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES bs_users(id) ON DELETE CASCADE,
  used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS bs_settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS bs_balance_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  delta       BIGINT NOT NULL,
  reason      TEXT NOT NULL,
  admin_id    BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bs_balance_log_user_idx ON bs_balance_log (user_id);

-- Row level security with no policies: the app connects as the table owner
-- (unaffected), while public APIs such as Supabase's Data API get no access.
ALTER TABLE bs_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_case_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_inventory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_drops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_upgrades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_promo_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_promo_uses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bs_balance_log  ENABLE ROW LEVEL SECURITY;

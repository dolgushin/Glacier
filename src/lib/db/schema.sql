-- Glacier schema. Applied idempotently by src/lib/db/index.ts on first connection.
-- SQLite dialect (node:sqlite / DatabaseSync).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',   -- user | admin
  base_currency TEXT    NOT NULL DEFAULT 'RUB',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT    PRIMARY KEY,                  -- sha256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  user_agent TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT    PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT    NOT NULL DEFAULT '',
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT,
  expires_at TEXT,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolios (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  base_currency TEXT    NOT NULL DEFAULT 'RUB',
  broker        TEXT    NOT NULL DEFAULT '',
  is_archived   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY,
  portfolio_id  INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  target_weight REAL    NOT NULL DEFAULT 0,        -- percent, 0..100
  color         TEXT    NOT NULL DEFAULT '#64748b',
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_portfolio ON categories(portfolio_id);

-- Instrument catalog. owner_user_id IS NULL means a shared/global instrument
-- (fetched from MOEX/CoinGecko); non-null means a user's custom asset.
CREATE TABLE IF NOT EXISTS instruments (
  id             INTEGER PRIMARY KEY,
  owner_user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL,                 -- share | bond | etf | crypto | currency | custom
  symbol         TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  currency       TEXT    NOT NULL DEFAULT 'RUB',
  source         TEXT    NOT NULL,                 -- moex | coingecko | cbr | manual
  source_id      TEXT    NOT NULL DEFAULT '',      -- coingecko id, moex board, ...
  isin           TEXT,
  figi           TEXT,
  exchange       TEXT    NOT NULL DEFAULT '',
  board          TEXT    NOT NULL DEFAULT '',
  sector         TEXT    NOT NULL DEFAULT '',
  country        TEXT    NOT NULL DEFAULT '',
  lot_size       REAL    NOT NULL DEFAULT 1,
  face_value     REAL,                             -- bonds: номинал
  coupon_value   REAL,                             -- bonds: купон в валюте
  coupon_period  INTEGER,                          -- bonds: дней между купонами
  maturity_date  TEXT,                             -- bonds: погашение
  last_price     REAL,
  last_price_at  TEXT,
  meta           TEXT    NOT NULL DEFAULT '{}',
  created_at     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instruments_key
  ON instruments(source, symbol, COALESCE(owner_user_id, 0));
CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON instruments(symbol);

-- The ledger. Every fact about a portfolio is a row here; positions and
-- metrics are always derived, never stored.
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY,
  portfolio_id  INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  instrument_id INTEGER REFERENCES instruments(id) ON DELETE RESTRICT,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type          TEXT    NOT NULL,  -- BUY SELL DIVIDEND COUPON AMORTIZATION REDEMPTION
                                   -- DEPOSIT WITHDRAWAL FEE TAX INTEREST SPLIT
  ts            TEXT    NOT NULL,  -- ISO 8601
  quantity      REAL    NOT NULL DEFAULT 0,
  price         REAL    NOT NULL DEFAULT 0,   -- per unit, in `currency`
  amount        REAL    NOT NULL DEFAULT 0,   -- signed cash effect, in `currency`
  fee           REAL    NOT NULL DEFAULT 0,
  tax           REAL    NOT NULL DEFAULT 0,
  currency      TEXT    NOT NULL DEFAULT 'RUB',
  fx_rate       REAL    NOT NULL DEFAULT 1,   -- `currency` -> portfolio base, at ts
  note          TEXT    NOT NULL DEFAULT '',
  source        TEXT    NOT NULL DEFAULT 'manual',  -- manual | csv | tinvest
  external_id   TEXT,                               -- broker operation id
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_portfolio_ts ON transactions(portfolio_id, ts);
CREATE INDEX IF NOT EXISTS idx_tx_instrument ON transactions(instrument_id);
-- Idempotent re-import: the same broker operation never lands twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external
  ON transactions(portfolio_id, source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prices (
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,               -- YYYY-MM-DD
  close         REAL    NOT NULL,
  PRIMARY KEY (instrument_id, date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS fx_rates (
  date     TEXT NOT NULL,                        -- YYYY-MM-DD
  currency TEXT NOT NULL,
  rate     REAL NOT NULL,                        -- RUB per 1 unit of `currency`
  PRIMARY KEY (date, currency)
) WITHOUT ROWID;

-- Announced and forecast payouts, shared across users.
CREATE TABLE IF NOT EXISTS payouts (
  id            INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL DEFAULT 'dividend',  -- dividend | coupon | amortization
  ex_date       TEXT,                                 -- отсечка
  pay_date      TEXT,
  amount        REAL    NOT NULL,                     -- per unit
  currency      TEXT    NOT NULL DEFAULT 'RUB',
  status        TEXT    NOT NULL DEFAULT 'announced', -- announced | forecast
  source        TEXT    NOT NULL DEFAULT 'moex',
  fetched_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_key
  ON payouts(instrument_id, kind, COALESCE(ex_date, ''), COALESCE(pay_date, ''), amount);
CREATE INDEX IF NOT EXISTS idx_payouts_dates ON payouts(pay_date, ex_date);

-- One row per API key the user has added. A person can hold several keys for
-- the same broker (different logins) and keys for several brokers at once.
CREATE TABLE IF NOT EXISTS broker_connections (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker          TEXT    NOT NULL,              -- tinvest | bybit | binance
  label           TEXT    NOT NULL DEFAULT '',   -- user's own name for the key
  credentials_enc TEXT    NOT NULL,              -- AES-256-GCM JSON, never plaintext
  status          TEXT    NOT NULL DEFAULT '',   -- ok | error
  status_detail   TEXT    NOT NULL DEFAULT '',
  last_check_at   TEXT,
  created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_broker_connections_user ON broker_connections(user_id);

-- One row per (broker account -> portfolio) mapping. A single key often exposes
-- several accounts (брокерский, ИИС, subaccounts); each goes to its own portfolio.
CREATE TABLE IF NOT EXISTS broker_links (
  id                  INTEGER PRIMARY KEY,
  connection_id       INTEGER NOT NULL REFERENCES broker_connections(id) ON DELETE CASCADE,
  portfolio_id        INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  remote_account_id   TEXT    NOT NULL,
  remote_account_name TEXT    NOT NULL DEFAULT '',
  auto_sync           INTEGER NOT NULL DEFAULT 1,
  last_sync_at        TEXT,
  last_sync_status    TEXT    NOT NULL DEFAULT '',
  created_at          TEXT    NOT NULL,
  UNIQUE(connection_id, remote_account_id)
);
CREATE INDEX IF NOT EXISTS idx_broker_links_connection ON broker_links(connection_id);
CREATE INDEX IF NOT EXISTS idx_broker_links_portfolio ON broker_links(portfolio_id);

CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,                   -- prices | fx | payouts | broker
  status     TEXT    NOT NULL,                   -- ok | error
  detail     TEXT    NOT NULL DEFAULT '',
  started_at TEXT    NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_log_kind ON sync_log(kind, started_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

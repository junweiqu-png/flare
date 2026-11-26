CREATE TABLE navigation (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  version INTEGER NOT NULL,
  document TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expires_at);
CREATE TABLE login_flows (
  token_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  next_poll_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_flows_expiry ON login_flows (expires_at);
CREATE TABLE rate_limits (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

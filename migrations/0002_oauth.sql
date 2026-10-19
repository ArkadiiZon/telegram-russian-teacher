ALTER TABLE access_tokens ADD COLUMN parent_hash TEXT REFERENCES access_tokens(token_hash) ON DELETE CASCADE;
CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  parent_hash TEXT NOT NULL REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
  client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
  resource TEXT NOT NULL, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  parent_hash TEXT NOT NULL REFERENCES access_tokens(token_hash) ON DELETE CASCADE,
  client_id TEXT NOT NULL, resource TEXT NOT NULL, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL
);

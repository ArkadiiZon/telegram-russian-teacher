import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'PUBLIC_BASE_URL',
  'OAUTH_CLIENT_ID', 'OAUTH_REDIRECT_URIS', 'OAUTH_SIGNING_SECRET'];
const optional = ['TELEGRAM_GROUP_ID'];

// Return only explicitly allowed application keys. Do not log API bodies or credentials.
export function selectSettings(secrets) {
  if (!Array.isArray(secrets)) throw new Error('Infisical returned an invalid secrets list.');
  const selected = {};
  for (const entry of secrets) {
    if (![...required, ...optional].includes(entry.secretKey)) continue;
    if (typeof entry.secretValue !== 'string') throw new Error('An application setting has an invalid value type.');
    if (Object.hasOwn(selected, entry.secretKey)) throw new Error('Duplicate application setting returned by Infisical.');
    selected[entry.secretKey] = entry.secretValue;
  }
  const missing = required.filter(key => !selected[key]);
  if (missing.length) throw new Error(`Missing Infisical settings: ${missing.join(', ')}`);
  const base = new URL(selected.PUBLIC_BASE_URL);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username || base.password)
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin.');
  for (const key of ['TELEGRAM_WEBHOOK_SECRET', 'OAUTH_SIGNING_SECRET']) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(selected[key])) throw new Error(`Invalid ${key} format.`);
  }
  if (selected.TELEGRAM_WEBHOOK_SECRET === selected.OAUTH_SIGNING_SECRET)
    throw new Error('Webhook and OAuth signing secrets must be independent.');
  const redirects = JSON.parse(selected.OAUTH_REDIRECT_URIS);
  if (!Array.isArray(redirects) || redirects.some(uri => typeof uri !== 'string' || !uri.startsWith('https://')))
    throw new Error('OAUTH_REDIRECT_URIS must be a JSON array of exact HTTPS callback URLs (or [] while pairing).');
  return selected;
}

async function requestJson(fetcher, url, options) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error('Cannot reach Infisical. Check the Tailscale connection.'); }
  if (!response.ok) throw Object.assign(new Error(`Infisical HTTP ${response.status} at ${new URL(url).pathname}; check API compatibility and machine identity permissions.`), { status: response.status });
  try { return await response.json(); }
  catch { throw new Error('Infisical returned an invalid JSON response.'); }
}

export async function loadSettings(config, credentials, fetcher = fetch) {
  if (!credentials.clientId || !credentials.clientSecret) throw new Error('Missing Infisical machine identity credentials.');
  const base = config.siteUrl.replace(/\/$/, '');
  const login = await requestJson(fetcher, `${base}/api/v1/auth/universal-auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret })
  });
  if (typeof login.accessToken !== 'string' || !login.accessToken) throw new Error('Infisical login did not return an access token.');
  // Use the documented secrets API; no SDK/CLI installation needed.
  const query = new URLSearchParams({ projectId: config.projectId, environment: config.environment,
    secretPath: config.secretPath, recursive: 'false', includeImports: 'false', expandSecretReferences: 'false' });
  const options = { headers: { authorization: `Bearer ${login.accessToken}` } };
  let result;
  try {
    result = await requestJson(fetcher, `${base}/api/v4/secrets?${query}`, options);
  } catch (error) {
    if (error.status !== 404) throw error;
    // Older self-hosted releases expose v3/raw. Keep the exact same project scope;
    // never fall back on authentication/authorization errors.
    const legacyQuery = new URLSearchParams({ workspaceId: config.projectId, environment: config.environment,
      secretPath: config.secretPath, recursive: 'false', include_imports: 'false', expandSecretReferences: 'false' });
    result = await requestJson(fetcher, `${base}/api/v3/secrets/raw?${legacyQuery}`, options);
  }
  return selectSettings(result.secrets);
}

async function main() {
  const mode = process.argv[2] ?? 'check';
  if (!['check', 'sync', 'webhook'].includes(mode)) throw new Error('Usage: npm run infisical -- check|sync|webhook');
  const credentialsPath = process.env.INFISICAL_CREDENTIALS_FILE ?? '.local/infisical-credentials.json';
  let credentials;
  try {
    if (statSync(credentialsPath).mode & 0o077) throw new Error('unsafe_permissions');
    credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  } catch {
    throw new Error('Create .local/infisical-credentials.json with clientId and clientSecret, readable only by your user (chmod 600).');
  }
  const config = JSON.parse(readFileSync('config/infisical.json', 'utf8'));
  const settings = await loadSettings(config, credentials);
  if (mode === 'check') {
    console.log(`Validated ${required.length} app settings from project ${config.projectId}, ${config.environment}:${config.secretPath}. Values were not displayed.`);
    return;
  }
  const script = mode === 'sync' ? 'scripts/sync-secrets.mjs' : 'scripts/webhook.mjs';
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, ...settings }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${mode} failed; values were not displayed.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

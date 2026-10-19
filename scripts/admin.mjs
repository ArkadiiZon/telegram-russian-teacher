import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [command, ...args] = process.argv.slice(2);
const remote = args.includes('--remote');
const outputIndex = args.indexOf('--out');
const output = outputIndex < 0 ? null : args[outputIndex + 1];
if (outputIndex >= 0 && (!output || output.startsWith('--') || command !== 'token')) throw new Error('--out requires a file path and the token command');
const values = args.filter((a, i) => a !== '--remote' && i !== outputIndex && i !== (outputIndex < 0 ? -1 : outputIndex + 1));
const quote = s => `'${String(s).replaceAll("'", "''")}'`;
const group = s => { if (!/^-\d{1,20}$/.test(s ?? '')) throw new Error('Expected negative Telegram group ID'); return s; };
const scopes = ['config:read','config:write','lessons:read','lessons:write','lessons:post','progress:read'];
let sql, secret;
if (command === 'group') {
  const [id, title, zone = 'Europe/Madrid'] = values;
  group(id); if (!title || title.length > 160) throw new Error('Expected group title (max 160 characters)');
  new Intl.DateTimeFormat('es', { timeZone: zone });
  sql = `INSERT INTO groups(id,title,timezone,created_at) VALUES (${quote(id)},${quote(title)},${quote(zone)},${Date.now()}) ON CONFLICT(id) DO UPDATE SET title=excluded.title;`;
} else if (command === 'token') {
  const [id, permissions = scopes.join(','), days = '90'] = values;
  group(id); const granted = permissions.split(',');
  if (!granted.length || granted.some(s => !scopes.includes(s))) throw new Error('Invalid scopes');
  const lifetime = Number(days); if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 365) throw new Error('Lifetime must be 1–365 days');
  secret = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(secret).digest('hex');
  sql = `INSERT INTO access_tokens(token_hash,group_id,scopes,expires_at,created_at) VALUES (${quote(hash)},${quote(id)},${quote(JSON.stringify(granted))},${Date.now() + lifetime * 86_400_000},${Date.now()});`;
} else if (command === 'revoke') {
  const [hash] = values; if (!/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error('Use token SHA-256 hash, not the token itself');
  sql = `DELETE FROM access_tokens WHERE token_hash=${quote(hash)};`;
} else if (command === 'retry') {
  const [id, confirmation] = values;
  if (!/^[a-f0-9-]{36}$/.test(id ?? '') || confirmation !== '--checked-telegram') throw new Error('Check Telegram for a previous delivery, then pass lesson ID and --checked-telegram');
  sql = `UPDATE lessons SET status='pending',attempts=0,lease_until=NULL,error_code=NULL,publish_at=${Date.now()} WHERE id=${quote(id)} AND status IN ('failed','uncertain');`;
} else {
  console.error('Usage: npm run admin -- group <negative-id> <title> [timezone] [--remote]\n       npm run admin -- token <negative-id> [comma-scopes] [days] [--remote] [--out FILE]\n       npm run admin -- revoke <token-sha256> [--remote]\n       npm run admin -- retry <lesson-uuid> --checked-telegram [--remote]');
  process.exit(1);
}
mkdirSync('.local', { recursive: true, mode: 0o700 });
const path = `.local/admin-${randomBytes(8).toString('hex')}.sql`;
writeFileSync(path, sql, { mode: 0o600 });
let outputWritten = false, persisted = false;
try {
  if (secret && output) {
    writeFileSync(output, JSON.stringify({ MCP_GROUP_TOKEN: secret }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    outputWritten = true;
  }
  const result = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--file', path], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = 1;
  else if (secret) {
    persisted = true;
    // --out keeps the new credential out of terminal/tool logs.
    if (output) console.log(`Group access token saved privately to ${output}`);
    else console.log(`\nGroup access token (save in Infisical now):\n${secret}`);
    console.log(`Revocation hash: ${createHash('sha256').update(secret).digest('hex')}`);
  }
} finally {
  unlinkSync(path);
  if (outputWritten && !persisted) unlinkSync(output);
}

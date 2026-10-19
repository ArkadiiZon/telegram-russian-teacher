import { AppError, SCOPES, type Env, type Principal, type Scope } from './types';
export async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
// Hash both inputs before comparison so length and prefix do not leak the secret.
export async function secretEqual(a: string, b: string) {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export async function authenticate(request: Request, env: Env): Promise<Principal> {
  const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new AppError('unauthorized', 401);
  const row = await env.DB.prepare('SELECT group_id, scopes FROM access_tokens WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(match[1]), Date.now()).first<{ group_id: string; scopes: string }>();
  if (!row) throw new AppError('unauthorized', 401);
  const scopes: unknown = JSON.parse(row.scopes);
  if (!Array.isArray(scopes) || scopes.some(s => !SCOPES.includes(s))) throw new AppError('unauthorized', 401);
  return { groupId: row.group_id, scopes };
}
export function authorize(principal: Principal, group: string, scope: Scope) {
  if (principal.groupId !== group || !principal.scopes.includes(scope)) throw new AppError('forbidden', 403);
}

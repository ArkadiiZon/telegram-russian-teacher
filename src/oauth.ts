import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError, SCOPES, type Env, type Scope } from './types';
import { authenticate, secretEqual, sha256 } from './auth';
const b64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function pkceChallenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
const consent = z.object({
  client_id: z.string(), redirect_uri: z.string().url(), response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
  state: z.string().min(1).max(1024), resource: z.string().url(), scope: z.string().max(500)
});
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
@Injectable()
export class OAuth {
  constructor(private env: Env) {}
  get base() { return this.env.PUBLIC_BASE_URL.replace(/\/$/, ''); }
  get resource() { return `${this.base}/mcp`; }
  metadata() {
    return {
      issuer: this.base, authorization_endpoint: `${this.base}/oauth/authorize`, token_endpoint: `${this.base}/oauth/token`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
      scopes_supported: SCOPES, authorization_response_iss_parameter_supported: true
    };
  }
  protectedResource() { return { resource: this.resource, authorization_servers: [this.base], scopes_supported: SCOPES }; }
  private validate(parameters: Record<string, string>) {
    const parsed = consent.parse({ ...parameters, scope: parameters.scope ?? SCOPES.join(' ') });
    const redirects = z.array(z.string().url()).parse(JSON.parse(this.env.OAUTH_REDIRECT_URIS));
    if (parsed.client_id !== this.env.OAUTH_CLIENT_ID || !redirects.includes(parsed.redirect_uri) || parsed.resource !== this.resource)
      throw new AppError('invalid_oauth_client');
    const scopes = parsed.scope.split(/\s+/).filter(Boolean);
    if (!scopes.length || scopes.some(s => !SCOPES.includes(s as Scope))) throw new AppError('invalid_scope');
    return parsed;
  }
  private async signature(value: string) {
    if (this.env.OAUTH_SIGNING_SECRET.length < 32) throw new AppError('oauth_not_configured', 503);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(this.env.OAUTH_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
  }
  async authorizePage(request: Request) {
    const parsed = this.validate(Object.fromEntries(new URL(request.url).searchParams));
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ parameters: parsed, exp: Date.now() + 300_000 })));
    const signed = `${payload}.${await this.signature(payload)}`;
    // Chromium applies form-action to redirects too. Permit only the already
    // validated callback path, while keeping unrelated form destinations blocked.
    const callback = new URL(parsed.redirect_uri);
    const callbackSource = `${callback.origin}${callback.pathname}`.replace(/[;'"\s]/g,
      char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar profesor de ruso</title><h1>Conectar ChatGPT al profesor de ruso</h1><p>Permisos solicitados: ${escape(parsed.scope)}</p><p>Introduce tu token de acceso del grupo. La conexión quedará limitada a ese grupo y a sus permisos. Usa únicamente el token generado para esta aplicación.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="consent" value="${escape(signed)}"><label>Token del grupo <input type="password" name="group_token" required autocomplete="off"></label><button type="submit">Autorizar conexión</button></form></html>`, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; form-action 'self' ${callbackSource}; frame-ancestors 'none'; base-uri 'none'`, 'referrer-policy': 'same-origin' }
    });
  }
  async approve(request: Request) {
    if (request.headers.get('origin') !== new URL(this.base).origin) throw new AppError('invalid_origin', 403);
    const form = new URLSearchParams(await request.text());
    const [payload, sig] = (form.get('consent') ?? '').split('.');
    if (!payload || !sig || !await secretEqual(sig, await this.signature(payload))) throw new AppError('invalid_consent');
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) throw new AppError('consent_expired');
    const parsed = this.validate(decoded.parameters);
    const token = form.get('group_token') ?? '';
    const principal = await authenticate(new Request(this.resource, { headers: { authorization: `Bearer ${token}` } }), this.env);
    const scopes = parsed.scope.split(/\s+/).filter(Boolean) as Scope[];
    if (scopes.some(s => !principal.scopes.includes(s))) throw new AppError('scope_not_granted', 403);
    const code = randomToken();
    await this.env.DB.prepare(`INSERT INTO oauth_codes(code_hash,parent_hash,client_id,redirect_uri,challenge,resource,scopes,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(await sha256(code), await sha256(token), parsed.client_id, parsed.redirect_uri,
        parsed.code_challenge, parsed.resource, JSON.stringify(scopes), Date.now() + 120_000).run();
    const redirect = new URL(parsed.redirect_uri);
    redirect.searchParams.set('code', code); redirect.searchParams.set('state', parsed.state); redirect.searchParams.set('iss', this.base);
    return new Response(null, { status: 302, headers: { location: redirect.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  async exchange(request: Request) {
    const form = new URLSearchParams(await request.text());
    if (form.get('client_id') !== this.env.OAUTH_CLIENT_ID || form.get('resource') !== this.resource) throw new AppError('invalid_client');
    const now = Date.now();
    let grant: { parent_hash: string; scopes: string; resource: string } | null = null;
    if (form.get('grant_type') === 'authorization_code') {
      const verifier = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).parse(form.get('code_verifier'));
      grant = await this.env.DB.prepare(`DELETE FROM oauth_codes WHERE code_hash = ? AND client_id = ? AND redirect_uri = ?
        AND challenge = ? AND resource = ? AND expires_at > ? RETURNING parent_hash, scopes, resource`)
        .bind(await sha256(form.get('code') ?? ''), this.env.OAUTH_CLIENT_ID, form.get('redirect_uri'),
          await pkceChallenge(verifier), this.resource, now).first();
    } else if (form.get('grant_type') === 'refresh_token') {
      grant = await this.env.DB.prepare(`DELETE FROM oauth_refresh_tokens WHERE token_hash = ? AND client_id = ?
        AND resource = ? AND expires_at > ? RETURNING parent_hash, scopes, resource`)
        .bind(await sha256(form.get('refresh_token') ?? ''), this.env.OAUTH_CLIENT_ID, this.resource, now).first();
    } else throw new AppError('unsupported_grant_type');
    if (!grant) throw new AppError('invalid_grant');
    const parent = await this.env.DB.prepare('SELECT group_id, expires_at FROM access_tokens WHERE token_hash = ? AND expires_at > ?')
      .bind(grant.parent_hash, now).first<{ group_id: string; expires_at: number }>();
    if (!parent) throw new AppError('invalid_grant');
    const access = randomToken(), refresh = randomToken();
    const expiresAt = Math.min(now + 3_600_000, parent.expires_at);
    await this.env.DB.batch([
      this.env.DB.prepare(`INSERT INTO access_tokens(token_hash,group_id,scopes,expires_at,created_at,parent_hash) VALUES (?,?,?,?,?,?)`)
        .bind(await sha256(access), parent.group_id, grant.scopes, expiresAt, now, grant.parent_hash),
      this.env.DB.prepare(`INSERT INTO oauth_refresh_tokens(token_hash,parent_hash,client_id,resource,scopes,expires_at) VALUES (?,?,?,?,?,?)`)
        .bind(await sha256(refresh), grant.parent_hash, this.env.OAUTH_CLIENT_ID, this.resource, grant.scopes, Math.min(now + 30 * 86_400_000, parent.expires_at))
    ]);
    return Response.json({ access_token: access, token_type: 'Bearer', expires_in: Math.floor((expiresAt - now) / 1000),
      refresh_token: refresh, scope: JSON.parse(grant.scopes).join(' ') }, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
  }
}

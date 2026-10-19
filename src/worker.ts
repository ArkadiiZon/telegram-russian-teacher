import 'reflect-metadata';
import type { Update } from 'grammy/types';
import { z } from 'zod';
import { application } from './app.module';
import { AppError, type Env } from './types';
import { secretEqual } from './auth';
import { McpEndpoint } from './mcp';
import { OAuth } from './oauth';
import { Scheduler } from './scheduler';
import { Telegram } from './telegram';
async function boundedRequest(request: Request) {
  const limit = 32_768;
  const reader = request.body?.getReader();
  if (!reader) return request;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new AppError('body_too_large', 413); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '';
    try {
      if (url.pathname === '/health' && request.method === 'GET') return Response.json({ ok: true, service: 'russian-teacher' });
      // Authenticate webhook before reading its body or booting Nest.
      if (url.pathname === '/telegram/webhook') {
        if (request.method !== 'POST') throw new AppError('method_not_allowed', 405);
        if (!env.TELEGRAM_WEBHOOK_SECRET || !await secretEqual(request.headers.get('x-telegram-bot-api-secret-token') ?? '', env.TELEGRAM_WEBHOOK_SECRET))
          throw new AppError('unauthorized', 401);
        request = await boundedRequest(request);
        const body = await request.json() as Update;
        if (!Number.isSafeInteger(body.update_id) || body.update_id < 0) throw new AppError('invalid_update');
        const app = await application(env);
        await app.get(Telegram).handle(body);
        return Response.json({ ok: true });
      }
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(base).origin) throw new AppError('invalid_origin', 403);
      if (request.method === 'POST') request = await boundedRequest(request);
      const app = await application(env);
      const oauth = app.get(OAuth);
      if (request.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp'))
        return Response.json(oauth.protectedResource());
      if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') return Response.json(oauth.metadata());
      if (url.pathname === '/oauth/authorize' && request.method === 'GET') return await oauth.authorizePage(request);
      if (url.pathname === '/oauth/authorize' && request.method === 'POST') return await oauth.approve(request);
      if (url.pathname === '/oauth/token' && request.method === 'POST') return await oauth.exchange(request);
      if (url.pathname === '/mcp') return await app.get(McpEndpoint).handle(request);
      throw new AppError('not_found', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500;
      const code = error instanceof AppError ? error.code : status === 400 ? 'invalid_request' : 'internal_error';
      // Never log request bodies, credentials, upstream error URLs, or raw exceptions.
      if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', code }));
      const headers: Record<string, string> = { 'cache-control': 'no-store' };
      if (status === 401 && url.pathname === '/mcp') headers['www-authenticate'] = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
      if (status === 503) headers['retry-after'] = '5';
      return Response.json({ error: code }, { status, headers });
    }
  },
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const app = await application(env);
    await app.get(Scheduler).tick();
  }
} satisfies ExportedHandler<Env>;

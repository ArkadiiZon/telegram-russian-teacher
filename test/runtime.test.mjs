import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
let mf, db, mocks;
const token = randomBytes(32).toString('base64url');
const readonly = randomBytes(32).toString('base64url');
const hash = s => createHash('sha256').update(s).digest('hex');
const base = 'https://teacher.example';
const callback = 'https://chatgpt.example/callback';
const group = '-1001234567890', otherGroup = '-1009876543210';
let lessonId;
const tick = (credential = token) => mf.dispatchFetch(`${base}/internal/scheduler/tick`, {
  method: 'POST', headers: { authorization: `Bearer ${credential}` }
});
const rpc = (name, args, credential = token) => mf.dispatchFetch(`${base}/mcp`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${credential}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
});
before(async () => {
  await build({ entryPoints: ['dist/worker.js'], outfile: '.local/test-worker.js', bundle: true, format: 'esm', platform: 'node', external: ['node:*', 'cloudflare:*'] });
  const interceptors = [];
  mocks = { get: origin => ({ intercept: ({path, method}) => ({ reply: (status, body) => {
    interceptors.push({url: origin + path, method, status, body});
  } }) }), assertNoPendingInterceptors: () => assert.equal(interceptors.length, 0) };
  const outboundService = async request => {
    const index = interceptors.findIndex(i => i.url === request.url && i.method === request.method);
    if (index < 0) throw new Error('Unexpected external network request in isolated test');
    const reply = interceptors.splice(index, 1)[0];
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: {'content-type':'application/json'} });
  };
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: '.local/test-worker.js', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], outboundService, bindings: {
      PUBLIC_BASE_URL: base, TELEGRAM_BOT_TOKEN: '123456:TEST_TOKEN', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      OAUTH_CLIENT_ID: 'teacher-chatgpt',
      OAUTH_REDIRECT_URIS: JSON.stringify([callback]), OAUTH_SIGNING_SECRET: 'test-signing-secret-at-least-32-characters'
    } }));
  db = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0002_oauth.sql']) {
    const statements = readFileSync(`migrations/${file}`, 'utf8').split(';').map(s => s.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
  }
  for (const id of [group, otherGroup]) await db.prepare('INSERT INTO groups(id,title,created_at) VALUES (?,?,?)').bind(id, 'Amigos españoles', Date.now()).run();
  for (const [secret, permissions] of [[token, ['config:read','config:write','lessons:read','lessons:write','lessons:post','progress:read']], [readonly, ['config:read']]])
    await db.prepare('INSERT INTO access_tokens(token_hash,group_id,scopes,expires_at,created_at) VALUES (?,?,?,?,?)')
      .bind(hash(secret), group, JSON.stringify(permissions), Date.now() + 86_400_000, Date.now()).run();
}, { timeout: 60_000 });
after(async () => { if (mf) await mf.dispose(); });
test('Workers boot health and real Nest dependency container', async () => {
  assert.equal((await mf.dispatchFetch(`${base}/health`)).status, 200);
  const res = await mf.dispatchFetch(`${base}/.well-known/oauth-authorization-server`);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual((await res.json()).code_challenge_methods_supported, ['S256']);
});
test('MCP rejects missing credentials and advertises OAuth discovery', async () => {
  const res = await mf.dispatchFetch(`${base}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /oauth-protected-resource/);
});
test('MCP initialize uses real stateless Streamable HTTP transport', async () => {
  const res = await mf.dispatchFetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).result.serverInfo.name, 'russian-teacher');
});
test('MCP cannot read a different group', async () => {
  const res = await rpc('get_group_config', { group_id: otherGroup });
  const result = (await res.json()).result;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, 'forbidden');
});
test('read-only token cannot invoke writes', async () => {
  const res = await rpc('update_group_config', { group_id: group, patch: { enabled: true } }, readonly);
  const result = await res.json();
  assert.ok(result.error || result.result?.isError);
  assert.equal((await db.prepare('SELECT enabled FROM groups WHERE id=?').bind(group).first()).enabled, 0);
});
test('unknown config fields and invalid timezone are rejected', async () => {
  for (const patch of [{ timezone: 'Invalid/Nowhere' }, { title: 'Injected', enabled: true }]) {
    const result = await (await rpc('update_group_config', { group_id: group, patch })).json();
    assert.ok(result.error || result.result?.isError);
  }
});
test('ChatGPT can author Spanish lesson once using an idempotency key', async () => {
  const args = { group_id: group, kind: 'lesson', topic: 'saludos', publish_at: new Date().toISOString(), idempotency_key: 'routine:lesson:one',
    content: { title: '¡Hola en ruso!', text: 'Привет — hola. Pronunciación aproximada: priviét. Ejemplo: Привет, Мария! — ¡Hola, María!' } };
  const first = (await (await rpc('schedule_lesson', args)).json()).result;
  assert.ok(first && !first.isError, JSON.stringify(first));
  const second = (await (await rpc('schedule_lesson', args)).json()).result;
  lessonId = JSON.parse(first.content[0].text).id;
  assert.equal(JSON.parse(second.content[0].text).id, lessonId);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lessons').first()).n, 1);
});
test('paused group does not send; enabling delivers authored content from ChatGPT', async () => {
  await tick();
  assert.equal((await db.prepare('SELECT status FROM lessons WHERE id=?').bind(lessonId).first()).status, 'pending');
  await rpc('update_group_config', { group_id: group, patch: { enabled: true } });
  mocks.get('https://api.telegram.org').intercept({ path: '/bot123456:TEST_TOKEN/sendMessage', method: 'POST' })
    .reply(200, { ok: true, result: { message_id: 5, date: 1, chat: { id: Number(group), type: 'supergroup' }, text: 'lesson' } });
  const res = await tick();
  assert.equal(res.status, 200);
  assert.equal((await db.prepare('SELECT status FROM lessons WHERE id=?').bind(lessonId).first()).status, 'sent');
  await tick(); // No mock left: a duplicate delivery would fail.
  mocks.assertNoPendingInterceptors();
});
test('webhook authenticates before parsing and deduplicates quiz results', async () => {
  assert.equal((await mf.dispatchFetch(`${base}/telegram/webhook`, { method: 'POST', body: '{}' })).status, 401);
  await db.prepare(`INSERT INTO lessons(id,group_id,kind,topic,publish_at,dedupe_key,status,poll_id,correct_option,created_at,content) VALUES (?,?,?,?,?,?,'sent',?,?,?,?)`)
    .bind('quiz-test', group, 'quiz', 'saludos', Date.now(), 'quiz-test', 'poll-123', 1, Date.now(), '{}').run();
  mocks.get('https://api.telegram.org').intercept({ path: '/bot123456:TEST_TOKEN/getMe', method: 'POST' })
    .reply(200, { ok: true, result: { id: 123456, is_bot: true, first_name: 'Teacher', username: 'teacher_bot' } });
  mocks.get('https://api.telegram.org').intercept({ path: '/bot123456:TEST_TOKEN/getChatMember', method: 'POST' })
    .reply(200, { ok: true, result: { status: 'member', user: { id: 777, is_bot: false, first_name: 'Amigo' } } });
  const update = { update_id: 123, poll_answer: { poll_id: 'poll-123', user: { id: 777, is_bot: false, first_name: 'Amigo' }, option_ids: [1] } };
  for (let i = 0; i < 2; i++) {
    const res = await mf.dispatchFetch(`${base}/telegram/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'test-webhook-secret' }, body: JSON.stringify(update) });
    assert.equal(res.status, 200, await res.clone().text());
  }
  const progress = JSON.parse((await (await rpc('get_progress', { group_id: group })).json()).result.content[0].text);
  assert.equal(progress.answered, 1); assert.equal(progress.correct, 1);
});
test('interrupted delivery is quarantined instead of automatically reposted', async () => {
  await db.prepare(`UPDATE lessons SET status='sending', lease_until=0 WHERE id=?`).bind(lessonId).run();
  await tick();
  assert.equal((await db.prepare('SELECT status FROM lessons WHERE id=?').bind(lessonId).first()).status, 'uncertain');
});
test('BullMQ trigger requires posting permission and cannot recover another group leases', async () => {
  assert.equal((await mf.dispatchFetch(`${base}/internal/scheduler/tick`, { method: 'POST' })).status, 401);
  assert.equal((await tick(readonly)).status, 403);
  await db.prepare(`INSERT INTO lessons(id,group_id,kind,topic,publish_at,dedupe_key,status,lease_until,created_at,content)
    VALUES ('other-lease',?,'lesson','private',0,'other-lease','sending',1,0,'{}')`).bind(otherGroup).run();
  await db.prepare('UPDATE groups SET enabled=1 WHERE id=?').bind(otherGroup).run();
  await db.prepare(`INSERT INTO lessons(id,group_id,kind,topic,publish_at,dedupe_key,status,created_at,content)
    VALUES ('other-pending',?,'lesson','private',0,'other-pending','pending',0,'{}')`).bind(otherGroup).run();
  assert.equal((await tick()).status, 200);
  assert.equal((await db.prepare("SELECT status FROM lessons WHERE id='other-lease'").first()).status, 'sending');
  assert.equal((await db.prepare("SELECT status FROM lessons WHERE id='other-pending'").first()).status, 'pending');
});

test('OAuth rejects an unregistered callback', async () => {
  const params = new URLSearchParams({ client_id: 'teacher-chatgpt', response_type: 'code', redirect_uri: 'https://evil.example', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: 'state', resource: `${base}/mcp` });
  assert.equal((await mf.dispatchFetch(`${base}/oauth/authorize?${params}`)).status, 400);
});
test('OAuth form keeps a same-origin browser POST while rejecting null and foreign origins', async () => {
  const params = new URLSearchParams({ client_id: 'teacher-chatgpt', response_type: 'code', redirect_uri: callback,
    code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: 'browser-csrf-test', resource: `${base}/mcp` });
  const response = await mf.dispatchFetch(`${base}/oauth/authorize?${params}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
  const html = await response.text();
  const signed = /name="consent" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(signed);
  const body = new URLSearchParams({consent: signed, group_token: token}).toString();
  for (const origin of ['null', 'https://untrusted.example', undefined]) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? {origin} : {}) };
    const denied = await mf.dispatchFetch(`${base}/oauth/authorize`, {method:'POST',headers,body});
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'invalid_origin');
  }
});
test('OAuth PKCE, single-use codes, rotated refresh and parent revocation', async () => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ client_id: 'teacher-chatgpt', response_type: 'code', redirect_uri: callback, code_challenge: challenge, code_challenge_method: 'S256', state: 'csrf-check', resource: `${base}/mcp`, scope: 'config:read' });
  const page = await (await mf.dispatchFetch(`${base}/oauth/authorize?${params}`)).text();
  const consent = /name="consent" value="([^"]+)"/.exec(page)?.[1];
  assert.ok(consent, page);
  const approved = await mf.dispatchFetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ consent, group_token: readonly }).toString() });
  assert.equal(approved.status, 302, await approved.clone().text());
  assert.equal(approved.headers.get('referrer-policy'), 'no-referrer');
  const redirect = new URL(approved.headers.get('location'));
  assert.equal(redirect.searchParams.get('state'), 'csrf-check');
  const exchange = body => mf.dispatchFetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'teacher-chatgpt', resource: `${base}/mcp`, ...body }).toString() });
  const codeBody = { grant_type: 'authorization_code', code: redirect.searchParams.get('code'), redirect_uri: callback, code_verifier: verifier };
  assert.equal((await exchange({ ...codeBody, code_verifier: 'z'.repeat(43) })).status, 400);
  const result = await exchange(codeBody);
  assert.equal(result.status, 200, await result.clone().text());
  const creds = await result.json();
  assert.equal((await exchange(codeBody)).status, 400);
  assert.equal((await rpc('get_group_config', { group_id: group }, creds.access_token)).status, 200);
  const refreshBody = { grant_type: 'refresh_token', refresh_token: creds.refresh_token };
  const refreshed = await exchange(refreshBody);
  assert.equal(refreshed.status, 200);
  assert.equal((await exchange(refreshBody)).status, 400);
  await db.prepare('DELETE FROM access_tokens WHERE token_hash=?').bind(hash(readonly)).run();
  assert.equal((await rpc('get_group_config', { group_id: group }, creds.access_token)).status, 401);
});
test('get_lesson returns authored content only to the authorized group', async () => {
  const result = (await (await rpc('get_lesson', { group_id: group, lesson_id: lessonId })).json()).result;
  assert.equal(JSON.parse(result.content[0].text).content.title, '¡Hola en ruso!');
  const forbidden = (await (await rpc('get_lesson', { group_id: otherGroup, lesson_id: lessonId })).json()).result;
  assert.equal(forbidden.isError, true);
});
test('authored quizzes become native non-anonymous Telegram polls', async () => {
  const content = { question: '¿Cómo se dice hola en ruso?', options: ['Спасибо', 'Привет', 'Да', 'Нет'], correct_option: 1, explanation: 'Привет significa hola en un contexto informal.' };
  const result = (await (await rpc('schedule_lesson', { group_id: group, kind: 'quiz', topic: 'saludos', publish_at: new Date().toISOString(), idempotency_key: 'routine:quiz:two', content })).json()).result;
  assert.ok(!result.isError, JSON.stringify(result));
  mocks.get('https://api.telegram.org').intercept({ path: '/bot123456:TEST_TOKEN/sendPoll', method: 'POST' })
    .reply(200, { ok: true, result: { message_id: 6, date: 1, chat: { id: Number(group), type: 'supergroup' }, poll: { id: 'poll-authored', type: 'quiz', is_anonymous: false } } });
  await tick();
  const row = await db.prepare('SELECT status, poll_id, correct_option FROM lessons WHERE id=?').bind(JSON.parse(result.content[0].text).id).first();
  assert.equal(row.status, 'sent'); assert.equal(row.poll_id, 'poll-authored'); assert.equal(row.correct_option, 1);
  mocks.assertNoPendingInterceptors();
});
test('content is mandatory and wrong lesson/quiz schema is rejected', async () => {
  const args = { group_id: group, kind: 'quiz', topic: 'saludos', publish_at: new Date().toISOString(), idempotency_key: 'invalid:content' };
  for (const input of [args, { ...args, content: { title: 'Invalid quiz', text: 'Not a quiz' } }]) {
    const result = await (await rpc('schedule_lesson', input)).json();
    assert.ok(result.error || result.result?.isError);
  }
});
test('same key cannot silently replace content', async () => {
  const result = (await (await rpc('schedule_lesson', { group_id: group, kind: 'lesson', topic: 'saludos', publish_at: new Date().toISOString(), idempotency_key: 'routine:lesson:one', content: { title: 'Different', text: 'Changed' } })).json()).result;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, 'idempotency_key_conflict');
});
test('oversized and cross-origin MCP requests are rejected', async () => {
  const large = await mf.dispatchFetch(`${base}/mcp`, { method: 'POST', body: 'x'.repeat(33_000) });
  assert.equal(large.status, 413);
  const origin = await mf.dispatchFetch(`${base}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' });
  assert.equal(origin.status, 403);
});
test('Telegram send errors stay uncertain and are not auto-retried', async () => {
  const result = (await (await rpc('schedule_lesson', { group_id: group, kind: 'lesson', topic: 'fallo', publish_at: new Date().toISOString(), idempotency_key: 'test:send:failure', content: { title: 'Test', text: 'Привет — hola.' } })).json()).result;
  const id = JSON.parse(result.content[0].text).id;
  mocks.get('https://api.telegram.org').intercept({ path: '/bot123456:TEST_TOKEN/sendMessage', method: 'POST' })
    .reply(500, { ok: false, error_code: 500, description: 'Temporary error' });
  await tick();
  await tick();
  assert.equal((await db.prepare('SELECT status FROM lessons WHERE id=?').bind(id).first()).status, 'uncertain');
  mocks.assertNoPendingInterceptors();
});

import { Queue, Worker, UnrecoverableError } from 'bullmq';

// This Node process runs on the ops host, never inside Cloudflare Workers.
const base = new URL(process.env.PUBLIC_BASE_URL ?? '');
if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('HTTPS required');
const token = process.env.SCHEDULER_GROUP_TOKEN;
if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('Missing scheduler group token');
const redis = new URL(process.env.REDIS_URL ?? 'redis://redis:6379');
if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error('Invalid Redis protocol');
const connection = {
  host: redis.hostname, port: Number(redis.port || 6379),
  username: redis.username ? decodeURIComponent(redis.username) : undefined,
  password: redis.password ? decodeURIComponent(redis.password) : undefined,
  db: Number(redis.pathname.slice(1) || 0),
  ...(redis.protocol === 'rediss:' ? { tls: {} } : {}),
};
const name = 'russian-teacher-delivery';
const queue = new Queue(name, { connection: { ...connection, maxRetriesPerRequest: 1 } });
queue.on('error', () => console.error(JSON.stringify({ event: 'queue_connection_failed' })));
await queue.upsertJobScheduler('delivery-every-minute', { pattern: '* * * * *', tz: 'UTC' }, {
  name: 'dispatch-due-lessons', data: {}, opts: {
    attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100, removeOnFail: 100,
  },
});
const worker = new Worker(name, async () => {
  const response = await fetch(new URL('/internal/scheduler/tick', base), {
    method: 'POST', headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(90_000), redirect: 'error',
  });
  // Never log upstream bodies, URLs containing credentials, or raw exceptions.
  if (response.status === 401 || response.status === 403) throw new UnrecoverableError('scheduler_authorization_failed');
  if (!response.ok) throw new Error('scheduler_request_failed');
  const result = await response.json() as { ok?: boolean };
  if (result.ok !== true) throw new Error('invalid_scheduler_response');
}, { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 1 });
worker.on('error', () => console.error(JSON.stringify({ event: 'scheduler_connection_failed' })));
worker.on('failed', () => console.error(JSON.stringify({ event: 'scheduler_job_failed' })));
worker.on('completed', () => console.log(JSON.stringify({ event: 'scheduler_tick_completed', at: new Date().toISOString() })));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await worker.close();
  await queue.close();
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await worker.waitUntilReady();
console.log(JSON.stringify({ event: 'scheduler_ready' }));

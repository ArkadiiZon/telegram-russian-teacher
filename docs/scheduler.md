# BullMQ delivery scheduler

Decision: use BullMQ with Redis on the always-on ops box for the delivery cron.
Cloudflare keeps the NestJS application, MCP, OAuth, Telegram webhook, and D1.
`wrangler.toml` has an empty cron list and there is no Cloudflare scheduled handler.
BullMQ's Node process needs persistent Redis connections and runs separately from
the request-driven Cloudflare Worker.

## Settings and secrets

Keep these in the bot's Infisical production project, alongside the existing six
Cloudflare settings. Only `PUBLIC_BASE_URL` is shared between the two runtimes.

| Setting | Scheduler value / purpose |
| --- | --- |
| `PUBLIC_BASE_URL` | Public HTTPS Cloudflare origin |
| `SCHEDULER_GROUP_TOKEN` | Dedicated expiring group grant with only `lessons:post` |
| `REDIS_URL` | `redis://redis:6379` inside the dedicated Compose network; use `rediss://` with credentials for external Redis |

Never reuse the broader ChatGPT grant for this process. Mint a posting-only token:

```sh
npm run admin -- token GROUP_ID lessons:post 90 --remote --out .local/scheduler-token.json
```

Import its value into Infisical as `SCHEDULER_GROUP_TOKEN`. Export only the three
settings above into a private `.local/scheduler.env` on the ops host (mode 0600,
directory 0700). Do not export all project secrets into the scheduler. The
Cloudflare secret sync intentionally ignores scheduler-only settings. The
scheduler does not need the Telegram bot token, Infisical machine credential,
OAuth signing secret, or a Cloudflare deployment credential.

## Run and inspect

```sh
docker compose -f compose.scheduler.yml up -d --build
docker compose -f compose.scheduler.yml ps
docker compose -f compose.scheduler.yml logs --tail=30 scheduler
```

Expect `scheduler_ready` and a `scheduler_tick_completed` event each minute.
Messages contain no tokens or upstream error bodies. Queue failures emit
`scheduler_job_failed`; Redis connection problems emit connection failure events.
Monitor those events and missing completed ticks on the host. A ready process
alone does not prove successful authenticated delivery.

The dedicated Redis service has no host port, uses an internal Docker network,
and persists AOF data in a named volume with `noeviction`. Keep this network
exclusive to this application. External/shared Redis requires authentication
and TLS. Do not point this application at Infisical's Redis container.

For development with a separate local bot and a local posting grant:

```sh
node --env-file=.local/scheduler.env --experimental-strip-types src/queue-runner.ts
```

## Delivery and recovery

The stable BullMQ Job Scheduler runs `* * * * *` in UTC. Publication timestamps
are already resolved by ChatGPT using the group's timezone. Redis stores only
empty delivery trigger jobs, never lesson content or credentials. D1 retains
all pending content and the existing deduplication, lease, and `uncertain` rules.
Only the token's group can be selected or have expired delivery leases recovered.
An enabled group is still required. At most three entries are delivered per tick.

Tick requests time out after 90 seconds. Transient failures get three attempts
with exponential backoff starting at five seconds. Authorization failures do
not retry within that job; future minute jobs still report failure until the
token is fixed. Queue history retains the last 100 successful and failed jobs.
On shutdown, the worker finishes its active request before closing connections.

If Redis or the ops host stops, pending lessons stay in D1 and resume on recovery.
Restarting the scheduler recreates the same recurring schedule if Redis was
lost. Do not delete Redis volumes during ordinary updates. Do not manually retry
`uncertain` lessons until Telegram has been checked for an earlier delivery.

The token expires after 90 days. Rotate it before expiry: create a new posting
grant, update Infisical, refresh the private env file, recreate the scheduler,
verify a completed tick, then revoke the old grant by its SHA-256 hash. Revocation
or expiry immediately prevents further requests. For another group, use its
own grant and a separate Compose project (`-p`) and Redis volume.

## Rollout

Deploy the authenticated Cloudflare endpoint and start BullMQ, then verify a
completed tick. Cloudflare Cron is removed by this release. Keep the migration
window short; existing pending content survives it. Test actual publishing only
with authorized content, and verify `sent` through MCP. A successful empty tick
checks queue execution and authorization without sending a Telegram message.

References: [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers),
[connections](https://docs.bullmq.io/guide/connections),
[production guidance](https://docs.bullmq.io/guide/going-to-production).

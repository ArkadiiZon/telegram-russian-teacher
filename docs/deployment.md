# Production setup

- Worker: https://telegram-russian-teacher.arkadizon.workers.dev
- MCP: https://telegram-russian-teacher.arkadizon.workers.dev/mcp
- Telegram bot: @rus_es_teacher_bot
- Group: Aprendiendo Ruso (`-5255940220`), Europe/Madrid, publishing enabled
- Delivery scheduler: BullMQ + dedicated Redis on `zonbook-ops`, in `~/russian-teacher`
- Cloudflare Cron Triggers: disabled
- Infisical project: `f51da42d-632d-4516-9a98-3fb013479426`, `prod`, `/`
- Private plugin: https://chatgpt.com/plugins/plugins_6ad684df906c8191812b07a6caabd2a1

The production D1 schema is applied, all six Cloudflare runtime settings are synchronized
from Infisical, and the Telegram webhook is registered. Live MCP initialization,
tool discovery, reading group configuration, and updating the selected group
were verified with the scoped deployment credential. This did not post a lesson.

The plugin's teaching skill defaults to this selected group. Its saved release
is separate from installation and OAuth account connection. Finish pairing in
ChatGPT and copy the exact callback URL into Infisical's OAUTH_REDIRECT_URIS,
then run `npm run infisical -- sync`. The current empty callback list intentionally
prevents OAuth connection until the exact callback is configured.

Keep MCP_GROUP_TOKEN in Infisical and use it only on this backend's OAuth consent
page. It is not a Worker environment variable. Credentials and generated token
files are excluded from Git. Do not include them in routine prompts.

No recurring ChatGPT task has been activated yet. After pairing, configure the
routine with this plugin available and verify its first scheduled run. The
backend only publishes authored content already saved in D1.

## BullMQ deployment

The release replaces the Cloudflare delivery cron with an always-on BullMQ Node
process and a dedicated Redis service. The ops installation lives at
`/home/deploy/russian-teacher` and uses `compose.scheduler.yml`. Redis has no
public port, uses AOF persistence, and is separate from Infisical infrastructure.
The runner calls the scoped Cloudflare delivery endpoint once per minute.

Its private `.local/scheduler.env` contains only `PUBLIC_BASE_URL`, `REDIS_URL`,
and `SCHEDULER_GROUP_TOKEN`. The grant is restricted to `lessons:post` for
Aprendiendo Ruso and expires after 90 days. The scheduler settings have been
imported into the same Infisical `prod` root and verified against deployment
without displaying values. Infisical remains the source of truth. The private
Desktop import file contains the dedicated scheduler token, not the broader
ChatGPT grant. The Viewer machine identity can verify settings but cannot write
them to Infisical.

Live verification on 2026-10-19: Redis healthy, scheduler running, and a BullMQ
job completed an authenticated Cloudflare tick at 21:14:00 UTC. Production D1
contained no lessons during this check, so no Telegram message was sent. Local
validation passed all 25 tests, including missing credentials, posting scopes,
cross-group lease recovery, and pending lesson isolation.

See [scheduler operations](scheduler.md) for startup, verification, recovery,
and rotation. BullMQ changes delivery scheduling only; ChatGPT OAuth pairing
and activation of content-writing routines are still pending.

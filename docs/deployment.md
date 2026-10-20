# Production setup

- Worker: https://telegram-russian-teacher.arkadizon.workers.dev
- MCP: https://telegram-russian-teacher.arkadizon.workers.dev/mcp
- Telegram bot: @rus_es_teacher_bot
- Group: Aprendiendo Ruso (`-5255940220`), Europe/Madrid, publishing enabled
- Delivery scheduler: BullMQ + dedicated Redis on `zonbook-ops`, in `~/russian-teacher`
- Cloudflare Cron Triggers: disabled
- Infisical project: `f51da42d-632d-4516-9a98-3fb013479426`, `prod`, `/`
- Registered web MCP connection: https://chatgpt.com/plugins/plugin_asdk_app_6ad68a0fda2c8191bac769c103927f79
- Private teaching plugin (0.1.2): https://chatgpt.com/plugins/plugins_6ad684df906c8191812b07a6caabd2a1

The production D1 schema is applied, all six Cloudflare runtime settings are synchronized
from Infisical, and the Telegram webhook is registered. Live MCP initialization,
tool discovery, reading group configuration, and updating the selected group
were verified with the scoped deployment credential. This did not post a lesson.

The plugin's teaching skill defaults to this selected group. Its saved release
is separate from installation and OAuth account connection. Finish pairing in
ChatGPT using the prepared custom MCP connection form. The exact callback shown
by ChatGPT, `https://chatgpt.com/connector_platform_oauth_redirect`, has been
verified in Infisical and synchronized to Cloudflare. OAuth consent completed on 2026-10-20. ChatGPT shows the connected account,
and D1 confirms an active refresh-token session. The connected MCP tools were
verified from ChatGPT, and the welcome message was confirmed sent to Telegram.
On 2026-10-20, ChatGPT authored and scheduled 33 alphabet lessons and 33 quizzes
through 2026-11-21. See the saved curriculum in `content/alphabet-2026-10-20.json`.

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
is complete, while activation of content-writing routines is still pending.

## OAuth browser form compatibility

The consent document uses `Referrer-Policy: same-origin` so a real browser's
HTML form POST preserves the origin required by CSRF validation. The successful
OAuth redirect still uses `no-referrer`. Missing, null, and foreign origins remain
rejected; neither the callback allowlist nor authentication has been relaxed.
The initial `invalid_origin` error was reproduced with a dummy credential before
this fix. See the browser compatibility notes in
[MDN Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header).

## Shared web MCP connection

The private teaching plugin now references the registered web App
`asdk_app_6ad68a0fda2c8191bac769c103927f79` through `.app.json`. Both its portable
manifest and compatibility manifest point at that file. This reuses the web
OAuth connection in ChatGPT and avoids a second bundled desktop MCP connection.
The teaching skill, default prompts, plugin ID, ownership, and private visibility
are preserved. A saved plugin release does not prove completed OAuth consent.

The former direct remote MCP configuration is kept as
`config/mcp.portable.example.json` for a separate portable distribution, outside
the installed private plugin. Do not add it back to the private package alongside
the registered binding: that would introduce two independent connection paths.

The consent document's CSP `form-action` also allows the exact validated callback
origin and path. Chromium can apply this policy to the redirect following the
POST, so a self-only form policy can accept approval but prevent the return to
ChatGPT. The callback still has to match the configured allowlist exactly;
unrelated origins and callback paths remain disallowed.

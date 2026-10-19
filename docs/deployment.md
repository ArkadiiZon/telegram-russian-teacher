# Production setup

- Worker: https://telegram-russian-teacher.arkadizon.workers.dev
- MCP: https://telegram-russian-teacher.arkadizon.workers.dev/mcp
- Telegram bot: @rus_es_teacher_bot
- Group: Aprendiendo Ruso (`-5255940220`), Europe/Madrid, publishing enabled
- Infisical project: `f51da42d-632d-4516-9a98-3fb013479426`, `prod`, `/`
- Private plugin: https://chatgpt.com/plugins/plugins_6ad684df906c8191812b07a6caabd2a1

The production D1 schema is applied, all six runtime settings are synchronized
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

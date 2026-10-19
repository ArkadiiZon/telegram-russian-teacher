# ChatGPT routines through MCP

First deploy the Worker, register the group, link OAuth, and run one manual lesson. Keep the group ID and teaching instructions in the ChatGPT project. Do not put tokens in project prompts or scheduled-task text.

The backend does not implement a ChatGPT routine or call a model. It delivers saved lessons. Create scheduled tasks from your ChatGPT account with this MCP connection available, then check their actual tool access and write permissions. See [official scheduled task documentation](https://learn.chatgpt.com/docs/automations).

Suggested routine: daily at 09:00 Europe/Madrid, prepare tomorrow's lesson and quiz for 10:00 and 18:00 respectively. Preparing a day ahead gives time to detect a missed run. On the first run, explicitly prepare the next two days.

Example task prompt (replace GROUP_ID with the actual negative ID):

> Cada día, prepara la lección y el quiz de ruso de mañana para mis amigos hispanohablantes. Usa la conexión MCP Russian Teacher y el grupo GROUP_ID. Lee get_group_config, list_lessons, get_lesson cuando necesites recuperar material, y get_progress. Sigue las instrucciones del profesor del proyecto. Redacta el contenido tú mismo: el backend no tiene integración con ninguna API de modelos. Programa la lección a lesson_time y el quiz a quiz_time usando la zona horaria del grupo y el offset correcto para la fecha de mañana. Envía el contenido completo mediante schedule_lesson. Para la lección usa idempotency_key routine:YYYY-MM-DD:lesson; para el quiz usa routine:YYYY-MM-DD:quiz. No dupliques una entrada que ya exista ni actives un grupo pausado. Si la conexión o los permisos fallan, informa del fallo; no afirmes que se ha publicado. Notifica únicamente fallos, acciones que necesiten mi atención o cambios relevantes.

A successful `schedule_lesson` result means the content is stored, not delivered. Confirm `sent` later with `list_lessons`. `post_lesson` expedites a pending item; it still uses the next cron tick. A quiz answer key remains in D1 and is sent to Telegram as quiz metadata, rather than printed in the lesson text.

If scheduled MCP writes are unavailable in your account, ask ChatGPT manually to schedule a week of lessons ahead. Those entries still post automatically from Cloudflare. Supporting another content-generation method is future work.

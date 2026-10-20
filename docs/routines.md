# ChatGPT routines through MCP

## Active alphabet curriculum

On 2026-10-20, the owner requested one Russian letter every day for the next
month. The complete 33-letter alphabet is scheduled from 2026-10-20 through
2026-11-21 inclusive: 33 lessons at 10:00 and 33 matching quizzes at 18:00,
Europe/Madrid. Explicit timestamps account for the 2026-10-25 clock change.
Full Spanish teaching content is saved in
`content/alphabet-2026-10-20.json` and already stored in production through MCP.
All 33 lesson entries also include their public illustrated letter card via
`image_path`. The scheduler sends the photo with the complete lesson caption.
Keys use `routine:YYYY-MM-DD:lesson` and `routine:YYYY-MM-DD:quiz`.

These saved entries are delivered by BullMQ without a daily model call or an
active ChatGPT recurring task. Any future content-writing routine must preserve
the existing curriculum and skip occupied dates. The MCP list tool returns only
the newest 50 entries; use get_lesson for a saved ID or scoped database checks
when verifying the full 66-entry course. Do not infer missing early dates from
that truncated list.

First deploy the Worker and the BullMQ scheduler on the ops box, register the group, link OAuth, and run one manual lesson. Keep the group ID and teaching instructions in the ChatGPT project. Do not put tokens in project prompts or scheduled-task text.

The backend does not implement a ChatGPT routine or call a model. It delivers saved lessons. Create scheduled tasks from your ChatGPT account with this MCP connection available, then check their actual tool access and write permissions. See [official scheduled task documentation](https://learn.chatgpt.com/docs/automations).

Suggested routine: daily at 09:00 Europe/Madrid, prepare tomorrow's lesson and quiz for 10:00 and 18:00 respectively. Preparing a day ahead gives time to detect a missed run. On the first run, explicitly prepare the next two days.

Example task prompt (replace GROUP_ID with the actual negative ID):

> Cada día, prepara la lección y el quiz de ruso de mañana para mis amigos hispanohablantes. Usa la conexión MCP Russian Teacher y el grupo GROUP_ID. Lee get_group_config, list_lessons, get_lesson cuando necesites recuperar material, y get_progress. Sigue las instrucciones del profesor del proyecto. Redacta el contenido tú mismo: el backend no tiene integración con ninguna API de modelos. Programa la lección a lesson_time y el quiz a quiz_time usando la zona horaria del grupo y el offset correcto para la fecha de mañana. Envía el contenido completo mediante schedule_lesson. Para la lección usa idempotency_key routine:YYYY-MM-DD:lesson; para el quiz usa routine:YYYY-MM-DD:quiz. No dupliques una entrada que ya exista ni actives un grupo pausado. Si la conexión o los permisos fallan, informa del fallo; no afirmes que se ha publicado. Notifica únicamente fallos, acciones que necesiten mi atención o cambios relevantes.

A successful `schedule_lesson` result means the content is stored, not delivered. Confirm `sent` later with `list_lessons`. `post_lesson` expedites a pending item; it still uses the next BullMQ delivery tick. A quiz answer key remains in D1 and is sent to Telegram as quiz metadata, rather than printed in the lesson text.

If scheduled MCP writes are unavailable in your account, ask ChatGPT manually to schedule a week of lessons ahead. Those entries still post through BullMQ-triggered Cloudflare delivery while the ops box is running. Supporting another content-generation method is future work.

BullMQ does not create Russian content or invoke ChatGPT. It only triggers delivery of due D1 entries. Group lesson and quiz times guide the teacher; each saved entry has its own publication timestamp. See [scheduler operations](scheduler.md).

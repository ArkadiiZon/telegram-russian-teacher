# Implementation map

```mermaid
flowchart TD
  ChatGPT[ChatGPT: Russian teaching in Spanish] -->|Saved content, read progress| MCP
  Tasks[ChatGPT routine: prepare tomorrow] -. account permissions .-> ChatGPT
  subgraph Worker[Cloudflare Worker: TypeScript + NestJS]
    OAuth[OAuth discovery + consent + PKCE] --> MCP[Streamable HTTP /mcp]
    MCP --> Store[Store service: D1 operations]
    Tick[POST /internal/scheduler/tick: scoped authorization] --> Scheduler[Scheduler service: D1 claim + publish]
    Scheduler --> Store
    Hook[POST /telegram/webhook: verify secret] --> TelegramService[grammY update handler]
    TelegramService --> Store
  end
  subgraph OpsHost[Always-on ops box]
    Bull[BullMQ Node process: minute job] <--> Redis[(Isolated Redis with AOF)]
  end
  Bull -->|HTTPS bearer: one group, lessons:post| Tick
  Store <--> D1[(Cloudflare D1)]
  Scheduler -->|sendMessage / sendPhoto / sendPoll| Telegram[Telegram group]
  Assets[Cloudflare static assets: public teaching PNGs] -->|Telegram fetches the selected card| Telegram
  Cards[Editable SVG card sources + renderer] --> Assets
  Telegram -->|poll_answer / commands| Hook
  Ops[Infisical on Tailscale ops box] -->|Sync selected settings at deployment| Secrets[Cloudflare Worker secrets]
  Secrets --> Worker
  Ops -->|Export only scheduler settings to private ops env| Bull
```

There is no model API in this implementation. Tailscale is used to reach Infisical from the deployment machine, not by the running Worker. MCP account permissions and ChatGPT scheduled-task support are separate from BullMQ delivery. Cloudflare Cron Triggers are disabled. Redis holds recurring trigger jobs, while D1 is the source of truth for authored content, publication times, delivery leases, and results. The Cloudflare Worker never connects to Redis or to the private ops network. See [scheduler operations](scheduler.md).

## Lesson images

Public teaching cards are deployed with Workers Static Assets from `public/`.
The D1 lesson content JSON stores an optional allowlisted `image_path`; no schema
migration or new secrets are needed. The scheduler resolves it against the
configured public base URL and uses one `sendPhoto` call with the full lesson
caption. Captions are validated at 1024 Unicode characters including the title.
Arbitrary external URLs and paths are rejected. Photo sends use the same atomic
claims and uncertain-delivery protection as text lessons. Quizzes remain native
Telegram polls. Group-private data and credentials must never enter public assets.
See [media operations](media.md).

## Database relationships

```mermaid
erDiagram
  groups ||--o{ access_tokens : grants
  groups ||--o{ lessons : schedules
  access_tokens ||--o{ access_tokens : delegates
  access_tokens ||--o{ oauth_codes : authorizes
  access_tokens ||--o{ oauth_refresh_tokens : refreshes
  lessons ||--o{ poll_answers : scores
  groups {
    text id PK
    text timezone
    text lesson_time
    text quiz_time
    text level
    integer enabled
  }
  lessons {
    text id PK
    text group_id FK
    text kind
    text content
    integer publish_at
    text dedupe_key UK
    text status
    text poll_id UK
  }
  access_tokens {
    text token_hash PK
    text group_id FK
    text parent_hash FK
    text scopes
    integer expires_at
  }
  oauth_codes {
    text code_hash PK
    text parent_hash FK
    text challenge
    text resource
    integer expires_at
  }
  oauth_refresh_tokens {
    text token_hash PK
    text parent_hash FK
    text resource
    integer expires_at
  }
  poll_answers {
    text lesson_id PK,FK
    text user_id PK
    integer option_id
    integer correct
  }
  telegram_updates {
    integer update_id PK
    text status
    integer lease_until
  }
```

The lesson deduplication constraint covers `(group_id, dedupe_key)`. Poll-answer primary keys cover `(lesson_id, user_id)`. Telegram replay records are independent of group data and retain only update IDs and processing state.

## Delivery states

```mermaid
stateDiagram-v2
  [*] --> pending: ChatGPT schedules authored content
  pending --> preparing: atomic D1 claim
  preparing --> sending: validate content + group enabled
  preparing --> pending: recover expired lease, bounded retries
  preparing --> failed: preparation failed three times
  sending --> sent: Telegram result stored in D1
  sending --> uncertain: timeout, interruption, or persistence failure
  uncertain --> pending: operator checks Telegram and explicitly retries
  failed --> pending: operator explicitly retries
```

## Scheduling ownership and failures

ChatGPT routines author content and call MCP. BullMQ's stable `delivery-every-minute` Job Scheduler produces delivery ticks using a UTC cron expression. The consumer calls Cloudflare with an expiring token restricted to `lessons:post` and one group. No content, BotFather token, or OAuth signing secret is put in Redis. For additional groups, run a separate Compose project and Redis volume with that group's posting token.

Each successful tick processes at most three due lessons. Group-enabled checks and atomic D1 leases apply to every delivery. BullMQ retries failed tick requests up to three times with exponential backoff; a Telegram send with an unknown outcome remains `uncertain` in D1 and cannot be resent by another tick. Operator review is required before retrying it. Redis AOF preserves recurring jobs across restarts; restarting the runner also upserts the same scheduler ID without adding a second schedule. An ops outage pauses delivery; overdue D1 entries are picked up when ticks resume.

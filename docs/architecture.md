# Implementation map

```mermaid
flowchart TD
  ChatGPT[ChatGPT: Russian teaching in Spanish] -->|Saved content, read progress| MCP
  Tasks[ChatGPT routine: prepare tomorrow] -. account permissions .-> ChatGPT
  subgraph Worker[Cloudflare Worker: TypeScript + NestJS]
    OAuth[OAuth discovery + consent + PKCE] --> MCP[Streamable HTTP /mcp]
    MCP --> Store[Store service: D1 operations]
    Cron[Cloudflare Cron every minute] --> Scheduler[Scheduler service: claim + publish]
    Scheduler --> Store
    Hook[POST /telegram/webhook: verify secret] --> TelegramService[grammY update handler]
    TelegramService --> Store
  end
  Store <--> D1[(Cloudflare D1)]
  Scheduler -->|sendMessage / sendPoll| Telegram[Telegram group]
  Telegram -->|poll_answer / commands| Hook
  Ops[Infisical on Tailscale ops box] -->|Sync selected settings at deployment| Secrets[Cloudflare Worker secrets]
  Secrets --> Worker
```

There is no model API in this implementation. Tailscale is used to reach Infisical from the deployment machine, not by the running Worker. MCP account permissions and ChatGPT scheduled-task support are separate from Cloudflare's delivery cron.

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

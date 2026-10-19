export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  PUBLIC_BASE_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_REDIRECT_URIS: string;
  OAUTH_SIGNING_SECRET: string;
}
export interface Group {
  id: string; title: string; timezone: string; lesson_time: string; quiz_time: string;
  level: 'A1' | 'A2' | 'B1'; enabled: number; created_at: number;
}
export interface Lesson {
  id: string; group_id: string; kind: 'lesson' | 'quiz'; topic: string; publish_at: number;
  dedupe_key: string; content: string; status: string; attempts: number;
  lease_until: number | null; message_id: number | null; poll_id: string | null;
  correct_option: number | null; explanation: string | null; error_code: string | null;
  created_at: number;
}
export const SCOPES = ['config:read', 'config:write', 'lessons:read', 'lessons:write', 'lessons:post', 'progress:read'] as const;
export type Scope = typeof SCOPES[number];
export interface Principal { groupId: string; scopes: Scope[] }
export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

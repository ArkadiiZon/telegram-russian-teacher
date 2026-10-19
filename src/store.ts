import { Injectable } from '@nestjs/common';
import { AppError, type Env, type Group, type Lesson } from './types';
import { configPatch } from './validation';
@Injectable()
export class Store {
  constructor(readonly env: Env) {}
  get db() { return this.env.DB; }
  async group(id: string) {
    const row = await this.db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<Group>();
    if (!row) throw new AppError('group_not_found', 404);
    return row;
  }
  async updateGroup(id: string, input: unknown) {
    const patch = configPatch.parse(input);
    const fields = Object.entries(patch).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value] as const);
    // Column names come exclusively from the strict schema; values are bound.
    await this.db.prepare(`UPDATE groups SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
      .bind(...fields.map(([, value]) => value), id).run();
    return this.group(id);
  }
  async schedule(group: string, kind: 'lesson' | 'quiz', topic: string, publishAt: number, key: string, content: unknown) {
    await this.group(group);
    const id = crypto.randomUUID();
    await this.db.prepare(`INSERT INTO lessons (id, group_id, kind, topic, publish_at, dedupe_key, created_at, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(group_id, dedupe_key) DO NOTHING`)
      .bind(id, group, kind, topic, publishAt, key, Date.now(), JSON.stringify(content)).run();
    const lesson = (await this.db.prepare('SELECT * FROM lessons WHERE group_id = ? AND dedupe_key = ?')
      .bind(group, key).first<Lesson>())!;
    if (lesson.kind !== kind || lesson.topic !== topic || lesson.content !== JSON.stringify(content)) throw new AppError('idempotency_key_conflict', 409);
    return lesson;
  }
  async list(group: string) {
    return (await this.db.prepare(`SELECT id, kind, topic, publish_at, status, attempts, message_id, error_code
      FROM lessons WHERE group_id = ? ORDER BY created_at DESC LIMIT 50`).bind(group).all()).results;
  }
  async lesson(group: string, id: string) {
    const row = await this.db.prepare('SELECT * FROM lessons WHERE id = ? AND group_id = ?').bind(id, group).first<Lesson>();
    if (!row) throw new AppError('lesson_not_found', 404);
    return { ...row, content: JSON.parse(row.content!) };
  }
  async post(group: string, id: string) {
    const lesson = await this.db.prepare('SELECT * FROM lessons WHERE id = ? AND group_id = ?').bind(id, group).first<Lesson>();
    if (!lesson) throw new AppError('lesson_not_found', 404);
    if (lesson.status === 'sent') return { id, status: 'sent' };
    if (lesson.status !== 'pending') throw new AppError('lesson_not_pending', 409);
    await this.db.prepare(`UPDATE lessons SET publish_at = ? WHERE id = ? AND group_id = ? AND status = 'pending'`)
      .bind(Date.now(), id, group).run();
    return { id, status: 'queued', detail: 'Next cron tick; group must be enabled.' };
  }
  async progress(group: string, userId?: string) {
    return this.db.prepare(`SELECT COUNT(*) AS answered, COALESCE(SUM(a.correct), 0) AS correct,
      COUNT(DISTINCT a.user_id) AS learners FROM poll_answers a JOIN lessons l ON l.id = a.lesson_id
      WHERE l.group_id = ? AND a.option_id IS NOT NULL AND (? IS NULL OR a.user_id = ?)`)
      .bind(group, userId ?? null, userId ?? null).first();
  }
}

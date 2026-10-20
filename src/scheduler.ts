import { Injectable } from '@nestjs/common';
import { Api } from 'grammy';
import { AppError, type Env, type Lesson } from './types';
import { Store } from './store';
import { lessonContent, quizContent } from './validation';
@Injectable()
export class Scheduler {
  constructor(private env: Env, private store: Store) {}
  async tick(now: number, groupId: string) {
    const db = this.store.db;
    // Never blindly resend after an interrupted Telegram call: its outcome may be unknown.
    await db.prepare(`UPDATE lessons SET status = 'uncertain', error_code = 'delivery_interrupted'
      WHERE status = 'sending' AND lease_until < ? AND group_id = ?`).bind(now, groupId).run();
    await db.prepare(`UPDATE lessons SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
      error_code = 'preparation_interrupted' WHERE status = 'preparing' AND lease_until < ? AND group_id = ?`).bind(now, groupId).run();
    const due = (await db.prepare(`SELECT l.* FROM lessons l JOIN groups g ON g.id = l.group_id
      WHERE l.status = 'pending' AND l.publish_at <= ? AND g.enabled = 1 AND l.group_id = ? ORDER BY l.publish_at LIMIT 3`)
      .bind(now, groupId).all<Lesson>()).results;
    for (const row of due) await this.deliver(row.id);
    // Minimal retention for replay protection and OAuth one-time codes.
    await db.prepare('DELETE FROM telegram_updates WHERE created_at < ?').bind(now - 7 * 86_400_000).run();
    await db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now).run();
    await db.prepare('DELETE FROM access_tokens WHERE expires_at < ?').bind(now).run();
  }
  async deliver(id: string) {
    const db = this.store.db;
    const now = Date.now();
    const claimed = await db.prepare(`UPDATE lessons SET status = 'preparing', attempts = attempts + 1,
      lease_until = ? WHERE id = ? AND status = 'pending' AND publish_at <= ?
      AND EXISTS (SELECT 1 FROM groups g WHERE g.id = lessons.group_id AND g.enabled = 1) RETURNING *`)
      .bind(now + 120_000, id, now).first<Lesson>();
    if (!claimed) return;
    let sending = false;
    try {
      const group = await this.store.group(claimed.group_id);
      const content = JSON.parse(claimed.content!);
      const parsed = claimed.kind === 'lesson' ? lessonContent.parse(content) : quizContent.parse(content);
      const ready = await db.prepare(`UPDATE lessons SET content = ?, status = 'sending', lease_until = ?
        WHERE id = ? AND status = 'preparing' AND attempts = ? AND lease_until > ?
        AND EXISTS (SELECT 1 FROM groups g WHERE g.id = lessons.group_id AND g.enabled = 1)`)
        .bind(JSON.stringify(parsed), Date.now() + 120_000, id, claimed.attempts, Date.now()).run();
      if (!ready.meta.changes) return;
      sending = true;
      const api = new Api(this.env.TELEGRAM_BOT_TOKEN, { timeoutSeconds: 15 });
      if (claimed.kind === 'lesson') {
        const lesson = lessonContent.parse(parsed);
        const caption = `🇷🇺 ${lesson.title}\n\n${lesson.text}`;
        // One Telegram operation keeps photo + full lesson together and avoids partial two-message delivery.
        const message = lesson.image_path
          ? await api.sendPhoto(group.id, new URL(lesson.image_path, this.env.PUBLIC_BASE_URL).href, { caption })
          : await api.sendMessage(group.id, caption);
        await db.prepare(`UPDATE lessons SET status = 'sent', message_id = ?, lease_until = NULL, error_code = NULL
          WHERE id = ? AND attempts = ?`).bind(message.message_id, id, claimed.attempts).run();
      } else {
        const quiz = quizContent.parse(parsed);
        const message = await api.sendPoll(group.id, quiz.question, quiz.options.map(text => ({ text })), {
          type: 'quiz', is_anonymous: false, correct_option_ids: [quiz.correct_option], explanation: quiz.explanation,
          open_period: 600
        });
        await db.prepare(`UPDATE lessons SET status = 'sent', message_id = ?, poll_id = ?, correct_option = ?,
          explanation = ?, lease_until = NULL, error_code = NULL WHERE id = ? AND attempts = ?`)
          .bind(message.message_id, message.poll!.id, quiz.correct_option, quiz.explanation, id, claimed.attempts).run();
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : (sending ? 'telegram_delivery_unknown' : 'preparation_failed');
      await db.prepare(`UPDATE lessons SET status = ?, error_code = ?, lease_until = NULL, publish_at = ?
        WHERE id = ? AND attempts = ? AND status IN ('preparing','sending')`)
        .bind(sending ? 'uncertain' : claimed.attempts >= 3 ? 'failed' : 'pending', code,
          Date.now() + claimed.attempts * 60_000, id, claimed.attempts).run();
      console.error(JSON.stringify({ event: 'lesson_failed', lesson_id: id, code }));
    }
  }
}

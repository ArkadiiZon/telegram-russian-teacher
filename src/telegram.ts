import { Injectable } from '@nestjs/common';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import { AppError, type Env, type Lesson } from './types';
import { Store } from './store';
@Injectable()
export class Telegram {
  constructor(private env: Env, private store: Store) {}
  async handle(update: Update) {
    const db = this.store.db;
    const now = Date.now();
    const claim = await db.prepare(`INSERT INTO telegram_updates(update_id,status,lease_until,created_at)
      VALUES (?,'processing',?,?) ON CONFLICT(update_id) DO UPDATE SET lease_until = excluded.lease_until
      WHERE telegram_updates.status = 'processing' AND telegram_updates.lease_until < ? RETURNING update_id`)
      .bind(update.update_id, now + 30_000, now, now).first();
    if (!claim) {
      const prior = await db.prepare('SELECT status FROM telegram_updates WHERE update_id = ?').bind(update.update_id).first<{status: string}>();
      if (prior?.status === 'done') return;
      throw new AppError('update_in_progress', 503);
    }
    try {
      const bot = new Bot(this.env.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 10 } });
      bot.command('chatid', async ctx => {
        if (!['group', 'supergroup'].includes(ctx.chat.type) || !ctx.from) return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (member.status === 'administrator' || member.status === 'creator') await ctx.reply(`ID de este grupo: ${ctx.chat.id}`);
      });
      bot.command(['start', 'help'], async ctx => {
        if (!ctx.chat || !await db.prepare('SELECT id FROM groups WHERE id = ?').bind(String(ctx.chat.id)).first()) return;
        await ctx.reply('🇷🇺 ¡Aprendemos ruso! Lecciones y quizzes diarios. /progress muestra tus resultados. Los quizzes no son anónimos: guardamos tu ID de Telegram y respuestas para medir tu progreso. /forget elimina tus respuestas guardadas.');
      });
      bot.command('progress', async ctx => {
        if (!ctx.from || !await db.prepare('SELECT id FROM groups WHERE id = ?').bind(String(ctx.chat.id)).first()) return;
        const progress = await this.store.progress(String(ctx.chat.id), String(ctx.from.id)) as { answered: number; correct: number };
        await ctx.reply(`Tu progreso: ${progress.correct}/${progress.answered} respuestas correctas. ¡Sigue así!`);
      });
      bot.command('forget', async ctx => {
        if (!ctx.from) return;
        await db.prepare(`DELETE FROM poll_answers WHERE user_id = ? AND lesson_id IN (SELECT id FROM lessons WHERE group_id = ?)`)
          .bind(String(ctx.from.id), String(ctx.chat.id)).run();
        await ctx.reply('Tus respuestas guardadas de este grupo se han eliminado.');
      });
      bot.on('poll_answer', async ctx => {
        const answer = ctx.pollAnswer;
        if (!answer.user || answer.user.is_bot) return;
        const lesson = await db.prepare('SELECT * FROM lessons WHERE poll_id = ?').bind(answer.poll_id).first<Lesson>();
        // Telegram may beat the sendPoll -> D1 persistence step; returning 503 makes it retry.
        if (!lesson) throw new AppError('poll_not_recorded_yet', 503);
        const member = await ctx.api.getChatMember(lesson.group_id, answer.user.id);
        if (member.status === 'left' || member.status === 'kicked' || (member.status === 'restricted' && !member.is_member)) return;
        const option = answer.option_ids[0] ?? null;
        await db.prepare(`INSERT INTO poll_answers(lesson_id,user_id,option_id,correct,updated_at) VALUES (?,?,?,?,?)
          ON CONFLICT(lesson_id,user_id) DO UPDATE SET option_id=excluded.option_id,correct=excluded.correct,updated_at=excluded.updated_at
          WHERE excluded.updated_at >= poll_answers.updated_at`)
          .bind(lesson.id, String(answer.user.id), option, Number(option !== null && option === lesson.correct_option), update.update_id).run();
      });
      await bot.init();
      await bot.handleUpdate(update);
      await db.prepare(`UPDATE telegram_updates SET status = 'done' WHERE update_id = ?`).bind(update.update_id).run();
    } catch {
      await db.prepare(`UPDATE telegram_updates SET lease_until = 0 WHERE update_id = ? AND status = 'processing'`).bind(update.update_id).run();
      throw new AppError('telegram_update_failed', 503);
    }
  }
}

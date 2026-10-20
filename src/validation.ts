import { z } from 'zod';
export const groupId = z.string().regex(/^-\d{1,20}$/);
export const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const timezone = z.string().max(80).refine(value => {
  try { new Intl.DateTimeFormat('es', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid IANA timezone');
export const configPatch = z.object({
  timezone: timezone.optional(), lesson_time: localTime.optional(), quiz_time: localTime.optional(),
  level: z.enum(['A1', 'A2', 'B1']).optional(), enabled: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0, 'Empty patch');
export const lessonContent = z.object({
  title: z.string().min(1).max(120), text: z.string().min(1).max(3400),
  // Only our deployed, public teaching cards; arbitrary remote media is not accepted.
  image_path: z.string().regex(/^\/media\/letters\/letter-(?:0[1-9]|[12][0-9]|3[0-3])\.png$/).optional()
}).strict().refine(value => !value.image_path || [...`🇷🇺 ${value.title}\n\n${value.text}`].length <= 1024,
  'Photo lesson caption must fit Telegram’s 1024-character limit');
export const quizContent = z.object({
  question: z.string().min(1).max(240),
  options: z.array(z.string().min(1).max(80)).length(4),
  correct_option: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(190).regex(/^[^\r\n]+$/)
}).strict();
export function localClock(now: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

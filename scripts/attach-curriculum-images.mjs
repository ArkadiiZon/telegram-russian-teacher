import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const course = JSON.parse(await readFile('content/alphabet-2026-10-20.json','utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
// Update the existing course only. No new lessons, changed times, or reposts.
const statements = course.days.map(day => {
  if (!/^\/media\/letters\/letter-(?:0[1-9]|[12][0-9]|3[0-3])\.png$/.test(day.lesson.image_path)) throw new Error('Invalid image path');
  return `UPDATE lessons SET content = json_set(content, '$.image_path', ${quote(day.lesson.image_path)}) WHERE group_id = ${quote(course.group_id)} AND kind = 'lesson' AND dedupe_key = ${quote(`manual:routine:${day.date}:lesson`)} AND status = 'pending';`;
});
await mkdir('.local',{recursive:true});
await writeFile('.local/attach-curriculum-images.sql',statements.join('\n')+'\n',{mode:0o600});
console.log('Prepared scoped updates for 33 pending alphabet lessons. Existing content and times are preserved.');
if (process.argv.includes('--remote')) {
  const result = spawnSync('npx',['wrangler','d1','execute','DB','--remote','--file','.local/attach-curriculum-images.sql'],{stdio:'inherit'});
  process.exitCode = result.status ?? 1;
} else console.log('Review .local/attach-curriculum-images.sql; add --remote to apply.');

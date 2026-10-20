import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const course = JSON.parse(readFileSync('content/alphabet-2026-10-20.json','utf8'));
test('all 33 curriculum cards exist and captions fit Telegram photo limits', () => {
  assert.equal(course.days.length, 33);
  assert.equal(new Set(course.days.map(d => d.letter)).size, 33);
  for (const [i, day] of course.days.entries()) {
    assert.equal(day.lesson.image_path, `/media/letters/letter-${String(i+1).padStart(2,'0')}.png`);
    const png = readFileSync(`public${day.lesson.image_path}`);
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1080); assert.equal(png.readUInt32BE(20), 1080);
    assert.ok([...`🇷🇺 ${day.lesson.title}\n\n${day.lesson.text}`].length <= 1024, day.date);
  }
});

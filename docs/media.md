# Teaching cards and Telegram profile artwork

## Letter cards

The complete course has 33 illustrated PNG cards at
`public/media/letters/letter-01.png` through `letter-33.png`. Each 1080×1080 card
shows the uppercase/lowercase letter, one Russian example, a Spanish translation
and an illustration. Ъ and Ь are explicitly identified as signs without their own
sound. Accent marks in the examples are study aids.

Regenerate with `node scripts/generate-letter-cards.mjs` after `npm ci`.
Editable SVGs are saved to `content/letter-card-sources/`. Rendering uses
`@resvg/resvg-js` and system Arial (or the local sans-serif fallback). Font
differences between machines can change raster output; review cards before
deploying. Lucide artwork is attributed in `public/media/LUCIDE-LICENSE.txt`;
the remaining simple illustrations are original SVG drawings.

`npm run deploy` publishes the PNGs using Workers Static Assets, which serves
matching public files directly. No R2 bucket or new environment secret is needed.
Do not place private files in `public/`.

`node scripts/attach-curriculum-images.mjs` writes reviewable SQL in `.local/`.
Add `--remote` to attach paths to the existing pending alphabet lessons only.
The update is scoped by group, kind and exact course deduplication key; it does
not change publication times, create duplicate entries, or resend sent lessons.
This was applied on 2026-10-20; production verified 33 pending lessons with 33
distinct cards. Native evening quizzes are unchanged.

Telegram photo captions are limited to 1024 characters. The application rejects
oversized photo lessons and arbitrary image URLs. It sends one photo operation
with the full caption and retains the same uncertain-outcome quarantine used for
text deliveries. A failed photo is not silently retried as text.

## Profile images

Generated with the built-in image generation tool, without adding a model API
dependency or API key to the backend:

- `public/media/branding/group-cover.png`: Aprendiendo Ruso group avatar.
- `public/media/branding/bot-cover.png`: Russian teacher bot avatar.

Both are square artworks with centered subjects for circular Telegram cropping.
They are supplied as upload-ready files; generating them does not change the
current Telegram group or bot profile photo.

### Group prompt

Create a polished square Telegram GROUP avatar for 'Aprendiendo Ruso', a small friendly community of Spanish-speaking adults learning Russian from zero. Editorial 3D clay illustration, deep midnight navy background, warm cream open book with two large accurately rendered Cyrillic letter glyphs А and Я on the pages, small coral and turquoise speech bubbles suggesting a friendly exchange. A tiny warm yellow star. Sophisticated playful education identity, strong silhouette legible at small size, no flags, no political symbols, no mascots, no watermark, no additional text. All essential artwork fits within the central 65 percent circle with generous clear margins for Telegram round cropping. Tactile matte materials, soft studio light, clean premium composition, 1024 square.

### Bot prompt

Use case: logo-brand. Create a square Telegram BOT profile avatar, a companion identity to a midnight navy, warm cream, coral, turquoise and yellow clay-rendered Russian-learning group icon. Subject: a friendly compact turquoise robot language teacher with warm cream rounded face screen, two dark expressive eyes, small coral bow tie and a tiny antenna. It holds a small open cream book bearing one large accurately rendered Cyrillic letter Б. Sophisticated tactile matte 3D illustration, inviting to Spanish-speaking adults learning Russian, soft studio lighting, navy background. All important artwork comfortably inside the central 65% circle, lots of clean margin for Telegram circular cropping, strong readable silhouette at tiny size. No extra words, no flags, no political symbols, no watermark. 1024 square.

The source prompt requested 1024-square artwork; the built-in generator determines
the final raster dimensions. Keep the delivered square files as generated.

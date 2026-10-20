import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

// Deterministic teaching artwork: editable SVG sources, deployable PNGs, no model API.
const coursePath = new URL('../content/alphabet-2026-10-20.json', import.meta.url);
const course = JSON.parse(await readFile(coursePath, 'utf8'));
const examples = [
  ['арбу́з','sandía','watermelon'], ['бана́н','plátano','banana'],
  ['вода́','agua','droplet'], ['глаз','ojo','eye'], ['дом','casa','house'],
  ['ель','abeto','tree-pine'], ['ёлка','árbol de Navidad','tree-pine'],
  ['жук','escarabajo','bug'], ['зонт','paraguas','umbrella'],
  ['игла́','aguja','needle'], ['йо́гурт','yogur','yogurt'],
  ['кот','gato','cat'], ['лимо́н','limón','citrus'], ['мост','puente','bridge'],
  ['нос','nariz','nose'], ['окно́','ventana','window'], ['парк','parque','trees'],
  ['ры́ба','pez / pescado','fish'], ['со́лнце','sol','sun'], ['торт','tarta','cake'],
  ['у́тка','pato','duck'], ['фо́то','foto','camera'], ['хлеб','pan','bread'],
  ['цвето́к','flor','flower-2'], ['чай','té','tea'], ['шар','bola / globo','volleyball'],
  ['щётка','cepillo','brush'], ['подъе́зд','entrada del edificio','door-open'],
  ['сыр','queso','cheese'], ['соль','sal','salt'], ['э́хо','eco','volume-2'],
  ['ю́бка','falda','skirt'], ['я́блоко','manzana','apple']
];
const custom = {
  watermelon: '<path d="M2 8h20a10 10 0 0 1-20 0Z"/><path d="M4 8a8 8 0 0 0 16 0M8 11v1m4 1v1m4-3v1"/>',
  needle: '<path d="m18 2-2 8L3 22 14 8Z"/><path d="m16 5 1-1"/>',
  yogurt: '<path d="M5 7h14l-2 15H7ZM4 7h16M8 3h8M11 3V1"/><path d="M9 12h6v5H9Z"/>',
  nose: '<path d="M13 2c-1 7-2 9-5 12-3 3 0 5 3 4 1 4 6 4 7 0M6 18c-2 0-3-1-3-3"/>',
  window: '<rect x="3" y="2" width="18" height="20" rx="1"/><path d="M12 2v20M3 12h18M1 22h22"/>',
  duck: '<path d="M8 12a5 5 0 1 1 9-4l5 2-5 2c0 7-4 10-9 10-4 0-6-3-6-7l6-3Z"/><circle cx="14" cy="6" r=".6"/><path d="M6 16c1 3 5 3 7 0"/>',
  bread: '<path d="M4 11C-2 5 6 1 9 4c2-3 8-3 9 0 6 0 7 5 2 7v10H4Z"/><path d="M8 11v5m4-6v6m4-5v5"/>',
  tea: '<path d="M3 8h14v7a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5ZM17 9h2a3 3 0 0 1 0 6h-2M1 23h21M7 2v3m5-3v3"/>',
  cheese: '<path d="m2 9 13-7 7 7v12H2ZM2 9h20"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="17" r="2"/>',
  salt: '<path d="M8 7h8l3 15H5ZM8 7V3h8v4M9 3V1h6v2"/><path d="M10 13h4m-3 3h2"/>',
  skirt: '<path d="M8 2h8l6 20H2ZM8 5h8M9 8l-2 11m8-11 2 11M12 8v11"/>'
};
const escape = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const pngDir = new URL('../public/media/letters/', import.meta.url);
const svgDir = new URL('../content/letter-card-sources/', import.meta.url);
await mkdir(pngDir, { recursive: true }); await mkdir(svgDir, { recursive: true });
for (const [i, day] of course.days.entries()) {
  const [word, translation, icon] = examples[i];
  const inner = custom[icon] ?? (await readFile(new URL(`../node_modules/lucide-static/icons/${icon}.svg`, import.meta.url),'utf8')).replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>[\s\S]*$/,'');
  const number = String(i+1).padStart(2,'0');
  const note = [27,29].includes(i) ? 'SIGNO SIN SONIDO PROPIO' : 'UNA LETRA CADA DÍA';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
<rect width="1080" height="1080" fill="#111f32"/>
<circle cx="1030" cy="0" r="300" fill="#1b3545"/>
<text x="74" y="98" fill="#83d9ce" font-family="Arial" font-size="24" font-weight="700" letter-spacing="3">APRENDIENDO RUSO</text>
<text x="1000" y="98" text-anchor="end" fill="#f5d68a" font-family="Arial" font-size="25">${number} / 33</text>
<text x="70" y="173" fill="#c2cbd5" font-family="Arial" font-size="20" letter-spacing="3">${note}</text>
<text x="64" y="480" fill="#fff5e6" font-family="Arial" font-size="300" font-weight="700">${escape(day.letter)}</text>
<circle cx="830" cy="355" r="143" fill="#f6cb79"/>
<g transform="translate(737 262) scale(7.7)" fill="none" stroke="#19384a" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${inner}</g>
<rect x="70" y="560" width="940" height="305" rx="32" fill="#fff5e6"/>
<text x="112" y="624" fill="#576477" font-family="Arial" font-size="20" letter-spacing="2">PALABRA DE HOY</text>
<text x="112" y="724" fill="#172b41" font-family="Arial" font-size="${word.length>9?66:84}" font-weight="700">${escape(word)}</text>
<text x="112" y="806" fill="#a14834" font-family="Arial" font-size="40">${escape(translation)}</text>
<text x="74" y="934" fill="#d5dfeb" font-family="Arial" font-size="26">Mira · Pronuncia · Escribe</text>
<text x="74" y="995" fill="#83d9ce" font-family="Arial" font-size="22">La tilde marca el acento para estudiar.</text>
</svg>`;
  await writeFile(new URL(`letter-${number}.svg`,svgDir),svg);
  await writeFile(new URL(`letter-${number}.png`,pngDir),new Resvg(svg,{font:{loadSystemFonts:true,defaultFontFamily:'Arial'}}).render().asPng());
  day.lesson.image_path = `/media/letters/letter-${number}.png`;
  day.image_example = { word, translation };
}
await writeFile(coursePath, JSON.stringify(course,null,2)+'\n');
console.log(`Generated ${course.days.length} letter cards and updated curriculum image paths.`);

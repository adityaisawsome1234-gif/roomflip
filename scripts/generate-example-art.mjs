// Draws the landing page's placeholder before/after illustrations into public/examples/.
// They are flat illustrations, not renders: replace them with real before/after pairs made
// with /dev/compare once a fal key is set, and set `illustration: false` in
// src/lib/config/examples.ts.
//
//   node scripts/generate-example-art.mjs
import sharp from 'sharp'

const W = 1200
const H = 900

function room({ wall, floor, trim, sofa, cushion, rug, art, plant, lamp, curtain, accentWall }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="light" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="620" fill="${wall}"/>
  ${accentWall ? `<rect x="0" width="420" height="620" fill="${accentWall}"/>` : ''}
  <rect width="${W}" height="620" fill="url(#shade)"/>
  <rect y="600" width="${W}" height="20" fill="${trim}"/>
  <polygon points="0,620 ${W},620 ${W},${H} 0,${H}" fill="${floor}"/>
  <polygon points="0,620 ${W},620 ${W},${H} 0,${H}" fill="url(#shade)"/>
  <!-- window -->
  <rect x="760" y="110" width="300" height="360" fill="#dcebf5"/>
  <rect x="760" y="110" width="300" height="360" fill="url(#light)"/>
  <rect x="752" y="102" width="316" height="376" fill="none" stroke="${trim}" stroke-width="16"/>
  <line x1="910" y1="110" x2="910" y2="470" stroke="${trim}" stroke-width="10"/>
  ${curtain ? `<rect x="712" y="90" width="46" height="430" rx="8" fill="${curtain}"/><rect x="1062" y="90" width="46" height="430" rx="8" fill="${curtain}"/>` : ''}
  <polygon points="760,470 1060,470 1180,${H} 640,${H}" fill="#ffffff" opacity="0.10"/>
  <!-- art -->
  <rect x="250" y="190" width="200" height="150" fill="${art}" stroke="${trim}" stroke-width="10"/>
  <!-- rug -->
  <ellipse cx="500" cy="770" rx="380" ry="70" fill="${rug}"/>
  <!-- sofa -->
  <rect x="180" y="470" width="520" height="150" rx="34" fill="${sofa}"/>
  <rect x="150" y="440" width="70" height="200" rx="30" fill="${sofa}"/>
  <rect x="660" y="440" width="70" height="200" rx="30" fill="${sofa}"/>
  <rect x="210" y="420" width="460" height="90" rx="30" fill="${sofa}"/>
  <rect x="230" y="440" width="120" height="90" rx="22" fill="${cushion}"/>
  <rect x="530" y="440" width="120" height="90" rx="22" fill="${cushion}"/>
  <rect x="200" y="620" width="16" height="40" fill="#3b3632"/><rect x="664" y="620" width="16" height="40" fill="#3b3632"/>
  <!-- lamp -->
  <line x1="1110" y1="300" x2="1110" y2="700" stroke="#2b2724" stroke-width="8"/>
  <path d="M1060 300 h100 l-20 -80 h-60 z" fill="${lamp}"/>
  <!-- plant -->
  <rect x="60" y="560" width="70" height="90" rx="8" fill="#c8b8a2"/>
  <ellipse cx="95" cy="520" rx="55" ry="70" fill="${plant}"/>
  <ellipse cx="60" cy="480" rx="30" ry="50" fill="${plant}" opacity="0.85"/>
</svg>`
}

const BASE = {
  wall: '#d9d4cb',
  floor: '#a9845c',
  trim: '#f2efe8',
  sofa: '#6f7b86',
  cushion: '#9aa6b0',
  rug: '#b9ada0',
  art: '#c7c2b8',
  plant: '#7d8f6a',
  lamp: '#e8e2d6',
}

const SCENES = {
  'hero-before': BASE,
  'hero-after': {
    ...BASE,
    wall: '#ece6dc',
    floor: '#c9a77c',
    sofa: '#d8cbb6',
    cushion: '#b59a7a',
    rug: '#e7dfd2',
    art: '#3b3632',
    plant: '#5f7454',
    lamp: '#f4efe6',
    curtain: '#efe9df',
  },
  'style-before': {
    ...BASE,
    wall: '#d1d4d6',
    sofa: '#4f5964',
    cushion: '#c45b4a',
    rug: '#8a8f95',
    art: '#e0c27a',
  },
  'style-after': {
    ...BASE,
    wall: '#f3f1ec',
    floor: '#d8c3a5',
    sofa: '#e9e4da',
    cushion: '#9aa89a',
    rug: '#d9cbb4',
    art: '#9aa89a',
    plant: '#6f8a5f',
    lamp: '#ffffff',
    curtain: '#ffffff',
  },
  'paint-before': { ...BASE, wall: '#e6e1d6' },
  'paint-after': {
    ...BASE,
    wall: '#e6e1d6',
    accentWall: '#434B56' /* Benjamin Moore Hale Navy HC-154 */,
    art: '#d9cfbf',
  },
  'material-before': { ...BASE, sofa: '#7b8288', cushion: '#a3a9ae' },
  'material-after': { ...BASE, sofa: '#2f6f73', cushion: '#c8a15a', rug: '#d7b98e' },
}

for (const [name, scene] of Object.entries(SCENES)) {
  await sharp(Buffer.from(room(scene)))
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(`public/examples/${name}.jpg`)
  console.log(`public/examples/${name}.jpg`)
}

// Social sharing image (1200x630): before and after side by side.
const half = await Promise.all(
  ['hero-before', 'hero-after'].map((name) =>
    sharp(`public/examples/${name}.jpg`).resize(596, 630, { fit: 'cover' }).toBuffer(),
  ),
)
await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ffffff' } })
  .composite([
    { input: half[0], left: 0, top: 0 },
    { input: half[1], left: 604, top: 0 },
  ])
  .jpeg({ quality: 86 })
  .toFile('src/app/opengraph-image.jpg')
console.log('src/app/opengraph-image.jpg')

/**
 * Renders the brand mark to every icon file the app ships.
 *
 *   node scripts/generate-icons.mjs
 *
 * Run it again whenever the mark or the brand colors change, commit the output,
 * and bump CACHE_VERSION in public/sw.js so installed apps pick up the new icons.
 *
 * Output:
 *   public/icons/icon-192.png            manifest icon, purpose "any"
 *   public/icons/icon-512.png            manifest icon, purpose "any"
 *   public/icons/icon-maskable-512.png   manifest icon, purpose "maskable"
 *   src/app/apple-icon.png               iOS home screen icon (180x180, opaque)
 *   src/app/icon.svg                     browser tab icon
 *   src/app/favicon.ico                  browser tab icon for clients that only ask for /favicon.ico
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/*
 * BRAND COLORS. Icon files cannot read CSS variables, so these are copies of the
 * light-theme tokens in src/app/globals.css. If --ink, --accent or --bg change
 * there, change them here and run this script again.
 */
const BRAND_COLORS = {
  ink: '#1c1917', // --ink: the "before" half of the mark
  accent: '#d9481f', // --accent: the "after" half of the mark
  paper: '#faf8f5', // --bg: the divider, and the background behind the maskable icon
}

/** The mark is drawn in a 32x32 box, the same box LogoMark uses. */
const MARK_BOX = 32

/**
 * Share of the canvas the mark takes up in the maskable icon. Android may crop
 * a maskable icon to a circle 80% of its width; at 60% the mark's rounded
 * corners stay inside that circle with room to spare.
 */
const MASKABLE_MARK_SCALE = 0.6

const FAVICON_SIZES = [16, 32, 48]

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The mark's shapes in the 32x32 box. Same geometry as LogoMark in
 * src/components/ui/logo.tsx: a rounded square split on a diagonal, ink on one
 * side, accent on the other, a thin light divider. Keep the two in step.
 *
 * `rounded` clips to the rounded square. Without it the split fills the whole
 * box, for platforms that round the corners themselves.
 */
function markShapes({ rounded }) {
  const { ink, accent, paper } = BRAND_COLORS
  const corner = rounded ? ' rx="9"' : ''
  return [
    `<clipPath id="mark"><rect width="${MARK_BOX}" height="${MARK_BOX}"${corner}/></clipPath>`,
    '<g clip-path="url(#mark)">',
    `<rect width="${MARK_BOX}" height="${MARK_BOX}" fill="${ink}"/>`,
    `<path d="M20 0h12v32H9Z" fill="${accent}"/>`,
    `<path d="M20 0 9 32" stroke="${paper}" stroke-width="2" stroke-linecap="round"/>`,
    '</g>',
  ].join('')
}

/** A square SVG document. `size` is the pixel size it rasterizes to; leave it out for a scalable file. */
function svgDocument(body, size) {
  const dimensions = size ? ` width="${size}" height="${size}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">${body}</svg>`
}

/** The mark edge to edge on a transparent background. */
function markSvg(size) {
  return svgDocument(markShapes({ rounded: true }), size)
}

/** The mark inside the maskable safe zone, on solid paper. */
function maskableSvg(size) {
  const inset = (MARK_BOX * (1 - MASKABLE_MARK_SCALE)) / 2
  return svgDocument(
    `<rect width="${MARK_BOX}" height="${MARK_BOX}" fill="${BRAND_COLORS.paper}"/>` +
      `<g transform="translate(${inset} ${inset}) scale(${MASKABLE_MARK_SCALE})">${markShapes({ rounded: true })}</g>`,
    size,
  )
}

/** The split filling the whole square: iOS rounds the corners, which gives the mark its shape back. */
function fullBleedSvg(size) {
  return svgDocument(markShapes({ rounded: false }), size)
}

function toPng(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 })
}

/** PNG with the alpha channel removed. iOS paints transparent pixels black, so the Apple icon must be opaque. */
function toOpaquePng(svg) {
  return sharp(Buffer.from(svg))
    .flatten({ background: BRAND_COLORS.paper })
    .removeAlpha()
    .png({ compressionLevel: 9 })
}

/** Pack PNG images into an .ico container (every current browser reads PNG-encoded entries). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let dataOffset = header.length + directory.length
  images.forEach(({ size, png }, index) => {
    const entry = index * 16
    directory.writeUInt8(size, entry) // width
    directory.writeUInt8(size, entry + 1) // height
    directory.writeUInt8(0, entry + 2) // palette size: none
    directory.writeUInt8(0, entry + 3) // reserved
    directory.writeUInt16LE(1, entry + 4) // color planes
    directory.writeUInt16LE(32, entry + 6) // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(dataOffset, entry + 12)
    dataOffset += png.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.png)])
}

async function write(relativePath, data) {
  const file = path.join(root, relativePath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, data)
  console.log(`wrote ${relativePath} (${data.length} bytes)`)
}

await write('public/icons/icon-192.png', await toPng(markSvg(192)).toBuffer())
await write('public/icons/icon-512.png', await toPng(markSvg(512)).toBuffer())
await write('public/icons/icon-maskable-512.png', await toOpaquePng(maskableSvg(512)).toBuffer())
await write('src/app/apple-icon.png', await toOpaquePng(fullBleedSvg(180)).toBuffer())
await write('src/app/icon.svg', `${markSvg()}\n`)
await write(
  'src/app/favicon.ico',
  buildIco(
    await Promise.all(
      FAVICON_SIZES.map(async (size) => ({ size, png: await toPng(markSvg(size)).toBuffer() })),
    ),
  ),
)

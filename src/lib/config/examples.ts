/**
 * The before/after pairs on the landing page.
 *
 * These start as flat illustrations (scripts/generate-example-art.mjs), and the
 * page labels them as such. To show real results: make before/after pairs of
 * real rooms with /dev/compare, save them over these files (same names, 4:3),
 * update the captions, and set `illustration` to false.
 */
export interface ExamplePair {
  before: string
  after: string
  width: number
  height: number
}

export const EXAMPLES = {
  illustration: true,
  hero: {
    before: '/examples/hero-before.jpg',
    after: '/examples/hero-after.jpg',
    width: 1200,
    height: 900,
    caption: 'Living room, restyled Japandi',
  },
  items: [
    {
      id: 'style',
      title: 'A whole new style',
      caption: 'Living room → Scandinavian',
      before: '/examples/style-before.jpg',
      after: '/examples/style-after.jpg',
      width: 1200,
      height: 900,
    },
    {
      id: 'paint',
      title: 'A real paint colour',
      caption: 'Accent wall in Benjamin Moore Hale Navy, HC-154',
      before: '/examples/paint-before.jpg',
      after: '/examples/paint-after.jpg',
      width: 1200,
      height: 900,
    },
    {
      id: 'material',
      title: 'Your own fabric or tile',
      caption: 'Sofa re-covered in a teal velvet sample',
      before: '/examples/material-before.jpg',
      after: '/examples/material-after.jpg',
      width: 1200,
      height: 900,
    },
  ],
} as const

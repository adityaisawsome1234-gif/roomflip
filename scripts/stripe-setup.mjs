// Creates RoomFlip's products and prices in Stripe and prints the env lines to copy.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//
// Safe to run more than once: prices are found again by their lookup keys.
// Refuses a live key unless you pass --live, so you set up test mode first.
// Prices here must match src/lib/config/pricing.ts.
import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('Set STRIPE_SECRET_KEY first.')
  process.exit(1)
}
if (key.startsWith('sk_live_') && !process.argv.includes('--live')) {
  console.error('That is a live key. Run with --live if you really mean to create live prices.')
  process.exit(1)
}

const stripe = new Stripe(key)

const ITEMS = [
  {
    env: 'STRIPE_PRICE_PRO_WEEKLY',
    lookup: 'roomflip_pro_weekly',
    product: 'RoomFlip Pro',
    cents: 699,
    recurring: { interval: 'week' },
  },
  {
    env: 'STRIPE_PRICE_PRO_ANNUAL',
    lookup: 'roomflip_pro_annual',
    product: 'RoomFlip Pro',
    cents: 5999,
    recurring: { interval: 'year' },
  },
  {
    env: 'STRIPE_PRICE_PACK_20',
    lookup: 'roomflip_pack_20',
    product: 'RoomFlip 20 renders',
    cents: 499,
  },
  {
    env: 'STRIPE_PRICE_PACK_60',
    lookup: 'roomflip_pack_60',
    product: 'RoomFlip 60 renders',
    cents: 999,
  },
]

const products = new Map()
async function productId(name) {
  if (products.has(name)) return products.get(name)
  const found = await stripe.products.search({ query: `name:'${name}' AND active:'true'` })
  const product = found.data[0] ?? (await stripe.products.create({ name }))
  products.set(name, product.id)
  return product.id
}

const lines = []
for (const item of ITEMS) {
  const existing = await stripe.prices.list({ lookup_keys: [item.lookup], active: true, limit: 1 })
  let price = existing.data[0]
  if (price && price.unit_amount !== item.cents) {
    console.error(
      `${item.lookup} exists at ${price.unit_amount} cents, expected ${item.cents}. Fix it in the dashboard.`,
    )
    process.exit(1)
  }
  price ??= await stripe.prices.create({
    product: await productId(item.product),
    currency: 'usd',
    unit_amount: item.cents,
    lookup_key: item.lookup,
    ...(item.recurring ? { recurring: item.recurring } : {}),
  })
  lines.push(`${item.env}=${price.id}`)
}

console.log('\nAdd these to .env.local and to Vercel:\n')
console.log(lines.join('\n'))

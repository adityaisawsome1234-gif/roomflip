# RoomFlip

Mobile-first web app (PWA): snap or upload a photo of a room and get back a photorealistic restyle
of the same room, then export it as a shareable before/after reel.

"RoomFlip" is a placeholder name. To rename, change `SITE.name` in `src/lib/config/site.ts` and the
text in `supabase/templates/sign_in.html`.

## Build status

| #   | Milestone                                                     | Status      |
| --- | ------------------------------------------------------------- | ----------- |
| 1   | Scaffold, schema, auth, PWA shell, paint catalog              | Done        |
| 2   | Credits ledger                                                | Done        |
| 3   | Upload pipeline, model providers, prompt builder, async jobs  | Done        |
| 4   | Restyle UI (presets, paint, swatch), results slider, My Rooms | Done        |
| 5   | Export Reel and square before/after image                     | Done        |
| 6   | Stripe checkout, portal, webhooks, paywall                    | Done        |
| 7   | Analytics, admin page, rate limits                            | Not started |
| 8   | Landing page, deployment                                      | Not started |

## Stack

- Next.js 16 (App Router, TypeScript, Cache Components) and Tailwind CSS 4, deployed on Vercel
- Supabase: auth (emailed link or 6-digit code, Google), Postgres with row level security, Storage
- fal.ai for image editing, behind a provider interface (milestone 3)
- Stripe for subscriptions and credit packs (milestone 6)
- Vitest for unit and database tests, Playwright for end-to-end tests

## Local setup

You need Node.js 22 or newer and Docker (the local Supabase stack runs in containers).

```bash
npm install
```

```bash
npx supabase start
```

The first start downloads the Supabase images and prints the local URLs and keys. Then create your
env file and copy the two keys into it:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the `PUBLISHABLE_KEY` value
- `SUPABASE_SECRET_KEY`: the `SECRET_KEY` value

`npx supabase status` prints them again at any time. Everything else in `.env.example` belongs to
later milestones and can stay blank for now.

```bash
npm run dev
```

Open http://localhost:3000. Sign-in emails are not really sent in local development: read them in
the test mailbox at http://127.0.0.1:54324.

### Google sign-in

Email sign-in works out of the box. Google needs an OAuth client, which is free to create:

1. In Google Cloud Console, create an OAuth client ID (type "Web application") with the redirect
   URI `http://127.0.0.1:54321/auth/v1/callback` for local use.
2. Put the id and secret in `supabase/.env.local` as `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.
3. In `supabase/config.jsonc`, set `auth.external.google.enabled` to `true`, then restart the stack
   (`npx supabase stop`, `npx supabase start`).
4. Set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in `.env.local` to show the button.

## Commands

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Start the app on http://localhost:3000                                |
| `npm run build`     | Production build                                                      |
| `npm run typecheck` | Generate route types and run the TypeScript compiler                  |
| `npm run lint`      | ESLint                                                                |
| `npm run format`    | Prettier                                                              |
| `npm test`          | Unit tests (no services needed)                                       |
| `npm run test:db`   | Database security tests (needs `npx supabase start`)                  |
| `npm run test:e2e`  | Playwright end-to-end tests (needs Supabase; starts the dev server)   |
| `npm run db:reset`  | Rebuild the local database from the migrations                        |
| `npm run db:types`  | Regenerate `src/lib/supabase/database.types.ts` after a schema change |

The service worker only registers in production builds. To test it, run `npm run build`, then
`npm run start -- -p 3100`, then:

```bash
E2E_PROD=1 E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/pwa.spec.ts
```

## Where things live

```
src/app/                 Routes (App Router)
  login/                 Sign-in screen
  auth/confirm/          Landing page for the emailed sign-in link
  auth/callback/         OAuth return URL
  app/                   The signed-in app: Create, My rooms, Account
  manifest.ts            Web app manifest
src/proxy.ts             Refreshes the session; guards /app, /admin, /dev
src/lib/config/          Prices, plans, credits, entitlements, site constants
src/lib/auth/            Session helpers, safe redirects, auth server actions
src/lib/supabase/        Browser, server and service-role clients; generated types
src/components/          UI primitives, app shell, PWA registration
supabase/migrations/     Database schema (source of truth)
supabase/data/           Paint catalog source data
supabase/templates/      Sign-in email
tests/unit/              Unit tests
tests/db/                Database security tests (RLS, grants, constraints)
e2e/                     Playwright tests
```

## Configuration

Every price, credit amount and plan limit is in `src/lib/config/pricing.ts`: signup credits, what a
preview and an HD final cost, the weekly and annual plans, the credit packs, and what free and paid
users are entitled to (watermark, HD final, image size, reel size). Nothing else hard-codes these
numbers.

`.env.example` lists every environment variable, grouped by the service it belongs to. A unit test
fails if the code reads a server variable that the file does not document.

## Render pipeline

```
browser ── POST /api/rooms ──► shrink in browser, then on the server: re-encode,
                               strip metadata, moderate, store privately
        ── POST /api/renders ─► validate, build prompt, take 1 credit (same
                               transaction as the job row), submit to the model
        ── GET /api/renders/:id (poll) ─┐
fal ───── POST /api/webhooks/fal ───────┴► finish: store the result and a
                                          watermarked copy, or retry once,
                                          or fail and refund
cron ──── GET /api/cron/sweep ──────────► refund jobs past their deadline
```

- **Models** are config, not code: `src/lib/config/models.ts` lists each model with its endpoint,
  price per render and how it takes an output size. `TIER_MODEL_DEFAULTS` picks the preview and HD
  models; `RENDER_MODEL_PREVIEW` and `RENDER_MODEL_HD` override them per environment. Every provider
  implements `ImageEditProvider` (`src/lib/render/providers/`).
- **Prompts** come from `src/lib/render/prompt.ts`. Every prompt carries the same fixed block that
  keeps the room's walls, windows, doors, layout and camera unchanged.
- **Failure handling:** an infrastructure error is retried once; a refusal or bad input is not.
  Anything that ends in failure, including a timeout, refunds the credit exactly once. A result
  that arrives after the timeout is discarded.
- **Mock model:** without `FAL_KEY`, local development renders with a free mock that tints the
  photo. Typing `mock:fail`, `mock:flaky` or `mock:hang` into a free-text style makes it fail,
  fail once then succeed, or never finish, which is how the tests exercise refunds and retries.
- **Compare models:** `/dev/compare` sends one photo to several models side by side and shows each
  one's cost per render. It is open to anyone signed in during local development and only to
  `ADMIN_EMAILS` in production.

### Using the real models

Add both keys to `.env.local` and restart `npm run dev`:

- `FAL_KEY` from fal.ai (Dashboard, then Keys). Each preview costs about $0.027, each HD final about
  $0.07, at the prices recorded in `src/lib/config/models.ts`.
- `OPENAI_API_KEY` from platform.openai.com, used only for the free moderation endpoint.

fal cannot call a webhook on `localhost`, so local renders finish by polling. On a deployed site
the webhook does the work and polling is the fallback.

The sweeper runs daily because that is the most Vercel's free plan allows. On Vercel Pro, change
the schedule in `vercel.json` to `*/5 * * * *`. Expired jobs are also refunded whenever anyone
starts a render or checks on one, so the daily run is only a backstop.

## Exports

From a finished look, the result screen offers two shareable files, made on the server
(`src/lib/export/`) and stored in the private `exports` bucket:

- **Video reel:** 9:16 MP4, 7.8 seconds, H.264 with a silent AAC track. The before photo, a wipe
  to the after photo, then an end card reading "Made with RoomFlip". The headline names the room,
  the new look and the real time the render took ("My living room → Japandi, in 14 seconds"); the
  time is left out when it took a minute or more. Free users get 720×1280 with a small mark;
  paid users get 1080×1920 without it. Text stays clear of the areas TikTok and Reels cover with
  their own controls.
- **Square image:** before above after, 1024px with a small mark for free users, 1080px clean for
  paid users.

Each file is made once per render and plan type, then reused. On phones the Share button opens
the system share sheet with the file attached, so it goes straight into TikTok, Instagram or
Messages; elsewhere it downloads. There is no third-party branding in either file.

Frames are composed with `sharp` using the bundled Geist font, and joined by the `ffmpeg` binary
from the `ffmpeg-static` package. That binary is GPL-licensed; it runs only on our server and is
never distributed to users. `next.config.ts` includes it in the export route's bundle only, so
the other functions stay small. Set `FFMPEG_PATH` to use a different ffmpeg.

## Payments (Stripe)

What can be bought is set in `src/lib/config/pricing.ts`: Pro Weekly ($6.99, 50 renders per paid
week), Pro Annual ($59.99, 100 renders a month, no rollover), and packs of 20 ($4.99) and 60
($9.99). Checkout and the customer portal are hosted by Stripe; the app never sees card details.

**How credits arrive.** Only webhooks grant credits, never the browser returning from checkout:

| Stripe event                                                             | What happens                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | Pack credits, once per checkout session                                    |
| `invoice.paid`                                                           | Weekly: 50 credits, replacing any left over. Annual: the first month's 100 |
| `customer.subscription.created`, `.updated`, `.deleted`                  | Plan status; when a plan ends its remaining plan credits end too           |

Annual plans get each later month's 100 credits the next time the user's balance is read, or from
the daily cron, whichever comes first. Every grant has an idempotency key made from Stripe ids, so
repeated or out-of-order deliveries are harmless. Purchased and free credits never expire.

**The paywall** opens right after a free user's last free render finishes, over the result, so
the before/after stays visible behind it. It also opens when someone tries to render with
nothing left, or asks for HD on the free plan.

### Setting up Stripe

1. In the Stripe dashboard, in test mode, copy the secret key into `STRIPE_SECRET_KEY`.
2. Create the products and prices:

   ```bash
   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
   ```

   It prints the four `STRIPE_PRICE_*` lines to add to `.env.local` and Vercel.

3. Add a webhook endpoint at `https://<your domain>/api/webhooks/stripe` with the six events in
   the table above, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Locally, use
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, which prints a secret too.
4. In Settings, Billing, Customer portal: allow cancelling, updating payment methods and
   switching between the weekly and annual prices.
5. Repeat in live mode when you launch (`node scripts/stripe-setup.mjs --live` with the live key).

### Testing without Stripe

The tests use [stripe-mock](https://github.com/stripe/stripe-mock) for API calls and sign webhook
events locally:

```bash
docker run -d -p 12111:12111 stripe/stripe-mock
```

Then set `STRIPE_API_BASE=http://localhost:12111`, a placeholder `STRIPE_SECRET_KEY` such as
`sk_test_123`, any `STRIPE_WEBHOOK_SECRET`, and placeholder `STRIPE_PRICE_*` ids in `.env.local`.
`STRIPE_API_BASE` is ignored in production builds.

## Credits

Credits are never stored as a balance. Every change is one row in `credit_ledger` (signup grant,
plan grant, pack purchase, render debit, refund, expiry), and a balance is always the sum of a
user's rows. The rules live in Postgres functions in
`supabase/migrations/20261126000100_credits_ledger.sql`, and app code reaches them only through
`src/lib/credits/ledger.ts`.

- **Starting a render** creates the job and takes its credits in one transaction, under a per-user
  lock, so parallel requests cannot spend the same credit twice. A double tap is charged once.
- **A failed or timed-out render** is refunded exactly once, to the bucket the credit came from. A
  result that arrives after the timeout is discarded rather than delivered free.
- **Buckets:** plan credits are spent first (they expire), then free, then purchased. Plan credits
  do not roll over: the remainder is written off when the next grant arrives or the plan ends.
- **Every grant is idempotent:** a replayed Stripe event cannot grant twice.
- The ledger is append-only. Browsers cannot read it or call its functions, and even the service
  role can only read it directly.

`tests/db/credits.test.ts` covers all of this, including a test that holds one spend open in a
transaction and proves the next one waits and is refused.

## Security model

- Row level security is enabled on every table.
- Browser clients can read only what the migrations grant explicitly. Tables holding internal fields
  (prompts, provider ids, costs, storage paths) grant column by column.
- All writes to rooms and renders happen on the server with the service-role key.
- Storage buckets are private. The server issues short-lived signed URLs after checking who is
  asking and what they are entitled to.
- `tests/db` proves these rules and includes catalog-level guard rails that fail when a future
  migration opens something up by accident.

## Paint catalog

`supabase/data/paint_colors.json` holds 210 popular Benjamin Moore and Sherwin-Williams colors
(brand, name, code, hex, family). Each hex value was read from the manufacturer's own color data and
confirmed by a second independent lookup. Hex values are on-screen approximations of real paint.
RoomFlip is not affiliated with either brand.

To change the catalog, edit the JSON and generate a new migration:

```bash
node scripts/build-paint-migration.mjs 20270101000000_paint_colors_update.sql
```

## Deployment

Deployment to Vercel with a hosted Supabase project is set up in milestone 8, and this section will
carry the full steps. In outline: create a Supabase project and push the migrations
(`npx supabase link`, `npx supabase db push`), set the sign-in email template and redirect URLs in
the Supabase dashboard, create the Vercel project from this repository, and add the variables from
`.env.example`.

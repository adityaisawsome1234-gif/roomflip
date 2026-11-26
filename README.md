# RoomFlip

Mobile-first web app (PWA): snap or upload a photo of a room and get back a photorealistic restyle
of the same room, then export it as a shareable before/after reel.

"RoomFlip" is a placeholder name. To rename, change `SITE.name` in `src/lib/config/site.ts` and the
text in `supabase/templates/sign_in.html`.

## Build status

| #   | Milestone                                                     | Status      |
| --- | ------------------------------------------------------------- | ----------- |
| 1   | Scaffold, schema, auth, PWA shell, paint catalog              | Done        |
| 2   | Credits ledger                                                | Not started |
| 3   | Upload pipeline, model providers, prompt builder, async jobs  | Not started |
| 4   | Restyle UI (presets, paint, swatch), results slider, My Rooms | Not started |
| 5   | Export Reel and square before/after image                     | Not started |
| 6   | Stripe checkout, portal, webhooks, paywall                    | Not started |
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

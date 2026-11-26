import { expect, test, type Locator, type Page } from '@playwright/test'
import { deleteEmails, waitForSignInEmail, type SignInEmail } from './helpers/mailbox'
import { signInAs } from './helpers/session'
import { adminClient, uniqueEmail } from './helpers/supabase'

/**
 * Sign-in, sign-out and the account screen, end to end against the local
 * Supabase stack. Every test uses its own address, so tests can run in
 * parallel and never read each other's mail.
 */

const WRONG_CODE_MESSAGE = "That code didn't work. Check it and try again, or send a new one."
const URL_ERRORS = {
  link_expired:
    'That sign-in link has expired or was already used. Enter your email to get a new one.',
  link_invalid: "That sign-in link didn't work. Enter your email to get a new one.",
  oauth_failed: "Google sign-in didn't finish. Try again, or use your email instead.",
}

// Addresses handed out in the current test, removed again in afterEach.
const issued: string[] = []

function newEmail(prefix = 'auth'): string {
  const email = uniqueEmail(prefix)
  issued.push(email)
  return email
}

async function profileIds(email: string): Promise<string[]> {
  const { data, error } = await adminClient().from('profiles').select('id').eq('email', email)
  if (error) throw new Error(`Could not read profiles for ${email}: ${error.message}`)
  return data.map((row) => row.id as string)
}

test.afterEach(async () => {
  for (const email of issued.splice(0)) {
    for (const id of await profileIds(email)) {
      const { error } = await adminClient().auth.admin.deleteUser(id)
      if (error) throw new Error(`Could not delete test user ${email}: ${error.message}`)
    }
    await deleteEmails(email)
  }
})

// --- Page helpers -----------------------------------------------------------

const emailField = (page: Page) => page.getByLabel('Email', { exact: true })
const codeField = (page: Page) => page.getByLabel('6-digit code')
/** Alerts inside the page itself (Next.js keeps its own route announcer outside <main>). */
const alerts = (page: Page) => page.getByRole('main').getByRole('alert')

/** Fill in the email step of whatever login page is open and wait for the email to arrive. */
async function submitEmail(page: Page, email: string, after?: SignInEmail): Promise<SignInEmail> {
  await emailField(page).fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible()
  return waitForSignInEmail(email, { after })
}

async function requestSignInEmail(page: Page, email: string, path = '/login') {
  await page.goto(path)
  return submitEmail(page, email)
}

async function expectPath(page: Page, pathname: string) {
  await page.waitForURL((url) => url.pathname === pathname, { timeout: 20_000 })
}

/**
 * Record each time the page sends something to the server from /login (every
 * form submit there is one POST), starting from the moment this is called.
 */
function recordSubmits(page: Page): string[] {
  const submits: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/login') {
      submits.push(request.url())
    }
  })
  return submits
}

/** A code that is certainly not the one in the email. */
function wrongCodeFor(code: string): string {
  return code === '000000' ? '111111' : '000000'
}

// --- 1. Emailed link ----------------------------------------------------------

test('the emailed link signs the person in and lands on /app', async ({ page, baseURL }) => {
  const email = newEmail()
  const mail = await requestSignInEmail(page, email)

  // One email carries both ways in: the link and the code.
  expect(mail.subject).toMatch(/sign-in/i)
  expect(mail.code).toMatch(/^\d{6}$/)
  const link = new URL(mail.link)
  expect(link.origin).toBe(new URL(baseURL!).origin)
  expect(link.pathname).toBe('/auth/confirm')
  expect(link.searchParams.get('type')).toBe('email')
  expect(link.searchParams.get('token_hash')).toBeTruthy()

  await page.goto(mail.link)
  await expectPath(page, '/app')

  // /app is behind sign-in, so staying on it means there is a session. Check who it is.
  await page.goto('/app/account')
  await expect(page.getByText(email)).toBeVisible()
})

test('a link that was already used sends the person back with an explanation', async ({
  page,
  browser,
}) => {
  const email = newEmail()
  const mail = await requestSignInEmail(page, email)
  await page.goto(mail.link)
  await expectPath(page, '/app')

  // Same link again, from a browser that is not signed in.
  const context = await browser.newContext()
  try {
    const other = await context.newPage()
    await other.goto(mail.link)
    await other.waitForURL((url) => url.pathname === '/login')
    expect(new URL(other.url()).searchParams.get('error')).toBe('link_expired')
    await expect(alerts(other)).toHaveText(URL_ERRORS.link_expired)
    await expect(emailField(other)).toBeVisible()
  } finally {
    await context.close()
  }
})

// --- 2. Six-digit code ----------------------------------------------------------

test('the 6-digit code signs the person in and returns them to "next"', async ({ page }) => {
  const email = newEmail()
  const mail = await requestSignInEmail(page, email, '/login?next=/app/account')

  await expect(page.getByRole('main')).toContainText(
    `We sent a link and a 6-digit code to ${email}`,
  )
  await expect(codeField(page)).toBeFocused()
  await expect(codeField(page)).toHaveAttribute('inputmode', 'numeric')
  await expect(codeField(page)).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(codeField(page)).toHaveAttribute('maxlength', '6')

  // Type the digits and press enter straight after, the way a keyboard user would.
  // The sixth digit already submits, so the code must not be sent for checking twice.
  const checks = recordSubmits(page)
  await codeField(page).pressSequentially(mail.code)
  await page.keyboard.press('Enter')

  await expectPath(page, '/app/account')
  expect(checks).toHaveLength(1)
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)
  await expect(page).toHaveTitle(/^Account/)
})

test('a code pasted with a space in it is accepted', async ({ page }) => {
  const email = newEmail()
  const mail = await requestSignInEmail(page, email)

  const pasted = `${mail.code.slice(0, 3)} ${mail.code.slice(3)}`
  await codeField(page).evaluate((field, text) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    field.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }),
    )
  }, pasted)

  await expectPath(page, '/app')
})

// --- 3. Wrong code ----------------------------------------------------------------

test('a wrong code shows an error, keeps the email, and the right code still works', async ({
  page,
}) => {
  const email = newEmail()
  const mail = await requestSignInEmail(page, email, '/login?next=/app/account')

  // Enter straight after the sixth digit must not send the same code twice.
  const checks = recordSubmits(page)
  await codeField(page).pressSequentially(wrongCodeFor(mail.code))
  await page.keyboard.press('Enter')
  await expect(alerts(page)).toHaveText(WRONG_CODE_MESSAGE)
  await page.waitForLoadState('networkidle')
  expect(checks).toHaveLength(1)

  // Still on the code step, for the same address.
  await expect(page).toHaveURL(/\/login\?next=/)
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(email)
  await expect(page.locator('input[type="hidden"][name="email"]')).toHaveValue(email)
  await expect(codeField(page)).toBeEditable()
  await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true')

  await codeField(page).fill(mail.code)
  await expectPath(page, '/app/account')
  await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)
})

// --- 4. Protected page round trip -----------------------------------------------------

test('a signed-out visit to /app/account goes to login and comes back after sign-in', async ({
  page,
  baseURL,
}) => {
  await page.goto('/app/account')
  await expect(page).toHaveURL(`${baseURL}/login?next=%2Fapp%2Faccount`)

  // Through the emailed link this time: the destination has to survive the trip to the inbox.
  const email = newEmail()
  const mail = await submitEmail(page, email)
  await page.goto(mail.link)

  await expectPath(page, '/app/account')
  await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)
})

// --- 5. Sign out -------------------------------------------------------------------------

test('sign out returns to /login and /app/account is protected again', async ({
  page,
  baseURL,
}) => {
  const email = newEmail()
  await signInAs(page, email)

  await page.goto('/app/account')
  await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(`${baseURL}/login`)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

  await page.goto('/app/account')
  await expect(page).toHaveURL(`${baseURL}/login?next=%2Fapp%2Faccount`)
})

// --- 6. Untrusted "next" -----------------------------------------------------------------

test.describe('an off-site "next" never leaves the site', () => {
  const unsafe = ['https://evil.example', '//evil.example']

  for (const next of unsafe) {
    test(`code sign-in with next=${next}`, async ({ page, baseURL }) => {
      const offSite: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).hostname.endsWith('evil.example')) offSite.push(request.url())
      })

      const email = newEmail()
      const mail = await requestSignInEmail(page, email, `/login?next=${next}`)
      await expect(page.locator('input[type="hidden"][name="next"]')).toHaveValue('/app')

      await codeField(page).fill(mail.code)
      await expectPath(page, '/app')
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin)
      expect(offSite).toEqual([])
    })

    test(`link sign-in with next=${next}`, async ({ page, baseURL }) => {
      const offSite: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).hostname.endsWith('evil.example')) offSite.push(request.url())
      })

      const email = newEmail()
      const mail = await requestSignInEmail(page, email, `/login?next=${encodeURIComponent(next)}`)
      await page.goto(mail.link)

      await expectPath(page, '/app')
      expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin)
      expect(offSite).toEqual([])
    })
  }
})

// --- 7. Errors that arrive in the URL -----------------------------------------------------

test.describe('errors in the URL', () => {
  for (const [code, message] of Object.entries(URL_ERRORS)) {
    test(`?error=${code} explains what happened`, async ({ page }) => {
      await page.goto(`/login?error=${code}`)
      await expect(alerts(page)).toHaveText(message)
      // The way forward is still there.
      await expect(emailField(page)).toBeVisible()
    })
  }

  test('an unknown ?error= value shows nothing', async ({ page }) => {
    await page.goto('/login?error=made_up_value')
    await expect(emailField(page)).toBeVisible()
    await expect(alerts(page)).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText('made_up_value')
  })

  test('no ?error= shows nothing', async ({ page }) => {
    await page.goto('/login')
    await expect(emailField(page)).toBeVisible()
    await expect(alerts(page)).toHaveCount(0)
  })
})

// --- 8. Returning user -------------------------------------------------------------------

test('a returning person signs in the same way and keeps a single profile', async ({ page }) => {
  const email = newEmail()

  const first = await requestSignInEmail(page, email, '/login?next=/app/account')
  const firstScreen = await page.getByRole('main').locator('p[aria-live]').first().innerText()
  await codeField(page).fill(first.code)
  await expectPath(page, '/app/account')
  const [profileId, ...extra] = await profileIds(email)
  expect(profileId).toBeTruthy()
  expect(extra).toEqual([])

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expectPath(page, '/login')

  // Second time round: same screen, same wording, a fresh email.
  // Supabase refuses a second email to one address within auth.email.max_frequency
  // (1s locally, from supabase/config.jsonc), and this test can get here faster than that.
  await page.waitForTimeout(1_500)
  await page.goto('/login?next=/app/account')
  const second = await submitEmail(page, email, first)
  expect(second.id).not.toBe(first.id)
  expect(second.subject).toBe(first.subject)
  expect(await page.getByRole('main').locator('p[aria-live]').first().innerText()).toBe(firstScreen)

  await codeField(page).fill(second.code)
  await expectPath(page, '/app/account')
  await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)

  // Still one profile, and it is the same one.
  expect(await profileIds(email)).toEqual([profileId])
})

// --- 9. Phone layout -----------------------------------------------------------------------

test.describe('phone layout', () => {
  const MIN_TOUCH_TARGET = 44

  async function expectNoSidewaysScroll(page: Page) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth, 'the page is wider than the screen').toBeLessThanOrEqual(clientWidth)
  }

  async function expectTallEnough(page: Page, controls: Locator[]) {
    for (const control of controls) {
      const box = await control.boundingBox()
      expect(box, `${control} is not on screen`).not.toBeNull()
      expect(box!.height, `${control} is too short to tap`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
      expect(box!.x, `${control} starts off screen`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${control} runs off screen`).toBeLessThanOrEqual(
        page.viewportSize()!.width,
      )
    }
  }

  for (const width of [390, 320]) {
    test(`/login fits a ${width}px screen with tappable controls`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      // A long address is the likeliest thing to push the layout sideways.
      const email = newEmail(`auth-${'long'.repeat(8)}`)

      await page.goto('/login?error=link_expired')
      await expect(alerts(page)).toBeVisible()
      await expectNoSidewaysScroll(page)
      await expectTallEnough(page, [
        emailField(page),
        page.getByRole('button', { name: 'Email me a sign-in link' }),
      ])
      // 16px text keeps iOS Safari from zooming in when the field is focused.
      expect(
        await emailField(page).evaluate((field) => parseFloat(getComputedStyle(field).fontSize)),
      ).toBeGreaterThanOrEqual(16)

      await submitEmail(page, email)
      await expectNoSidewaysScroll(page)
      await expectTallEnough(page, [
        codeField(page),
        page.getByRole('button', { name: 'Sign in', exact: true }),
        page.getByRole('button', { name: /^Send a new code/ }),
        page.getByRole('button', { name: 'Use a different email' }),
      ])
      expect(
        await codeField(page).evaluate((field) => parseFloat(getComputedStyle(field).fontSize)),
      ).toBeGreaterThanOrEqual(16)
    })
  }

  test('/app/account fits a 390px screen with a tappable sign-out button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const email = newEmail()
    await signInAs(page, email)
    await page.goto('/app/account')
    await expect(page.getByRole('main')).toContainText(`Signed in as ${email}`)
    await expectNoSidewaysScroll(page)
    await expectTallEnough(page, [page.getByRole('button', { name: 'Sign out' })])
  })
})

// --- Beyond the list: the rest of the code step ---------------------------------------------

test('"Use a different email" goes back with the address ready to edit', async ({ page }) => {
  const email = newEmail()
  await requestSignInEmail(page, email)

  await page.getByRole('button', { name: 'Use a different email' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(emailField(page)).toHaveValue(email)
  await expect(emailField(page)).toBeFocused()
  await expect(codeField(page)).toHaveCount(0)
})

test('"Send a new code" waits 30 seconds, then sends a code that replaces the old one', async ({
  page,
}) => {
  // The page's clock is under test control so the 30 seconds do not have to pass for real.
  await page.clock.install()
  const email = newEmail()
  const first = await requestSignInEmail(page, email)

  const resend = page.getByRole('button', { name: /^Send a new code/ })
  await expect(resend).toBeDisabled()
  await expect(resend).toHaveText(/^Send a new code in \d+s$/)

  await page.clock.fastForward(20_000)
  await expect(resend).toBeDisabled()

  // The auth server also refuses a second email within a second of the first; that is real time.
  await expect
    .poll(() => Date.now() - first.receivedAt.getTime(), { timeout: 10_000 })
    .toBeGreaterThan(1_500)

  await page.clock.fastForward(11_000)
  await expect(resend).toBeEnabled()
  await expect(resend).toHaveText('Send a new code')
  await resend.click()

  const second = await waitForSignInEmail(email, { after: first })
  await expect(page.getByRole('main')).toContainText('We sent a new code')
  await expect(resend).toBeDisabled()
  await expect(codeField(page)).toBeFocused()

  // The first code is dead (unless the server happened to issue the same six digits again).
  if (second.code !== first.code) {
    await codeField(page).fill(first.code)
    await expect(alerts(page)).toHaveText(WRONG_CODE_MESSAGE)
  }
  await codeField(page).fill(second.code)
  await expectPath(page, '/app')
})

test('"Continue with Google" appears only when Google sign-in is switched on', async ({ page }) => {
  await page.goto('/login')
  await expect(emailField(page)).toBeVisible()
  const google = page.getByRole('button', { name: 'Continue with Google' })
  if (process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true') {
    await expect(google).toBeVisible()
  } else {
    await expect(google).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText('Google')
  }
})

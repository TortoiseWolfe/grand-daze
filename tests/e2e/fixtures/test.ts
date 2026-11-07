/**
 * The `test` every E2E spec imports, instead of the one from `@playwright/test` (#28).
 *
 * ## What it changes
 *
 * Before a spec leaves a page with `page.goto()` or `page.reload()`, the old page is given
 * a moment to finish its own loads. That is all. Nothing else about `test` differs.
 *
 * ## Why
 *
 * WebKit, in Playwright's Linux build, cancels every request the old page still has in
 * flight (route prefetches, chunks) when a navigation replaces it. It then sometimes
 * fails to load the NEXT page's own files: `page.goto: WebKit encountered an internal
 * error`, or a `<main>` that stays empty until a 20 s wait gives up. Neither is a bug in
 * the app. Each one turned a required check flaky, and a retry only hid it.
 *
 * Measured over 720 checkout loads per way of moving between pages (branch
 * `diag/pricing-links-webkit`): moving on straight away failed 11 times, waiting for the
 * network to go quiet first failed 0 times. Swapping the file server only cut the
 * failures about threefold (6 against 18 over 1,080 loads each), so it cannot reach zero.
 * This removes the cause, in one place, instead of in each spec.
 *
 * ## What it is not
 *
 * - Not a retry, and not a longer timeout. The wait is best effort and capped at
 *   `SETTLE_LIMIT_MS`; if the page never goes quiet the navigation simply goes ahead, as
 *   it did before. A page that really is broken still fails on the navigation itself.
 * - Not applied to pages that mount Cloudflare Turnstile (#506). Turnstile opens a
 *   request that never finishes, so those pages never go quiet and would burn the whole
 *   limit on every navigation away from them.
 * - Not a cure for navigations the PAGE starts (a link click, a redirect). It wraps the
 *   two calls a spec makes itself.
 *
 * ## How it is wired
 *
 * The `browser` fixture is wrapped once per worker so that every context made from it,
 * whether Playwright's own `context` and `page` fixtures or a spec's own
 * `browser.newContext()`, patches each page it opens. A spec gets this by importing
 * `test` from here; `scripts/__tests__/e2e-specs-use-the-shared-test.test.js` fails the
 * required `Test (20.x)` check when one imports `test` from `@playwright/test` directly.
 *
 * @module tests/e2e/fixtures/test
 */
import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { waitForLoadStateOrGiveUp } from '../utils/settle';

/** Longest a page is given to go quiet before the next navigation goes ahead. */
export const SETTLE_LIMIT_MS = 5_000;

/**
 * Paths that mount Turnstile, where the network never goes quiet (#506). Re-derive from
 * `tests/unit/no-networkidle-on-captcha-routes.test.ts`, which names the same four.
 */
const NEVER_QUIET_PATHS = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/messages/setup',
];

/** True when the page's current URL is one where waiting for quiet would burn the limit. */
function neverGoesQuiet(url: string): boolean {
  if (!/^https?:/.test(url)) return true; // about:blank has nothing in flight
  // Compared as a path SUFFIX, so a basePath build (`/GrandDaze/sign-in`) is covered too.
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  return NEVER_QUIET_PATHS.some((p) => pathname.endsWith(p));
}

const PATCHED = Symbol.for('grand-daze.e2e.settleBeforeNavigating');

type Patchable = Page & { [PATCHED]?: true };

/** Make `page.goto` and `page.reload` wait for the page being left to go quiet first. */
function patchPage(page: Page): void {
  const p = page as Patchable;
  if (p[PATCHED]) return;
  p[PATCHED] = true;

  const originalGoto = page.goto.bind(page);
  const originalReload = page.reload.bind(page);

  const settle = async () => {
    if (page.isClosed() || neverGoesQuiet(page.url())) return;
    await waitForLoadStateOrGiveUp(page, 'networkidle', SETTLE_LIMIT_MS);
  };

  page.goto = async (...args: Parameters<Page['goto']>) => {
    await settle();
    return originalGoto(...args);
  };
  page.reload = async (...args: Parameters<Page['reload']>) => {
    await settle();
    return originalReload(...args);
  };
}

function patchContext(context: BrowserContext): void {
  context.pages().forEach(patchPage);
  context.on('page', patchPage);
}

const CONTEXTS_PATCHED = Symbol.for(
  'grand-daze.e2e.settleBeforeNavigating.ctx'
);

/** Wrap `newContext` and `newPage` once, so every context made from `browser` is patched. */
function patchBrowser(browser: Browser): void {
  const b = browser as Browser & { [CONTEXTS_PATCHED]?: true };
  if (b[CONTEXTS_PATCHED]) return;
  b[CONTEXTS_PATCHED] = true;

  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<Browser['newContext']>) => {
    const context = await originalNewContext(...args);
    patchContext(context);
    return context;
  };

  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser['newPage']>) => {
    const page = await originalNewPage(...args);
    patchPage(page);
    patchContext(page.context());
    return page;
  };
}

export const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ browser }, use) => {
      patchBrowser(browser);
      await use(browser);
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';

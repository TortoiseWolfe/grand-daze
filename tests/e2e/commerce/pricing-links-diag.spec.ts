import { test, type Page } from '@playwright/test';

/**
 * TEMPORARY DIAGNOSTIC (issue 28). Deleted before the fix PR.
 * Round 1 showed the stall is WebKit failing to load the new page's own files
 * ("WebKit encountered an internal error") right after the previous page's loads
 * were cancelled. This round compares three ways of moving between checkout pages
 * and counts how often each one ends with an empty or never-ready page.
 */
const ROUNDS = 60;
const MODES = ['baseline', 'settle', 'freshPage'] as const;

for (const mode of MODES) {
  test(`diag: ${mode}`, async ({ page: first, context }) => {
    test.setTimeout(1_500_000);
    const log = (o: Record<string, unknown>) =>
      console.log('DIAG ' + JSON.stringify({ mode, ...o }));

    await first.goto('/pricing');
    await first.waitForLoadState('networkidle');
    const skus = [
      ...new Set(
        await first
          .locator('a[href*="/checkout"][href*="sku="]')
          .evaluateAll((els) =>
            els.map((el) => {
              const m = (el.getAttribute('href') ?? '').match(
                /[?&]sku=([^&]+)/
              );
              return m ? decodeURIComponent(m[1]) : '';
            })
          )
      ),
    ].filter(Boolean);

    let page: Page = first;
    let navs = 0;
    let events = 0;

    for (let round = 0; round < ROUNDS; round++) {
      for (const sku of skus) {
        if (mode === 'freshPage') {
          const next = await context.newPage();
          if (page !== first) await page.close();
          page = next;
        }
        navs++;
        const t0 = Date.now();
        let what = '';
        try {
          await page.goto(`/checkout/?sku=${encodeURIComponent(sku)}`);
          await page
            .locator('main')
            .filter({ hasText: /Order summary|That package is not available/i })
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 });
          if (mode === 'settle') {
            await page.waitForLoadState('networkidle');
          }
        } catch (e) {
          what = String(e).split('\n')[0].slice(0, 140);
        }
        if (what) {
          events++;
          log({ EVENT: true, round, sku, ms: Date.now() - t0, what });
          // Recover so the loop keeps counting.
          if (mode !== 'freshPage') {
            await page.goto('about:blank').catch(() => {});
          }
        }
      }
    }
    log({ TALLY: true, navs, events });
  });
}

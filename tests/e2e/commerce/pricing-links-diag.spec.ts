import { test } from '@playwright/test';

/**
 * TEMPORARY DIAGNOSTIC (issue: pricing-links stalls on WebKit). Deleted before the fix PR.
 * Repeats the exact navigation pattern of pricing-links.spec.ts:39 many times and records,
 * per SKU, where the time goes, so a stall shows WHICH stage hung.
 */
const ROUNDS = Number(process.env.DIAG_ROUNDS ?? 40);

test('diag: checkout navigation timing', async ({ page }) => {
  test.setTimeout(1_200_000);
  const log = (o: Record<string, unknown>) =>
    console.log('DIAG ' + JSON.stringify(o));

  const pending = new Map<string, number>();
  const failed: string[] = [];
  const consoleErrs: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/') || r.url().includes('/auth/v1/'))
      pending.set(r.url(), Date.now());
  });
  page.on('requestfinished', (r) => pending.delete(r.url()));
  page.on('requestfailed', (r) => {
    pending.delete(r.url());
    failed.push(`${r.url().slice(-80)} ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      consoleErrs.push(m.text().slice(0, 200));
  });

  await page.goto('/pricing');
  await page.waitForLoadState('networkidle');
  const skus = [
    ...new Set(
      await page
        .locator('a[href*="/checkout"][href*="sku="]')
        .evaluateAll((els) =>
          els.map((el) => {
            const m = (el.getAttribute('href') ?? '').match(/[?&]sku=([^&]+)/);
            return m ? decodeURIComponent(m[1]) : '';
          })
        )
    ),
  ].filter(Boolean);
  log({ skus });

  for (let round = 0; round < ROUNDS; round++) {
    for (const sku of skus) {
      pending.clear();
      failed.length = 0;
      consoleErrs.length = 0;
      const t0 = Date.now();
      await page.goto(`/checkout/?sku=${encodeURIComponent(sku)}`);
      const tNav = Date.now() - t0;
      let tSummary: number | string = 'none';
      try {
        await page
          .locator('main')
          .filter({ hasText: /Order summary|That package is not available/i })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        tSummary = Date.now() - t0;
      } catch {
        tSummary = 'TIMEOUT20s';
      }
      const t1 = Date.now();
      let inner: string;
      try {
        inner = await Promise.race([
          page
            .locator('main')
            .innerText({ timeout: 10_000 })
            .then((s) => `ok len=${s.length}`),
          new Promise<string>((r) =>
            setTimeout(() => r('INNERTEXT>10s'), 10_500)
          ),
        ]);
      } catch (e) {
        inner = 'ERR ' + String(e).slice(0, 120);
      }
      const tInner = Date.now() - t1;
      const slow =
        tSummary === 'TIMEOUT20s' ||
        (tSummary as number) > 6000 ||
        tInner > 2000;
      if (slow) {
        const locks = await Promise.race([
          page.evaluate(async () => {
            const q = await navigator.locks.query();
            return JSON.stringify({
              held: q.held?.map((l) => l.name),
              pending: q.pending?.map((l) => l.name),
            });
          }),
          new Promise<string>((r) =>
            setTimeout(() => r('locks.query>3s (page unresponsive)'), 3000)
          ),
        ]).catch((e) => 'locks ERR ' + String(e).slice(0, 80));
        log({
          SLOW: true,
          round,
          sku,
          tNav,
          tSummary,
          inner,
          tInner,
          locks,
          pending: [...pending.entries()].map(
            ([u, t]) => `${u.slice(-70)} age=${Date.now() - t}`
          ),
          failed,
          consoleErrs: consoleErrs.slice(0, 6),
        });
      } else {
        log({ round, sku, tNav, tSummary, tInner });
      }
    }
  }
});

import { expect } from '@playwright/test';
import { test } from './fixtures/test';

// DIAGNOSTIC PROBE (throwaway branch, never merged). Same steps as the skip-link test in
// landmarks.spec.ts, with a timeline of what the page did, printed only when the test fails.
test('probe-skiplink: skip link focus timeline', async ({ page }) => {
  const consoleLines: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /hydrat|react error/i.test(m.text()))
      consoleLines.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e).slice(0, 200)}`));

  await page.addInitScript(() => {
    type W = Window & { __log: string[] };
    const w = window as unknown as W;
    w.__log = [];
    const log = (m: string) => w.__log.push(`${Math.round(performance.now())}ms ${m}`);
    const name = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return 'null';
      return el.id || (el.hasAttribute?.('data-skip-link') ? 'skiplink' : el.tagName);
    };
    document.addEventListener('focusin', (e) => log(`focusin ${name(e.target)}`), true);
    document.addEventListener('focusout', (e) => log(`focusout ${name(e.target)}`), true);
    document.addEventListener('DOMContentLoaded', () => {
      log('DOMContentLoaded');
      let skip = document.querySelector('a[data-skip-link]');
      let main = document.getElementById('main-content');
      new MutationObserver(() => {
        const s2 = document.querySelector('a[data-skip-link]');
        const m2 = document.getElementById('main-content');
        if (s2 !== skip) { log('SKIP LINK node replaced'); skip = s2; }
        if (m2 !== main) { log('#main-content node replaced'); main = m2; }
      }).observe(document.documentElement, { childList: true, subtree: true });
      const poll = () => {
        const m = document.getElementById('main-content');
        if (m && Object.keys(m).some((k) => k.startsWith('__reactFiber'))) {
          log('hydrated (#main-content has __reactFiber)');
        } else requestAnimationFrame(poll);
      };
      poll();
    });
  });

  await page.goto('/docs', { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Tab');
  const focused = page.locator('a[data-skip-link]');
  await expect(focused).toBeFocused();
  await expect(focused).toBeVisible();
  await page.keyboard.press('Enter');
  const movedTo = await page.evaluate(() => document.activeElement?.id ?? '');
  const snapshot = await page.evaluate(() => ({
    active: document.activeElement?.tagName,
    log: (window as unknown as { __log: string[] }).__log.slice(),
  }));
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(() => ({
    active: document.activeElement?.id || document.activeElement?.tagName,
    log: (window as unknown as { __log: string[] }).__log.slice(),
  }));
  if (movedTo !== 'main-content') {
    console.log(
      `[probe-skiplink FAIL] id-right-after-Enter='${movedTo}' tag=${snapshot.active} settled-after-1.5s=${settled.active}\n  ` +
        settled.log.join('\n  ') +
        (consoleLines.length ? '\n  ' + consoleLines.join('\n  ') : '')
    );
  }
  expect(movedTo).toBe('main-content');
});

/**
 * DIAGNOSTIC ONLY, never merge.
 *
 * Question: does a service worker end up registered or controlling the page
 * in a WebKit run, even though playwright.config.ts sets serviceWorkers: 'block'?
 * It prints one SWPROBE line per run and fails when any worker is registered.
 */
import { test, expect } from '../fixtures/test';

test.describe('SW probe', () => {
  test('no service worker is registered or controlling the page', async ({
    page,
    browserName,
  }) => {
    await page.goto('/');
    await page.waitForTimeout(4000);
    await page.reload();
    await page.waitForTimeout(2000);
    const state = await page.evaluate(async () => {
      const supported = 'serviceWorker' in navigator;
      const regs = supported
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      return {
        supported,
        registrations: regs.length,
        scopes: regs.map((r) => r.scope),
        controlled: supported ? !!navigator.serviceWorker.controller : false,
      };
    });
    console.log(`SWPROBE ${browserName} ${JSON.stringify(state)}`);
    expect(state.registrations).toBe(0);
    expect(state.controlled).toBe(false);
  });
});

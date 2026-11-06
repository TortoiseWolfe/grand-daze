import type { BrowserContext } from '@playwright/test';

/**
 * Must match `DISMISS_KEY` in `src/components/atomic/CountdownBanner/CountdownBanner.tsx`.
 */
export const COUNTDOWN_DISMISS_KEY = 'countdown-dismissed';

/**
 * Keep the seasonal "Promotional countdown" banner off every page of a fresh context.
 *
 * The banner shows from Oct 31 to Dec 31 and is `fixed top-40 right-4 z-50`, so on a
 * narrow page it sits over buttons and intercepts their clicks. Messaging's isolated
 * contexts start with empty storage, so from Oct 31 every Edit and Delete click in
 * `message-editing.spec.ts` timed out on "<div> from <aside aria-label='Promotional
 * countdown'> intercepts pointer events". It passed on 28 Aug only because the banner
 * was out of season (#11).
 *
 * `dismissCookieBanner` cannot be the cure: it looks once, 500ms after load, and
 * Playwright's `isVisible` ignores a timeout, so a banner that mounts a moment later is
 * missed. Seeding the dismissal before any page script runs is what a visitor who had
 * already closed it looks like, and it leaves the banner's own behaviour untouched.
 */
export async function suppressSeasonalBanner(
  context: BrowserContext
): Promise<void> {
  await context.addInitScript((key: string) => {
    try {
      localStorage.setItem(key, Date.now().toString());
    } catch {
      // Storage unavailable: the banner shows, as it would for a visitor.
    }
  }, COUNTDOWN_DISMISS_KEY);
}

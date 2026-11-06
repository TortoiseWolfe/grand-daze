import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';
import {
  COUNTDOWN_DISMISS_KEY,
  suppressSeasonalBanner,
} from '../e2e/utils/seasonal-banner';

/**
 * The seasonal banner covers buttons from Oct 31, so the isolated messaging contexts
 * start with it already dismissed (#11). These tests pin that the seeded entry is one
 * the banner itself would honour.
 */
describe('suppressSeasonalBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeContext = () => {
    const scripts: Array<{ fn: (arg: string) => void; arg: string }> = [];
    const context = {
      addInitScript: async (fn: (arg: string) => void, arg: string) => {
        scripts.push({ fn, arg });
      },
    } as unknown as BrowserContext;
    return { context, scripts };
  };

  it('registers one init script that writes the dismissal key', async () => {
    const { context, scripts } = fakeContext();
    await suppressSeasonalBanner(context);
    expect(scripts).toHaveLength(1);

    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      setItem: (k: string, v: string) => store.set(k, v),
    });
    scripts[0].fn(scripts[0].arg);

    expect([...store.keys()]).toEqual([COUNTDOWN_DISMISS_KEY]);
    // A millisecond timestamp the banner can parse and compare to its dismiss window.
    expect(
      Number.isFinite(parseInt(store.get(COUNTDOWN_DISMISS_KEY)!, 10))
    ).toBe(true);
    expect(
      Date.now() - parseInt(store.get(COUNTDOWN_DISMISS_KEY)!, 10)
    ).toBeLessThan(5000);
  });

  it('does not throw when storage is unavailable', async () => {
    const { context, scripts } = fakeContext();
    await suppressSeasonalBanner(context);
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => scripts[0].fn(scripts[0].arg)).not.toThrow();
  });

  it('uses the key the banner component reads', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/atomic/CountdownBanner/CountdownBanner.tsx'
      ),
      'utf8'
    );
    expect(source).toContain(`const DISMISS_KEY = '${COUNTDOWN_DISMISS_KEY}'`);
  });
});

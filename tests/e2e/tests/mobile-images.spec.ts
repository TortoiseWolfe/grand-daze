/**
 * Mobile Image Responsive Test (T017)
 * PRP-017: Mobile-First Design Overhaul
 */

import { test, expect } from '@playwright/test';
import { dismissCookieBanner } from '../utils/test-user-factory';
import {
  readBlogPosts,
  requireFirstBlogPostPath,
} from '../utils/blog-fixtures';

/** A post that exists in public/blog, never a template slug (#11). */
const POSTS = readBlogPosts();
const BLOG_POST = requireFirstBlogPostPath(POSTS);
/** One post leads the index; the rest are cards (`src/app/blog/page.tsx`). */
const INDEX_CARDS = Math.max(POSTS.length - 1, 0);

/**
 * Wait for layout to stabilize after viewport/page change
 */
async function waitForLayoutStability(page: import('@playwright/test').Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => {
      return new Promise((resolve) => {
        let stable = 0;
        const check = () => {
          stable++;
          if (stable >= 3) resolve(true);
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    },
    { timeout: 5000 }
  );
}

test.describe('Mobile Responsive Images', () => {
  const widths = [320, 390, 428];

  for (const width of widths) {
    test(`Images fit within ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(BLOG_POST);
      await dismissCookieBanner(page);
      await waitForLayoutStability(page);

      const images = await page.locator('img').all();

      for (const img of images) {
        if (await img.isVisible()) {
          const box = await img.boundingBox();

          if (box) {
            expect(
              box.width,
              'Image width should not exceed viewport'
            ).toBeLessThanOrEqual(width + 1);
          }
        }
      }
    });
  }

  test('Images use lazy loading', async ({ page }) => {
    // The blog index puts one post on the lead plate, a plain <img> with no `loading`
    // attribute because it is the hero, and the rest in cards that use next/image, which
    // sets `loading="lazy"`. A one-post site has no cards, so this test passed having
    // asserted nothing and the zero-assertion gate failed it (#396, #11).
    test.skip(
      INDEX_CARDS < 1,
      `/blog/ shows ${INDEX_CARDS} card(s): the only image is the hero lead plate, ` +
        'so there is no lazy image to check until the site has a second post'
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/blog/');
    await dismissCookieBanner(page);
    await waitForLayoutStability(page);

    const images = await page.locator('img').all();
    let checked = 0;

    for (const img of images.slice(0, 10)) {
      const loading = await img.getAttribute('loading');

      // Images should have lazy loading (except first/hero images)
      if (loading) {
        expect(['lazy', 'eager']).toContain(loading);
        checked++;
      }
    }

    // ASSERT the precondition rather than branching on it: with cards present, at
    // least one image must carry a loading attribute, or nothing was measured.
    expect(
      checked,
      'no image on /blog/ carries a loading attribute, so nothing was measured'
    ).toBeGreaterThan(0);
  });
});

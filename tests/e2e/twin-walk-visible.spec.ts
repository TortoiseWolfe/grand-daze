import { expect } from '@playwright/test';
import { test } from './fixtures/test';
import sharp from 'sharp';

/**
 * Visual regression guard for first-person Walk (`/chatt?diorama&walk`).
 *
 * WHY THIS EXISTS: every scene regression in the walk-realism arc — the unlit
 * "dark void", the buildings vanishing into the ground, the over-sepia grade —
 * sailed through console/error checks because nothing threw. Only the *pixels*
 * were wrong. This spec reads the composited frame (a real screenshot, so it
 * captures WebGL via the compositor regardless of preserveDrawingBuffer) and
 * fails if the street level is too dark or too uniform to be the city.
 *
 * WebGL honesty (see tests/e2e/twin-glass-contrast.spec.ts + #288): headless
 * Chromium draws with software GL (SwiftShader), which is slow but accurate, so this
 * guard runs there. If WebGL is unavailable altogether we SKIP rather than
 * false-green on a blank canvas.
 *
 * Run: docker exec sh-cod-grand-daze-1 pnpm exec playwright test \
 *        --config playwright.visual.config.ts
 */

// Floors calibrated against the daylit walk scene (buildings + sky + ground).
// A dark-void regression drives mean luminance toward 0; a flat single-colour
// frame (no geometry / all fog) drives inter-tile variance toward 0.
const MIN_MEAN_LUMINANCE = 0.1;
const MIN_VARIANCE = 0.0015;

/** The exported CI build serves at /chatt; the dev container serves under a basePath —
 *  set APP_BASE_PATH=/GrandDaze when pointing at the dev server. */
async function openWalk(page: import('@playwright/test').Page) {
  const base = process.env.APP_BASE_PATH ?? '';
  await page.goto(`${base}/chatt/?diorama&walk`);
  // The canvas element mounts into the DOM immediately (attached), even before
  // the scene draws — wait for that, not visibility (a 0-size/unpainted canvas
  // never becomes "visible" under software GL).
  await page
    .locator('canvas')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 });
}

// THE WHOLE FILE NEEDS A BIGGER BUDGET THAN THE 30s DEFAULT, and the first version of the
// reachability test did not get one. It asked for a 45s `expect` inside a 30s test, which is
// silently unreachable — the test dies at 30s and the expect timeout never applies. It passed
// on one CI run and failed the next with `Test timeout of 30000ms exceeded`, which reads like
// a product regression and is not one.
//
// The real cost is genuine, not padding: the scene downloads the baked city, builds its
// meshes and bakes the collision BVH before walk can engage — ~15s in the dev container, and
// slower on a CI runner that is simultaneously hosting a full local Supabase stack. The pixel
// test below is budgeted too (a 25s wait plus an 8s settle plus a screenshot already exceeds
// 30s on its own, so it could only ever have passed by skipping).
test.describe.configure({ timeout: 150_000 });

test.describe('walk scene is visible (not a dark void / empty frame)', () => {
  /**
   * SPLIT OUT AND UN-SWALLOWED (#725).
   *
   * This assertion used to live inside the pixel test below, BELOW the software-GL
   * `test.skip` and written as `.waitFor(...).catch(() => {})`. Both halves were wrong:
   *
   *  - swallowed, it could not fail. When walk was dead for a day in production (#723) the
   *    two surviving assertions — mean luminance and inter-tile variance — were satisfied
   *    just as well by an orbiting lit city as by a first-person view, so a spec named
   *    `twin-walk-visible` would have reported green while walk was not visible at all.
   *  - placed after the GPU gate, it was skipped on exactly the runners CI has.
   *
   * Reaching walk needs no GPU: the badge is DOM, and it renders under SwiftShader in the
   * dev container in ~15 s. Only the PIXEL guard below needs a real GPU.
   */
  test('walk mode engages from the ?walk deep link', async ({ page }) => {
    await openWalk(page);

    // GATED ON WEBGL EXISTING — NOT on it being hardware. The distinction is the whole
    // point of splitting this test out, and getting it wrong in either direction costs
    // something:
    //
    //   no WebGL at all  -> SKIP. Reaching walk needs the world to hand over its terrain
    //                       and buildings meshes, which needs a canvas that draws. Headless
    //                       firefox has no WebGL (documented at twins.spec.ts:344), so the
    //                       meshes never arrive and the failure would be about the runner,
    //                       not the product. Found the honest way: this test went red on
    //                       firefox-gen 6/6 on its first fail-capable run, while chromium
    //                       and webkit passed.
    //   software WebGL   -> RUN. SwiftShader draws the scene fine — measured reaching walk
    //                       in ~15 s locally and passing on CI chromium. Skipping here is
    //                       what left this URL with no coverage on any runner CI has, which
    //                       is exactly the hole #723 fell through.
    const hasWebGL = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    });
    test.skip(
      !hasWebGL,
      'no WebGL in this browser (see #288) — the scene cannot produce the meshes walk ' +
        'mode is built from, so this would measure the runner rather than the app'
    );

    await expect(
      page.locator('[data-stance]').first(),
      'the ?walk deep link never reached walk mode — the stance badge only renders ' +
        'while mode === "walk", so the player is stuck in the orbit shot (#723)'
    ).toBeVisible({ timeout: 120_000 });
  });

  test('street level renders lit geometry', async ({ page }) => {
    await openWalk(page);

    // Software WebGL is fine here. This test used to skip on SwiftShader and llvmpipe,
    // on the belief that a software renderer cannot draw the scene (#288). It can:
    // under SwiftShader the walk engages after about 47 s and the frame measures a
    // mean of 0.18 and a variance of 0.073 against floors of 0.1 and 0.0015. What the
    // test needs is time, not a GPU, so the only gate left is "is there WebGL at all".
    const hasGl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    });
    test.skip(!hasGl, 'no WebGL in this browser (see #288)');
    // Walk takes about 47 s to engage under software GL, so this test gets more than the
    // file-wide 150 s: 30 s to open, up to 120 s of waiting, an 8 s settle and the shot.
    test.setTimeout(240_000);

    // Wait for Walk to activate, then settle the first frames. Hard wait —
    // a dark-void check against a scene that never entered walk measures the wrong frame.
    await page.locator('[data-stance]').first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(8000);

    // Software WebGL redraws the canvas too slowly for Playwright's "wait for the element to be
    // stable" check (two frames with the same box): in CI it ran out of the 15 s action budget
    // at that step on all three tries (run 42436527737). Measure the box once and capture that
    // rectangle instead, with a longer wait for the capture itself.
    const box = await page.locator('canvas').first().boundingBox();
    expect(box, 'the walk canvas has no layout box to capture').not.toBeNull();
    const shot = await page.screenshot({ clip: box!, timeout: 60_000 });

    // Downsample to a coarse grid and measure mean luminance + inter-tile
    // variance. sharp decodes the PNG the compositor produced.
    const W = 32;
    const H = 18;
    const { data, info } = await sharp(shot)
      .resize(W, H, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const lum: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const r = data[i * ch];
      const g = data[i * ch + 1];
      const b = data[i * ch + 2];
      lum.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    }
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const variance = lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length;

    console.log(
      `[visual-smoke] mean=${mean.toFixed(4)} variance=${variance.toFixed(5)}`
    );

    expect(
      mean,
      `frame too dark (mean luminance ${mean.toFixed(3)}) — likely an unlit / dark-void regression`
    ).toBeGreaterThan(MIN_MEAN_LUMINANCE);
    expect(
      variance,
      `frame too uniform (variance ${variance.toFixed(4)}) — likely no geometry on screen (buildings gone / flat fog)`
    ).toBeGreaterThan(MIN_VARIANCE);
  });
});

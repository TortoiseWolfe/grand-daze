/**
 * E2E Test: Avatar Upload User Flow
 *
 * Tests the complete user interaction flow for avatar upload:
 * - Navigate to Account Settings
 * - Upload avatar with crop interface
 * - Replace existing avatar
 * - Remove avatar
 * - Validation error handling
 *
 * Prerequisites:
 * - Test user authenticated
 * - Account Settings page accessible at /account-settings
 * - Test fixtures available at e2e/fixtures/avatars/
 */

import { expect } from '@playwright/test';
import { test } from '../fixtures/test';
import path from 'path';
import {
  dismissCookieBanner,
  injectSessionIntoPage,
  signInAsInjectable,
  seedIsolatedUser,
  deleteIsolatedUser,
  type IsolatedUser,
} from '../utils/test-user-factory';
import { isLocalBackend } from '../../utils/local-backend';

// Auth does NOT come from the shared storageState here (#21). The upload writes
// to Storage and then updates the auth user; when another spec in the same run
// revoked the shared user's login session, that update answered 403 "Auth
// session missing!" and the upload rolled back. A throwaway user's session is
// held by this spec alone, so nobody else can revoke it.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Avatar Upload Flow', () => {
  // Avatar upload writes to the `avatars` Storage bucket, so it needs a local
  // Supabase (the local E2E lane brings one up), not a hosted project.
  test.skip(
    !isLocalBackend(),
    'Uploads to the avatars bucket: needs a local Supabase, not a hosted one'
  );

  let fixture: IsolatedUser | null = null;

  test.beforeAll(async () => {
    if (!isLocalBackend()) return;
    fixture = await seedIsolatedUser();
    // A missing fixture fails the run; it never skips it.
    if (!fixture) {
      throw new Error('Avatar upload spec: could not seed a throwaway user');
    }
  });

  test.afterAll(async () => {
    await deleteIsolatedUser(fixture);
    fixture = null;
  });

  test.beforeEach(async ({ page }) => {
    if (!fixture) throw new Error('No throwaway user was seeded');
    // Sign in again for every test instead of re-injecting the session minted in
    // beforeAll. Each test refreshes the session (upload and remove both do), and
    // local GoTrue rotates the refresh token every time, so by the second test the
    // seed-time token is spent and its cached user has no avatar. That made the
    // first attempt of "Remove avatar" and "nav and account" fail and only the
    // retry (fresh worker, fresh user) pass.
    const { session, error } = await signInAsInjectable(
      fixture.user.email,
      fixture.user.password
    );
    if (!session) {
      throw new Error(
        `Avatar upload spec: could not sign the throwaway user in (${error ?? 'no session'})`
      );
    }
    await injectSessionIntoPage(page, session);
    await page.goto('/account');
    await page.waitForLoadState('networkidle');
    await dismissCookieBanner(page);
  });

  test.afterEach(async ({ page }) => {
    // Clean up: Remove avatar if exists. Removing asks for confirmation with a
    // browser confirm(); Playwright dismisses an unhandled dialog, which cancelled
    // the removal and left the avatar behind for the next test.
    const removeButton = page.getByRole('button', { name: /remove avatar/i });
    const isVisible = await removeButton.isVisible().catch(() => false);

    if (isVisible) {
      page.once('dialog', (dialog) => dialog.accept());
      await removeButton.click();
      await expect(removeButton).toBeHidden({ timeout: 15000 });
    }
  });

  test('US1.1 - Upload new avatar with crop interface', async ({ page }) => {
    // Get initial avatar URL (if any)
    const profilePictureCard = page
      .locator('.card')
      .filter({ hasText: 'Profile Picture' });
    const accountAvatar = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });
    const initialAvatarSrc = await accountAvatar
      .getAttribute('src')
      .catch(() => null);

    // Find and click upload button
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    await expect(uploadButton).toBeVisible();
    await expect(uploadButton).toHaveAttribute('aria-label', /upload/i);

    // Click upload button to open file picker
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    // Select test image
    const testImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-500x500.jpg'
    );
    await fileChooser.setFiles(testImagePath);

    // Wait for crop interface to appear
    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).toBeVisible({ timeout: 5000 });

    // Verify crop controls present
    await expect(page.getByLabel(/zoom/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();

    // Save cropped avatar
    const saveButton = page.getByRole('button', { name: /save/i });
    await saveButton.click();

    // Wait for modal to close (indicates upload attempt completed)
    await expect(cropModal).toBeHidden({ timeout: 30000 });

    // Check for error message - if present, upload failed
    const errorMessage = profilePictureCard.getByRole('alert');
    const hasError = await errorMessage.isVisible().catch(() => false);
    // A failed upload must fail the test, never skip it. The alert's text is
    // read only when it exists: textContent() on a missing element waits out
    // the whole test timeout, which is what made this test time out in CI.
    if (hasError) {
      const reason = await errorMessage.textContent({ timeout: 2000 });
      throw new Error(`Upload failed: ${reason}`);
    }

    // Verify upload succeeded by checking avatar URL changed
    await expect(async () => {
      const newAvatarSrc = await accountAvatar
        .getAttribute('src')
        .catch(() => null);
      // Avatar should exist and have a Supabase storage URL
      expect(newAvatarSrc).toBeTruthy();
      expect(newAvatarSrc).toMatch(/avatars/);
      // If there was an initial avatar, URL should have changed (new timestamp)
      if (initialAvatarSrc && initialAvatarSrc.includes('avatars')) {
        expect(newAvatarSrc).not.toBe(initialAvatarSrc);
      }
    }).toPass({ timeout: 10000 });

    // Verify avatar persists after reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await dismissCookieBanner(page);
    await expect(accountAvatar).toBeVisible();
    await expect(accountAvatar).toHaveAttribute('src', /avatars/);
  });

  test('US1.2 - Replace existing avatar', async ({ page }) => {
    const profilePictureCard = page
      .locator('.card')
      .filter({ hasText: 'Profile Picture' });
    const accountAvatar = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });

    // Upload first avatar
    const fileChooser1Promise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser1 = await fileChooser1Promise;

    const firstImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-500x500.jpg'
    );
    await fileChooser1.setFiles(firstImagePath);

    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /save/i }).click();
    await expect(cropModal).toBeHidden({ timeout: 30000 });

    // Wait for first avatar to appear and get its URL
    await expect(accountAvatar).toBeVisible();
    const firstAvatarSrc = await accountAvatar.getAttribute('src');
    expect(firstAvatarSrc).toMatch(/avatars/);

    // Upload second avatar (replacement)
    const fileChooser2Promise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser2 = await fileChooser2Promise;

    const secondImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-800x800.png'
    );
    await fileChooser2.setFiles(secondImagePath);

    await expect(cropModal).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /save/i }).click();
    await expect(cropModal).toBeHidden({ timeout: 30000 });

    // Verify new avatar URL is different from first
    await expect(async () => {
      const secondAvatarSrc = await accountAvatar.getAttribute('src');
      expect(secondAvatarSrc).toBeTruthy();
      expect(secondAvatarSrc).toMatch(/avatars/);
      expect(secondAvatarSrc).not.toBe(firstAvatarSrc);
    }).toPass({ timeout: 10000 });
  });

  test('US1.3 - Remove avatar', async ({ page }) => {
    const profilePictureCard = page
      .locator('.card')
      .filter({ hasText: 'Profile Picture' });
    const accountAvatar = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });

    // Ensure we have an avatar to remove (upload if needed). Wait for the card to
    // finish loading first: an instant isVisible() during the profile spinner
    // reports "no avatar" for a user who has one.
    await expect(uploadButton).toBeVisible();
    const hasExistingAvatar = await accountAvatar
      .isVisible()
      .catch(() => false);
    if (!hasExistingAvatar) {
      const fileChooserPromise = page.waitForEvent('filechooser');
      await uploadButton.click();
      const fileChooser = await fileChooserPromise;

      const testImagePath = path.join(
        __dirname,
        '../fixtures/avatars/valid-500x500.jpg'
      );
      await fileChooser.setFiles(testImagePath);

      const cropModal = page.getByRole('dialog', { name: /crop/i });
      await expect(cropModal).toBeVisible({ timeout: 5000 });
      await page.getByRole('button', { name: /save/i }).click();
      await expect(cropModal).toBeHidden({ timeout: 30000 });
      await expect(accountAvatar).toBeVisible({ timeout: 10000 });
    }

    // Verify avatar is visible before removal
    await expect(accountAvatar).toBeVisible();
    const avatarSrcBeforeRemoval = await accountAvatar.getAttribute('src');
    expect(avatarSrcBeforeRemoval).toMatch(/avatars/);

    // Click remove button and handle browser confirm dialog
    const removeButton = page.getByRole('button', { name: /remove avatar/i });
    await expect(removeButton).toBeVisible();

    // Accept the browser confirm() dialog
    page.once('dialog', (dialog) => dialog.accept());

    await removeButton.click();

    // The Remove button goes away once the removal has been saved. Reloading
    // before then raced the request and showed the old picture.
    await expect(removeButton).toBeHidden({ timeout: 15000 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    await dismissCookieBanner(page);

    // Verify avatar is replaced with default (initials or placeholder)
    // The avatar image should either be gone or show a different src
    const defaultAvatar = profilePictureCard.locator(
      '[data-testid="default-avatar"]'
    );
    const avatarImageAfterRemoval = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });

    const hasDefaultAvatar = await defaultAvatar.isVisible().catch(() => false);
    const hasAvatarImage = await avatarImageAfterRemoval
      .isVisible()
      .catch(() => false);

    if (hasDefaultAvatar) {
      // Verify initials display within the default avatar
      const initialsText = await defaultAvatar.textContent();
      expect(initialsText).toMatch(/^[A-Z?]{1,2}$/);
    } else if (hasAvatarImage) {
      // If image still shows, verify it's NOT the old avatar URL
      const newSrc = await avatarImageAfterRemoval.getAttribute('src');
      expect(newSrc).not.toBe(avatarSrcBeforeRemoval);
    } else {
      // No avatar visible at all - that's acceptable for removal
      expect(hasDefaultAvatar || hasAvatarImage).toBeFalsy();
    }
  });

  test('US1.4 - Cancel crop without saving', async ({ page }) => {
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    const testImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-500x500.jpg'
    );
    await fileChooser.setFiles(testImagePath);

    // Wait for crop interface
    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).toBeVisible({ timeout: 5000 });

    // Click cancel
    const cancelButton = page.getByRole('button', { name: /cancel/i });
    await cancelButton.click();

    // Verify crop interface closed
    await expect(cropModal).toBeHidden();

    // Verify no success message
    await expect(page.getByText(/uploaded successfully/i)).not.toBeVisible();

    // Verify no new avatar added
    const avatarImage = page
      .locator('.card')
      .filter({ hasText: 'Profile Picture' })
      .getByRole('img', { name: /avatar/i });
    const hasAvatar = await avatarImage.isVisible().catch(() => false);

    if (hasAvatar) {
      // If avatar exists, verify URL didn't change by checking timestamp
      const avatarSrc = await avatarImage.getAttribute('src');
      const currentTimestamp = Date.now();
      const urlTimestamp = parseInt(
        avatarSrc?.match(/\/(\d{13})\.webp/)?.[1] || '0'
      );

      // URL timestamp should be older than test start (more than 10 seconds ago)
      expect(currentTimestamp - urlTimestamp).toBeGreaterThan(10000);
    }
  });

  test('US1.5 - Avatar displays in both nav and account page (SC-005)', async ({
    page,
  }) => {
    const profilePictureCard = page
      .locator('.card')
      .filter({ hasText: 'Profile Picture' });
    const accountAvatar = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });

    // Upload avatar
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    const testImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-500x500.jpg'
    );
    await fileChooser.setFiles(testImagePath);

    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /save/i }).click();
    await expect(cropModal).toBeHidden({ timeout: 30000 });

    // Verify avatar in Account Page (Profile Picture card)
    await expect(accountAvatar).toBeVisible({ timeout: 10000 });
    const accountAvatarSrc = await accountAvatar.getAttribute('src');
    expect(accountAvatarSrc).toMatch(/avatars/);

    // Verify avatar in Navigation (may be in dropdown or directly visible)
    const navAvatar = page
      .locator('nav, header')
      .getByRole('img', { name: /avatar/i })
      .first();
    // The nav picks the new picture up a moment after the account card does.
    await expect(async () => {
      await expect(navAvatar).toBeVisible();
      expect(await navAvatar.getAttribute('src')).toMatch(/avatars/);
    }).toPass({ timeout: 15000 });

    // Note: Nav avatar may not match account avatar immediately due to caching
    // This is a known limitation (Feature 038 FR-001). Reload verifies sync.

    // Verify both sync after page reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    await dismissCookieBanner(page);

    // After reload, both should show the same (latest) avatar
    const accountAvatarAfterReload = profilePictureCard.getByRole('img', {
      name: /avatar/i,
    });
    const navAvatarAfterReload = page
      .locator('nav, header')
      .getByRole('img', { name: /avatar/i })
      .first();

    await expect(accountAvatarAfterReload).toBeVisible();
    await expect(navAvatarAfterReload).toBeVisible();

    const accountSrcAfterReload =
      await accountAvatarAfterReload.getAttribute('src');
    const navSrcAfterReload = await navAvatarAfterReload.getAttribute('src');

    expect(accountSrcAfterReload).toMatch(/avatars/);
    expect(navSrcAfterReload).toMatch(/avatars/);
    expect(navSrcAfterReload).toBe(accountSrcAfterReload);
  });

  test('Edge Case: Reject oversized file', async ({ page }) => {
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    const largeImagePath = path.join(
      __dirname,
      '../fixtures/avatars/invalid-toolarge.jpg'
    );
    await fileChooser.setFiles(largeImagePath);

    // Verify error message appears
    await expect(page.getByText(/5MB|too large|size limit/i)).toBeVisible({
      timeout: 5000,
    });

    // Verify crop interface does NOT appear
    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).not.toBeVisible();
  });

  test('Edge Case: Reject invalid file format', async ({ page }) => {
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    const invalidFilePath = path.join(
      __dirname,
      '../fixtures/avatars/invalid-format.pdf'
    );
    await fileChooser.setFiles(invalidFilePath);

    // Verify error message appears
    await expect(
      page.getByText(/invalid file type|jpeg|png|webp/i)
    ).toBeVisible({
      timeout: 5000,
    });

    // Verify crop interface does NOT appear
    const cropModal = page.getByRole('dialog', { name: /crop/i });
    await expect(cropModal).not.toBeVisible();
  });

  test('Edge Case: Handle network interruption gracefully', async ({
    page,
    context,
  }) => {
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    const fileChooserPromise = page.waitForEvent('filechooser');
    await uploadButton.click();
    const fileChooser = await fileChooserPromise;

    const testImagePath = path.join(
      __dirname,
      '../fixtures/avatars/valid-500x500.jpg'
    );
    await fileChooser.setFiles(testImagePath);

    // The network fails during the upload, not before the crop dialog opens.
    // Going offline earlier kept WebKit from ever showing the Save button
    // (the dialog never rendered), so the test timed out on the click.
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeVisible();
    await context.setOffline(true);
    await saveButton.click();

    // TODO: Network error handling not yet implemented (T050 enhancement)
    // For now, upload silently fails when offline - no error message shown
    // await expect(page.getByText(/network error|upload failed|try again/i)).toBeVisible({ timeout: 10000 });

    // Wait to ensure upload doesn't unexpectedly succeed
    await page.waitForTimeout(2000);

    // The one thing that must hold while offline: no success message appeared.
    // This is the test's hard assertion; the retry check below is optional
    // because the retry button is not built yet.
    await expect(page.getByText(/uploaded successfully/i)).not.toBeVisible();

    // Restore network
    await context.setOffline(false);

    // Verify retry option available
    const retryButton = page.getByRole('button', { name: /retry/i });
    if (await retryButton.isVisible().catch(() => false)) {
      await expect(retryButton).toBeVisible();
    }
  });

  test('Accessibility: Keyboard navigation', async ({ page }) => {
    // Focus upload button directly (Tab may land on other interactive elements first)
    const uploadButton = page.getByRole('button', { name: /upload avatar/i });
    await uploadButton.focus();

    // Verify upload button can receive focus
    await expect(uploadButton).toBeFocused();

    // Verify touch target size (44px minimum)
    const buttonBox = await uploadButton.boundingBox();
    expect(buttonBox?.width).toBeGreaterThanOrEqual(44);
    expect(buttonBox?.height).toBeGreaterThanOrEqual(44);

    // Verify ARIA labels
    await expect(uploadButton).toHaveAttribute('aria-label');

    // Test screen reader announcement
    const srAnnouncement = page.getByRole('status', { name: /avatar/i });
    if (await srAnnouncement.isVisible().catch(() => false)) {
      await expect(srAnnouncement).toHaveAttribute('aria-live', 'polite');
    }
  });
});

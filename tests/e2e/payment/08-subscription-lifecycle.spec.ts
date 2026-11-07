/**
 * Payment E2E: Stripe Subscription Lifecycle (#105)
 *
 * Two tests, two jobs:
 *
 * 1. STUBBED (runs everywhere, CI included). A seeded Stripe subscription row is
 *    opened on the Subscriptions page and cancelled, then resumed, with the
 *    cancel-subscription and resume-subscription Edge Functions answered at the
 *    network edge. It proves what the page SENDS (the row's id and the signed-in
 *    user's token) and SHOWS (the Canceled and Active badges).
 *
 * 2. LIVE SANDBOX (local only). Drives the deployed Edge Functions against a REAL
 *    test-mode Stripe subscription and cross-checks provider state
 *    (cancel_at_period_end) after each action. It needs STRIPE_SECRET_KEY and
 *    NEXT_PUBLIC_STRIPE_PRICE_ID, which CI cannot hold: a live secret key must not
 *    sit in a repository that runs untrusted pull requests, and the local Supabase
 *    stack has no deployed Edge Functions to call. This one skip is deliberate; it
 *    is the only provider-side check, and the stubbed test above covers the page.
 */

import { expect } from '@playwright/test';
import { test } from '../fixtures/test';
import {
  seedLiveStripeSubscription,
  deleteLiveStripeSubscription,
  getStripeSubscription,
  openSubscriptionsAs,
  getAdminClient,
  seedIsolatedSubscription,
  deleteIsolatedSubscription,
  type IsolatedSubscription,
} from '../utils/test-user-factory';
import { stubEdgeFunction } from '../utils/payment-stubs';

const isLiveStripeConfigured =
  !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;

test.describe('Stripe Subscription Lifecycle (stubbed Edge Functions)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('cancel and resume round-trip from the Subscriptions page', async ({
    browser,
  }) => {
    let fixture: IsolatedSubscription | null = null;
    let opened: Awaited<ReturnType<typeof openSubscriptionsAs>> | null = null;
    try {
      fixture = await seedIsolatedSubscription('active', {
        provider: 'stripe',
      });
      // A missing fixture fails the run; it never skips it.
      if (!fixture) throw new Error('Could not seed a subscription');

      opened = await openSubscriptionsAs(browser, fixture);
      const { page } = opened;
      const cancelRequest = await stubEdgeFunction(
        page,
        'cancel-subscription',
        { json: { success: true } }
      );
      const resumeRequest = await stubEdgeFunction(
        page,
        'resume-subscription',
        { json: { success: true } }
      );

      await expect(
        page.locator('.badge', { hasText: 'Active' }).first()
      ).toBeVisible({ timeout: 30_000 });

      // Cancel: the page sends the row id with the user's token, then shows Canceled.
      page.once('dialog', (d) => d.accept());
      await page
        .getByRole('button', { name: 'Cancel subscription' })
        .first()
        .click();
      const cancel = await cancelRequest();
      expect(cancel.body.subscription_id).toBe(fixture.subscriptionId);
      expect(cancel.authorization).toMatch(/^Bearer .+/);
      await expect(
        page.locator('.badge', { hasText: 'Canceled' }).first()
      ).toBeVisible({ timeout: 15_000 });

      // Resume: same request shape, then back to Active.
      await page
        .getByRole('button', { name: 'Resume subscription' })
        .first()
        .click();
      const resume = await resumeRequest();
      expect(resume.body.subscription_id).toBe(fixture.subscriptionId);
      expect(resume.authorization).toMatch(/^Bearer .+/);
      await expect(
        page.locator('.badge', { hasText: 'Active' }).first()
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      if (opened) await opened.close();
      await deleteIsolatedSubscription(fixture);
    }
  });
});

test.describe('Stripe Subscription Lifecycle (live sandbox)', () => {
  // Seeding provisions a real customer + subscription at Stripe.
  test.describe.configure({ timeout: 120_000 });

  test('cancel and resume round-trip through the deployed Edge Functions', async ({
    browser,
  }) => {
    test.skip(
      !isLiveStripeConfigured,
      'Live Stripe sandbox keys are not available in CI (a secret key must not sit in a repo that runs untrusted pull requests) — run locally for the live lifecycle test (#105)'
    );

    const fixture = await seedLiveStripeSubscription();
    // Keys are set here, so a failed seed is a real failure, never a skip.
    if (!fixture)
      throw new Error('Could not seed the live Stripe subscription');

    const opened = await openSubscriptionsAs(browser, fixture);
    const { page } = opened;
    try {
      // Seeded row renders as an Active card.
      await expect(
        page.locator('.badge', { hasText: 'Active' }).first()
      ).toBeVisible({ timeout: 20_000 });

      // Cancel: local model flips to 'canceled' immediately; at Stripe this
      // is active + cancel_at_period_end=true (access until period end).
      page.once('dialog', (d) => d.accept());
      await page
        .getByRole('button', { name: 'Cancel subscription' })
        .first()
        .click();
      await expect(
        page.locator('.badge', { hasText: 'Canceled' }).first()
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () =>
            (await getStripeSubscription(fixture.stripeSubscriptionId))
              .cancel_at_period_end,
          { timeout: 15_000 }
        )
        .toBe(true);

      // Resume: back to active on both sides.
      await page
        .getByRole('button', { name: 'Resume subscription' })
        .first()
        .click();
      await expect(
        page.locator('.badge', { hasText: 'Active' }).first()
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () =>
            (await getStripeSubscription(fixture.stripeSubscriptionId))
              .cancel_at_period_end,
          { timeout: 15_000 }
        )
        .toBe(false);

      // DB row ends consistent: active with cancellation fields cleared.
      const admin = getAdminClient();
      await expect
        .poll(
          async () => {
            const { data } = await admin!
              .from('subscriptions')
              .select('status, canceled_at')
              .eq('id', fixture.subscriptionId)
              .single();
            return (
              data && data.status === 'active' && data.canceled_at === null
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);
    } finally {
      await opened.close();
      await deleteLiveStripeSubscription(fixture);
    }
  });
});

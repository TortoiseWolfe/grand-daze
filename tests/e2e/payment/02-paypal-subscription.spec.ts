/**
 * Integration Test: Subscription Creation (PayPal) - T056
 *
 * CI has no PayPal account, so two things are replaced and everything else is
 * real (see ../utils/payment-stubs.ts): PayPal's own button script (a stand-in
 * that runs the page's createSubscription / createOrder / onApprove in the same
 * order PayPal's popup would) and the Supabase Edge Functions that would call
 * PayPal. What the tests prove is OUR side: the consent gate, the request each
 * button sends, the rows in the database, and what the page shows with the
 * answer. They do not prove PayPal accepts the request; only a live sandbox can.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  dismissCookieBanner,
  getAdminClient,
  seedIsolatedSubscription,
  deleteIsolatedSubscription,
  openSubscriptionsAs,
  type IsolatedSubscription,
} from '../utils/test-user-factory';
import { installFakePayPalSdk, stubEdgeFunction } from '../utils/payment-stubs';

test.describe('PayPal Subscription Creation Flow', () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await installFakePayPalSdk(page);
    // The saved sign-in state already carries a valid Supabase session.
    // Direct nav avoids the /sign-in hop; auth-hydration race handled by retry.
    await page.goto('/payment-demo', { waitUntil: 'networkidle' });
    if (page.url().includes('/sign-in')) {
      await page.waitForTimeout(3000);
      await page.goto('/payment-demo', { waitUntil: 'networkidle' });
    }
    await dismissCookieBanner(page);

    await page
      .getByRole('heading', { name: /Step [12]|GDPR Consent/i })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });

    await page.evaluate(() => {
      localStorage.removeItem('payment_consent');
      localStorage.removeItem('payment_consent_date');
      localStorage.removeItem('gdpr_consent');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await dismissCookieBanner(page);

    await page
      .getByRole('heading', { name: /Step [12]|GDPR Consent/i })
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  });

  // /payment-demo draws three payment buttons, each with its own provider tabs:
  // one-time $20, the Care Plan subscription, and a one-time PayPal $15. The
  // stand-in PayPal button appears inside the button's own container.
  const standInButton = (page: Page, n: number) =>
    page
      .getByTestId('paypal-buttons')
      .nth(n)
      .getByRole('button', { name: 'Stand-in PayPal checkout' });

  test('should create a PayPal subscription for the Care Plan', async ({
    page,
  }) => {
    const createRequest = await stubEdgeFunction(
      page,
      'create-paypal-subscription',
      { json: { subscriptionId: 'I-STUBSUBSCRIPTION' } }
    );

    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    await page
      .getByRole('tab', { name: /paypal/i })
      .nth(1)
      .click();
    await standInButton(page, 1).click();

    // The button names the catalog SKU; the server picks the PayPal plan (#774).
    const request = await createRequest();
    expect(request.body.product_id).toBe('svc-care');
    expect(request.body).not.toHaveProperty('plan_id');
    expect(request.authorization).toMatch(/^Bearer .+/);

    await expect(
      page.getByRole('heading', { name: /Step 3: Payment Result/i })
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show the reason when PayPal subscription creation is refused', async ({
    page,
  }) => {
    await stubEdgeFunction(page, 'create-paypal-subscription', {
      status: 404,
      json: { error: 'Product not found' },
    });

    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    await page
      .getByRole('tab', { name: /paypal/i })
      .nth(1)
      .click();
    await standInButton(page, 1).click();

    await expect(page.getByText('Error: Product not found')).toBeVisible({
      timeout: 15000,
    });
  });

  test('should create and capture a one-time PayPal order', async ({
    page,
  }) => {
    const createRequest = await stubEdgeFunction(page, 'create-paypal-order', {
      json: { orderId: 'ORDER-STUB' },
    });
    const captureRequest = await stubEdgeFunction(
      page,
      'capture-paypal-order',
      { json: { status: 'COMPLETED' } }
    );

    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    await page
      .getByRole('tab', { name: /paypal/i })
      .nth(2)
      .click();
    await standInButton(page, 2).click();

    // A real payment intent was written first, and the order is made for it.
    expect((await createRequest()).body.payment_intent_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // The capture asks about the order PayPal returned.
    expect((await captureRequest()).body.order_id).toBe('ORDER-STUB');

    await expect(
      page.getByRole('heading', { name: /Step 3: Payment Result/i })
    ).toBeVisible({ timeout: 15000 });
  });

  test('should show PayPal provider tab', async ({ page }) => {
    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    // PayPal tab should be visible
    const paypalTab = page.getByRole('tab', { name: /paypal/i }).first();
    await expect(paypalTab).toBeVisible();

    // Click PayPal tab
    await paypalTab.click();
    await expect(paypalTab).toHaveClass(/tab-active/);
  });

  test('should show PayPal payment button', async ({ page }) => {
    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    // PayPal button should be visible
    await expect(
      page.getByRole('button', { name: /PayPal \$15\.00/i })
    ).toBeVisible();
  });

  test('subscription management route renders for an authed user (#5)', async ({
    page,
  }) => {
    // The payment hub's Subscriptions tab (/payment?tab=subscriptions) renders
    // the SubscriptionManager. With no seeded subscription the test user sees the
    // empty-state; this asserts the route is wired (ProtectedRoute → hub tab →
    // SubscriptionManager) and reachable.
    await page.goto('/payment?tab=subscriptions', { waitUntil: 'networkidle' });
    if (page.url().includes('/sign-in')) {
      await page.waitForTimeout(3000);
      await page.goto('/payment?tab=subscriptions', {
        waitUntil: 'networkidle',
      });
    }
    await dismissCookieBanner(page);

    await expect(
      page.getByRole('heading', { name: 'Subscriptions', level: 1 })
    ).toBeVisible({ timeout: 30000 });
    // Either the empty-state card or at least one subscription card renders.
    await expect(
      page.getByText(/No active subscriptions|subscription\(s\)/i).first()
    ).toBeVisible();
  });

  // The flows below run against a SEEDED subscription row via the per-test
  // fixture (seedIsolatedSubscription: service-role insert + cleanup, no
  // provider credentials). The Edge Functions that would reach PayPal are
  // stubbed at the network edge, so each test proves what the Subscriptions page
  // SENDS (the row's id and the signed-in user's token) and SHOWS in answer.

  test('should allow subscription cancellation', async ({ browser }) => {
    let fixture: IsolatedSubscription | null = null;
    let opened: Awaited<ReturnType<typeof openSubscriptionsAs>> | null = null;
    try {
      fixture = await seedIsolatedSubscription('active', {
        provider: 'paypal',
      });
      if (!fixture) throw new Error('Could not seed a subscription');
      opened = await openSubscriptionsAs(browser, fixture);
      const { page } = opened;
      const cancelRequest = await stubEdgeFunction(
        page,
        'cancel-subscription',
        { json: { success: true } }
      );

      await expect(
        page.locator('.badge', { hasText: 'Active' }).first()
      ).toBeVisible({ timeout: 30000 });

      page.once('dialog', (d) => d.accept());
      await page
        .getByRole('button', { name: 'Cancel subscription' })
        .first()
        .click();

      const request = await cancelRequest();
      expect(request.body.subscription_id).toBe(fixture.subscriptionId);
      expect(request.authorization).toMatch(/^Bearer .+/);
      await expect(
        page.locator('.badge', { hasText: 'Canceled' }).first()
      ).toBeVisible({ timeout: 15000 });
    } finally {
      if (opened) await opened.close();
      await deleteIsolatedSubscription(fixture);
    }
  });

  test('should retry a failed payment from the Subscriptions page', async ({
    browser,
  }) => {
    let fixture: IsolatedSubscription | null = null;
    let opened: Awaited<ReturnType<typeof openSubscriptionsAs>> | null = null;
    try {
      fixture = await seedIsolatedSubscription('past_due', {
        provider: 'paypal',
      });
      if (!fixture) throw new Error('Could not seed a subscription');
      opened = await openSubscriptionsAs(browser, fixture);
      const { page } = opened;
      const retryRequest = await stubEdgeFunction(page, 'retry-subscription', {
        json: { success: true },
      });

      await page
        .getByRole('button', { name: 'Retry payment now' })
        .first()
        .click({ timeout: 30000 });

      const request = await retryRequest();
      expect(request.body.subscription_id).toBe(fixture.subscriptionId);
      expect(request.authorization).toMatch(/^Bearer .+/);
    } finally {
      if (opened) await opened.close();
      await deleteIsolatedSubscription(fixture);
    }
  });

  test('should tell the user when a payment retry is too soon', async ({
    browser,
  }) => {
    let fixture: IsolatedSubscription | null = null;
    let opened: Awaited<ReturnType<typeof openSubscriptionsAs>> | null = null;
    try {
      fixture = await seedIsolatedSubscription('past_due', {
        provider: 'paypal',
      });
      if (!fixture) throw new Error('Could not seed a subscription');
      opened = await openSubscriptionsAs(browser, fixture);
      const { page } = opened;
      await stubEdgeFunction(page, 'retry-subscription', {
        status: 429,
        json: { error: 'Next retry is available on 2099-01-01' },
      });

      const dialogSeen = page.waitForEvent('dialog');
      await page
        .getByRole('button', { name: 'Retry payment now' })
        .first()
        .click({ timeout: 30000 });
      const dialog = await dialogSeen;
      expect(dialog.message()).toBe('Next retry is available on 2099-01-01');
      await dialog.accept();
    } finally {
      if (opened) await opened.close();
      await deleteIsolatedSubscription(fixture);
    }
  });

  test('should show grace period warning', async ({ browser }) => {
    // Seed a grace_period subscription (expires in 5 days) for a throwaway user,
    // open the payment hub's Subscriptions tab AS that user, and assert the
    // countdown + badge render — a real row through real RLS (no creds needed).
    let fixture: IsolatedSubscription | null = null;
    let opened: Awaited<ReturnType<typeof openSubscriptionsAs>> | null = null;
    try {
      fixture = await seedIsolatedSubscription('grace_period', {
        provider: 'stripe',
        graceDays: 5,
      });
      // A missing fixture fails the run; it never skips it.
      if (!fixture) throw new Error('Could not seed a subscription');

      opened = await openSubscriptionsAs(browser, fixture);
      const { page } = opened;

      await expect(
        page.getByRole('heading', { name: 'Subscriptions', level: 1 })
      ).toBeVisible({ timeout: 30000 });

      // Grace-period alert with the day countdown (graceDays=5).
      await expect(
        page.getByText(/Grace period: 5 days remaining/i)
      ).toBeVisible({ timeout: 30000 });
      // The status badge.
      await expect(page.getByText(/Grace Period/i).first()).toBeVisible();
    } finally {
      if (opened) await opened.close();
      await deleteIsolatedSubscription(fixture);
    }
  });

  test('should prevent duplicate subscriptions', async () => {
    // The one-live-per-user guard (idx_subscriptions_one_live_per_user) is
    // enforced server-side. Seed one live (active) row, then attempt a SECOND
    // live row for the same user via the service-role client and assert it is
    // rejected with Postgres unique_violation (23505) — the same rejection the
    // webhook upsert catches in prod. No provider creds needed.
    let fixture: IsolatedSubscription | null = null;
    try {
      fixture = await seedIsolatedSubscription('active', {
        provider: 'stripe',
      });
      const admin = getAdminClient();
      if (!fixture || !admin) {
        throw new Error('Could not seed a subscription');
      }

      const { error } = await admin.from('subscriptions').insert({
        template_user_id: fixture.user.id,
        provider: 'paypal',
        provider_subscription_id: `iso_dup_${Date.now()}`,
        customer_email: fixture.user.email,
        plan_amount: 999,
        plan_interval: 'month',
        status: 'active', // second LIVE row for the same user → must be rejected
        failed_payment_count: 0,
      });

      expect(error).not.toBeNull();
      // Postgres unique_violation, on the one-live-per-user partial index.
      expect(error?.code).toBe('23505');
      expect(error?.message).toMatch(/idx_subscriptions_one_live_per_user/i);
    } finally {
      await deleteIsolatedSubscription(fixture);
    }
  });
});

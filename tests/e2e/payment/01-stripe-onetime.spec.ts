/**
 * Integration Test: One-Time Payment (Stripe) - T055
 * Tests Stripe payment UI and consent flow
 *
 * The two Checkout-redirect tests (one-time and subscription) run everywhere.
 * What no CI lane can provide is Stripe's own secret key, so the one call that
 * needs it, the edge function that opens a hosted Checkout session, is answered
 * at the network boundary (`stubStripeCheckout`). Everything on OUR side is real:
 * the consent gate, the payment intent written to the database, the request body
 * the button sends, and the browser redirect to whatever URL comes back.
 * Cancel/resume lifecycle lives in 08-subscription-lifecycle.spec.ts.
 */

import { expect, type Page } from '@playwright/test';
import { test } from '../fixtures/test';
import { dismissCookieBanner } from '../utils/test-user-factory';

/**
 * Answer a Supabase edge function that opens a Stripe Checkout session with a
 * canned hosted-checkout URL, and swallow the navigation to that URL so no
 * request leaves the runner. Resolves with the JSON body the page POSTed, so
 * the caller can assert what the button asked for.
 */
async function stubStripeCheckout(
  page: Page,
  functionName: 'create-stripe-checkout' | 'create-stripe-subscription'
): Promise<() => Promise<Record<string, unknown>>> {
  const checkoutUrl = `https://checkout.stripe.com/c/pay/cs_test_stub_${functionName}`;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  let resolveBody: (body: Record<string, unknown>) => void = () => {};
  const bodySeen = new Promise<Record<string, unknown>>((resolve) => {
    resolveBody = resolve;
  });

  await page.route(`**/functions/v1/${functionName}`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    resolveBody(request.postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ url: checkoutUrl }),
    });
  });
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Stripe Checkout (stub)</title>',
    })
  );
  return () => bodySeen;
}

test.describe('Stripe One-Time Payment Flow', () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    // storage-state-auth.json already carries a valid Supabase session.
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

  // The edge function that opens the hosted Checkout session is stubbed (see
  // the header); the intent insert, request body and redirect are real.
  test('should complete one-time payment successfully', async ({ page }) => {
    const checkoutRequest = await stubStripeCheckout(
      page,
      'create-stripe-checkout'
    );

    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    // /payment-demo renders THREE PaymentButton instances (one-time $20,
    // subscribe $9.99/mo, PayPal $15), each with its own Stripe/PayPal tablist,
    // so bare role locators are strict-mode violations. The one-time instance
    // renders first; its pay button's accessible name is unique.
    await page
      .getByRole('tab', { name: /stripe/i })
      .first()
      .click();
    await page.getByRole('button', { name: 'Pay $20.00 (One-Time)' }).click();

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    // The button wrote a real payment intent first and asked for a session for it.
    expect((await checkoutRequest()).payment_intent_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  // Subscription leg (#105): usePaymentButton routes type="recurring" through
  // createSubscriptionCheckout → create-stripe-subscription (mode=subscription).
  //
  // The server resolves the price from `products.stripe_price_id` for the SKU
  // the button names (#772), and all three recurring SKUs are `active = false`
  // until #772 and #559 close, so the real function would answer "product not
  // found". That is a server-side state this test does not exercise: the edge
  // function is stubbed (see the header), so what is asserted is the client's
  // half: the button names the SKU (never an amount) and follows the URL back.
  test('should redirect to subscription-mode Stripe Checkout', async ({
    page,
  }) => {
    const subscriptionRequest = await stubStripeCheckout(
      page,
      'create-stripe-subscription'
    );

    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    // Scope to the Subscribe PaymentButton instance — three instances render
    // their own Stripe tabs (see the strict-mode note in the one-time test).
    // Name follows the demo page's button, which now says which SKU it buys
    // rather than an amount the recurring path never charged (#772).
    const subscribeButton = page.getByRole('button', {
      name: 'Subscribe to Care Plan',
    });
    const container = page
      .locator('div.flex.flex-col.gap-4')
      .filter({ has: subscribeButton })
      .last();
    await container.getByRole('tab', { name: /stripe/i }).click();
    await subscribeButton.click();

    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    const body = await subscriptionRequest();
    expect(body.product_id).toBe('svc-care');
    expect(body).not.toHaveProperty('amount');
  });

  test('should handle payment cancellation gracefully', async ({ page }) => {
    // Stripe's cancel_url (create-stripe-checkout) is
    // /payment-result?status=cancelled, with no id: nothing failed, nothing was
    // charged, and the page must say so and offer the way back.
    await page.goto('/payment-result?status=cancelled');
    await dismissCookieBanner(page);

    await expect(page.getByText('Checkout cancelled')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/you were not charged/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to pricing' })
    ).toBeVisible();
  });

  // "should display error for declined card" was an empty placeholder. A decline
  // happens on Stripe's hosted page; our half is the failed-payment screen the
  // webhook's `failed` result produces, which 03-failed-payment-retry.spec.ts
  // drives from a seeded card_declined result: "should display user-friendly
  // error messages" (copy shown, raw provider text hidden).

  test('should enforce payment consent requirement', async ({ page }) => {
    // The GDPR consent section should be visible first
    await expect(
      page.getByRole('heading', { name: /GDPR Consent/i })
    ).toBeVisible();

    // Payment buttons should not be visible until consent is granted
    // (they're in Step 2 which is hidden until Step 1 consent is completed)
    const step2 = page.getByRole('heading', { name: /Step 2/i });
    await expect(step2).not.toBeVisible();
  });

  test('should show payment options after granting consent', async ({
    page,
  }) => {
    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();

    // Wait for Step 2 to appear
    await expect(page.getByRole('heading', { name: /Step 2/i })).toBeVisible({
      timeout: 5000,
    });

    // Provider tabs should be visible (use .first() as there are multiple payment sections)
    await expect(
      page.getByRole('tab', { name: /stripe/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: /paypal/i }).first()
    ).toBeVisible();

    // Payment buttons should be visible (but may be disabled without API keys)
    await expect(
      page.getByRole('button', { name: /Pay \$20\.00/i })
    ).toBeVisible();
  });

  test('should allow selecting different payment providers', async ({
    page,
  }) => {
    // Grant consent
    await page.getByRole('button', { name: /Accept/i }).click();
    await page
      .getByRole('heading', { name: /Step 2/i })
      .waitFor({ timeout: 5000 });

    // Select Stripe tab
    const stripeTab = page.getByRole('tab', { name: /stripe/i }).first();
    await stripeTab.click();
    await expect(stripeTab).toHaveClass(/tab-active/);

    // Select PayPal tab
    const paypalTab = page.getByRole('tab', { name: /paypal/i }).first();
    await paypalTab.click();
    await expect(paypalTab).toHaveClass(/tab-active/);
  });

  // "should show offline queue indicator when offline" was an empty placeholder
  // that claimed the offline queue was not implemented. It is: the queue panel
  // and its Offline badge ship, and 05-offline-queue.spec.ts "should show queued
  // items and the Offline badge when offline" seeds a queued payment, goes
  // offline and asserts the badge and the listed item.
});

/**
 * Network-boundary stubs for the payment specs.
 *
 * Our own code is real in these tests: the consent gate, the rows in the
 * database, the request each button sends, and what the page does with the
 * answer. Only the two things CI cannot reach are replaced: a Supabase Edge
 * Function that would call Stripe or PayPal, and PayPal's own button script.
 * Each helper hands back what the page sent, so the test can assert the
 * request was the right one.
 */

import type { BrowserContext, Page } from '@playwright/test';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export interface StubbedRequest {
  body: Record<string, unknown>;
  authorization: string | undefined;
}

/**
 * Answer one Supabase Edge Function with a canned reply. Resolves with the
 * first request the page sends to it (JSON body plus the Authorization header).
 */
export async function stubEdgeFunction(
  target: Page | BrowserContext,
  functionName: string,
  reply: { status?: number; json: Record<string, unknown> }
): Promise<() => Promise<StubbedRequest>> {
  let resolveRequest: (request: StubbedRequest) => void = () => {};
  const requestSeen = new Promise<StubbedRequest>((resolve) => {
    resolveRequest = resolve;
  });

  await target.route(`**/functions/v1/${functionName}`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    resolveRequest({
      body: request.postDataJSON() as Record<string, unknown>,
      authorization: request.headers()['authorization'],
    });
    await route.fulfill({
      status: reply.status ?? 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify(reply.json),
    });
  });
  return () => requestSeen;
}

/**
 * Put a stand-in for PayPal's button script on the page before it loads.
 * `loadPayPalSDK` returns early when `window.paypal` already exists, so no
 * request leaves the runner. The stand-in draws one button; pressing it runs
 * the page's own `createSubscription` / `createOrder` and then `onApprove`,
 * the same order PayPal's popup would, and reports a failure to `onError`.
 */
export async function installFakePayPalSdk(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type ButtonConfig = {
      createSubscription?: () => Promise<string>;
      createOrder?: () => Promise<string>;
      onApprove: (data: Record<string, string>) => void;
      onError: (error: unknown) => void;
    };
    (window as unknown as { paypal: unknown }).paypal = {
      Buttons: (config: ButtonConfig) => ({
        render: (selector: string) => {
          const host = document.querySelector(selector);
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Stand-in PayPal checkout';
          button.addEventListener('click', async () => {
            try {
              if (config.createSubscription) {
                const subscriptionID = await config.createSubscription();
                config.onApprove({ subscriptionID });
              } else if (config.createOrder) {
                const orderID = await config.createOrder();
                config.onApprove({ orderID });
              }
            } catch (error) {
              config.onError(error);
            }
          });
          host?.appendChild(button);
        },
      }),
    };
  });
}

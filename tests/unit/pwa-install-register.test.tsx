/**
 * PWAInstall must register the service worker at ONE stable address.
 *
 * It used to register `${swPath}?v=${Date.now()}`, a new address on every page load. The
 * browser treats each address as a different worker script, so every load restarted install,
 * skipWaiting and clients.claim, although it already re-fetches the script and installs it
 * only when the bytes changed. SpokeToWork traced a WebKit "internal error" to that window.
 *
 * This renders the real component twice (two page loads) against a fake
 * `navigator.serviceWorker` and asserts both calls used the same address, with no query
 * string. With the timestamp code restored, the two addresses differ and the test fails.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackPWAEvent: vi.fn() }),
}));

import PWAInstall from '@/components/PWAInstall';
import { projectConfig } from '@/config/project.config';

describe('PWAInstall service worker registration', () => {
  const register = vi.fn();
  const original = Object.getOwnPropertyDescriptor(
    window.navigator,
    'serviceWorker'
  );

  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });
    vi.stubEnv('NODE_ENV', 'development');
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (original) {
      Object.defineProperty(window.navigator, 'serviceWorker', original);
    } else {
      delete (window.navigator as unknown as Record<string, unknown>)
        .serviceWorker;
    }
  });

  it('registers the plain swPath, with no query string', () => {
    render(<PWAInstall />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(projectConfig.swPath);
  });

  it('uses the same address on a second page load', async () => {
    const first = render(<PWAInstall />);
    first.unmount();
    // Let the clock move so a Date.now() suffix would differ between the loads.
    await new Promise((resolve) => setTimeout(resolve, 5));
    render(<PWAInstall />);

    expect(register).toHaveBeenCalledTimes(2);
    expect(register.mock.calls[0][0]).toBe(register.mock.calls[1][0]);
  });
});

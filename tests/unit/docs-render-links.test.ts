import { describe, it, expect } from 'vitest';
import { rewriteRepoLinks } from '@/lib/docs/render';

const REPO = 'https://github.com/example/fork';

// Why these exist: the /docs pages are markdown written for GitHub, where
// `docs/FORKING.md` sits next to the reader. Served from /docs/<slug>/ the same
// relative href 404s, and the link crawl in broken-links.spec.ts found 40.
describe('rewriteRepoLinks', () => {
  it('sends a relative repo file to GitHub, resolved from the source folder', () => {
    const out = rewriteRepoLinks(
      '<p><a href="docs/FORKING.md">Forking</a></p>',
      'README.md',
      REPO
    );
    expect(out).toContain(`href="${REPO}/blob/main/docs/FORKING.md"`);
  });

  it('resolves against the source file folder, not the site root', () => {
    const out = rewriteRepoLinks(
      '<a href="architecture-detailed.png">diagram</a>',
      'docs/architecture/README.md',
      REPO
    );
    expect(out).toContain(
      `href="${REPO}/blob/main/docs/architecture/architecture-detailed.png"`
    );
  });

  it('keeps the #fragment on a rewritten link', () => {
    const out = rewriteRepoLinks(
      '<a href="docs/AUTH-SETUP.md#setup">x</a>',
      'README.md',
      REPO
    );
    // AUTH-SETUP.md is a rendered page, so it becomes the served route
    expect(out).toContain('href="/docs/auth-and-sessions/#setup"');
  });

  it('points at the served /docs page when the target is a rendered doc', () => {
    const out = rewriteRepoLinks(
      '<a href="docs/ACCESSIBILITY.md">a11y</a>',
      'README.md',
      REPO
    );
    expect(out).toContain('href="/docs/accessibility/"');
  });

  it('leaves anchors, absolute URLs, mailto and site-rooted paths alone', () => {
    const html = [
      '<a href="#install">a</a>',
      '<a href="https://example.com/x.md">b</a>',
      '<a href="mailto:a@b.co">c</a>',
      '<a href="/blog/">d</a>',
    ].join('');
    expect(rewriteRepoLinks(html, 'README.md', REPO)).toBe(html);
  });

  it('leaves a link that climbs out of the repo alone', () => {
    const html = '<a href="../../outside.md">x</a>';
    expect(rewriteRepoLinks(html, 'README.md', REPO)).toBe(html);
  });
});

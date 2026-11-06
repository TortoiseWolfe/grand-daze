import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blogRouteInstances,
  firstBlogTablePostPath,
  readBlogPosts,
  requireFirstBlogPostPath,
} from '../e2e/utils/blog-fixtures';

/**
 * The e2e specs read their blog slugs and tags through this helper instead of hard-coding
 * the template's (#11), so the helper has to be right about what the build would publish.
 */
describe('blog fixtures for the e2e specs', () => {
  let dir: string;

  const post = (file: string, front: string, body = 'Body.\n') =>
    writeFileSync(join(dir, file), `---\n${front}\n---\n${body}`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'blog-fixtures-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the slug from the frontmatter and falls back to the title', () => {
    post('a.md', 'title: "Has a slug"\nslug: custom-slug\ndate: 2026-01-02');
    post('b.md', 'title: "Hello, World!"\ndate: 2026-01-01');

    expect(readBlogPosts(dir).map((p) => p.slug)).toEqual([
      'custom-slug',
      'hello-world',
    ]);
  });

  it('orders newest first and breaks a date tie by slug', () => {
    post('x.md', 'title: Old\ndate: 2025-01-01');
    post('y.md', 'title: Beta\ndate: 2026-01-01');
    post('z.md', 'title: Alpha\ndate: 2026-01-01');

    expect(readBlogPosts(dir).map((p) => p.slug)).toEqual([
      'alpha',
      'beta',
      'old',
    ]);
  });

  it('lower-cases tags the way the tag route does', () => {
    post('a.md', 'title: A\ndate: 2026-01-01\ntags: ["Digital-Twin", "SEO"]');

    expect(readBlogPosts(dir)[0].tags).toEqual(['digital-twin', 'seo']);
  });

  it('ignores CLAUDE.md and files that are not markdown', () => {
    post('CLAUDE.md', 'title: Not a post\ndate: 2026-01-01');
    writeFileSync(join(dir, 'notes.txt'), 'title: nope');

    expect(readBlogPosts(dir)).toEqual([]);
  });

  it('returns no posts for a folder that does not exist', () => {
    expect(readBlogPosts(join(dir, 'missing'))).toEqual([]);
  });

  it('detects a markdown table and not a lone rule or a pipe in prose', () => {
    post(
      'table.md',
      'title: Table\ndate: 2026-02-01',
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    );
    post(
      'prose.md',
      'title: Prose\ndate: 2026-01-01',
      'Use a | b to pipe.\n\n---\n\nDone.\n'
    );

    const posts = readBlogPosts(dir);
    expect(posts.find((p) => p.slug === 'table')?.hasTable).toBe(true);
    expect(posts.find((p) => p.slug === 'prose')?.hasTable).toBe(false);
    expect(firstBlogTablePostPath(posts)).toBe('/blog/table');
  });

  it('gives a route instance for each dynamic blog route that has content', () => {
    post('a.md', 'title: A\ndate: 2026-01-01\ntags: ["Zebra", "apple"]');

    expect(blogRouteInstances(readBlogPosts(dir))).toEqual({
      instances: {
        '/blog/[slug]': '/blog/a',
        '/blog/tags/[tag]': '/blog/tags/apple',
      },
      excluded: {},
    });
  });

  it('excludes a route, with a reason, rather than inventing an address', () => {
    post('a.md', 'title: A\ndate: 2026-01-01');

    const { instances, excluded } = blogRouteInstances(readBlogPosts(dir));
    expect(Object.keys(instances)).toEqual(['/blog/[slug]']);
    expect(excluded['/blog/tags/[tag]']).toMatch(/no post .* tag/);

    const none = blogRouteInstances([]);
    expect(none.instances).toEqual({});
    expect(Object.keys(none.excluded).sort()).toEqual([
      '/blog/[slug]',
      '/blog/tags/[tag]',
    ]);
  });

  it('refuses to guess a post when the site has none', () => {
    expect(() => requireFirstBlogPostPath([])).toThrow(/no published post/);
  });

  it('finds at least one post in this repo, so the specs have something to measure', () => {
    expect(readBlogPosts().length).toBeGreaterThan(0);
  });
});

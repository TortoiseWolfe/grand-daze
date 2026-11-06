import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/**
 * Real blog content for the specs that need "a post" or "a tag", read from the
 * markdown the build itself reads (`public/blog/*.md`).
 *
 * WHY THIS EXISTS (#11). Six specs hard-coded slugs from the template's own posts
 * (`playable-city-chattanooga`, `countdown-timer-tutorial`, tag `digital-twin`).
 * `scripts/rebrand.sh` deletes every template post and keeps only `hello-world`, so in
 * this fork each of those addresses was a 404 and the specs failed as "the page did not
 * render" — a finding about the fixture, reported as a finding about the product.
 *
 * Reading the markdown (never `blog-data.json`) matters: that file is a build OUTPUT,
 * and importing an output type-checks locally and fails on a fresh checkout.
 */

export interface BlogFixturePost {
  slug: string;
  /** Lower-cased, the way `blog/tags/[tag]` builds its static params. */
  tags: string[];
  date: string;
  /** True when the body has a markdown table (a header row over a `---|---` rule). */
  hasTable: boolean;
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;

const DEFAULT_DIR = join(__dirname, '..', '..', '..', 'public', 'blog');

/** Same fallback as `scripts/generate-blog-data.js` generateSlug(). */
function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Published posts, newest first, slug as the tie-breaker (the order the build uses). */
export function readBlogPosts(dir: string = DEFAULT_DIR): BlogFixturePost[] {
  if (!existsSync(dir)) return [];

  const posts: BlogFixturePost[] = [];
  for (const file of readdirSync(dir)) {
    // CLAUDE.md sits beside the posts and is documentation, not a post.
    if (!file.endsWith('.md') || file === 'CLAUDE.md') continue;

    const { data, content } = matter(readFileSync(join(dir, file), 'utf8'));
    const title = typeof data.title === 'string' ? data.title : '';
    const slug =
      typeof data.slug === 'string' && data.slug
        ? data.slug
        : slugFromTitle(title);
    if (!slug) continue;

    const tags = Array.isArray(data.tags)
      ? data.tags.map((t: unknown) => String(t).toLowerCase())
      : [];
    const date =
      data.date instanceof Date
        ? data.date.toISOString()
        : String(data.date ?? '');
    posts.push({ slug, tags, date, hasTable: TABLE_RULE.test(content) });
  }

  return posts.sort(
    (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
  );
}

export function blogPostPaths(posts: BlogFixturePost[]): string[] {
  return posts.map((p) => `/blog/${p.slug}`);
}

export function firstBlogPostPath(posts: BlogFixturePost[]): string | null {
  return posts.length ? `/blog/${posts[0].slug}` : null;
}

/**
 * For specs that need one post to exist. Throws rather than falling back to a made-up
 * slug: a fallback would turn "this site has no posts" back into a 404 on a guessed
 * address, which is the #11 failure this file replaces.
 */
export function requireFirstBlogPostPath(
  posts: BlogFixturePost[] = readBlogPosts()
): string {
  const path = firstBlogPostPath(posts);
  if (!path) {
    throw new Error(
      'public/blog holds no published post, and this spec needs one to measure. ' +
        'Add a post, or exclude the spec with a printed reason.'
    );
  }
  return path;
}

/** First post whose body has a markdown table, or null when the site has none. */
export function firstBlogTablePostPath(
  posts: BlogFixturePost[] = readBlogPosts()
): string | null {
  const post = posts.find((p) => p.hasTable);
  return post ? `/blog/${post.slug}` : null;
}

export function firstBlogTagPath(posts: BlogFixturePost[]): string | null {
  const tag = posts.flatMap((p) => p.tags).sort()[0];
  return tag ? `/blog/tags/${encodeURIComponent(tag)}` : null;
}

/**
 * The two dynamic blog routes, as route-sweep specs need them: a real address for each,
 * or an EXCLUDED reason when this site has no content to build one from. The reason is
 * printed by the specs every run, so a fork that deletes its last post loses the
 * coverage visibly rather than failing on a 404.
 */
export function blogRouteInstances(posts: BlogFixturePost[]): {
  instances: Record<string, string>;
  excluded: Record<string, string>;
} {
  const instances: Record<string, string> = {};
  const excluded: Record<string, string> = {};

  const post = firstBlogPostPath(posts);
  if (post) instances['/blog/[slug]'] = post;
  else excluded['/blog/[slug]'] = 'public/blog holds no published post';

  const tag = firstBlogTagPath(posts);
  if (tag) instances['/blog/tags/[tag]'] = tag;
  else excluded['/blog/tags/[tag]'] = 'no post in public/blog declares a tag';

  return { instances, excluded };
}

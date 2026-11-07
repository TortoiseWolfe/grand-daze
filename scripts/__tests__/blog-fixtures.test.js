const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyBlogFixtures } = require('../ci/apply-blog-fixtures.cjs');

const REPO = path.join(__dirname, '..', '..');
const WORKFLOWS = path.join(REPO, '.github', 'workflows');
const SLUGS = [
  'component-generator-tutorial',
  'review-without-rewriting',
  'scoped-tokens-for-automation',
];

function post(title, date) {
  return `---\ntitle: ${title}\ndate: ${date}\n---\n\n# ${title}\n\nBody of ${title}.\n`;
}

/** A throwaway checkout with the live site's one post and the fixtures. */
function makeCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grand-daze-fixtures-'));
  fs.mkdirSync(path.join(root, 'public', 'blog'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'public', 'blog', 'hello-world.md'),
    post('Hello World', '2026-01-01')
  );
  fs.mkdirSync(path.join(root, 'tests', 'fixtures', 'blog'), {
    recursive: true,
  });
  for (const slug of SLUGS) {
    fs.writeFileSync(
      path.join(root, 'tests', 'fixtures', 'blog', `${slug}.md`),
      post(slug, '2026-02-01')
    );
    const images = path.join(root, 'tests', 'fixtures', 'blog-images', slug);
    fs.mkdirSync(images, { recursive: true });
    fs.writeFileSync(path.join(images, 'featured.svg'), '<svg/>');
  }
  return root;
}

async function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

const dataFile = (root) =>
  path.join(root, 'src', 'lib', 'blog', 'blog-data.json');

test('flag unset: does nothing, the live site keeps one post', async () => {
  const root = makeCheckout();
  const result = await quietly(() => applyBlogFixtures({ root, env: {} }));
  assert.equal(result.applied, false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'public', 'blog')), [
    'hello-world.md',
  ]);
  assert.equal(fs.existsSync(path.join(root, 'public', 'blog-images')), false);
  assert.equal(fs.existsSync(dataFile(root)), false);
});

test('flag set to anything but "true": still does nothing', async () => {
  const root = makeCheckout();
  const result = await quietly(() =>
    applyBlogFixtures({ root, env: { E2E_BLOG_FIXTURES: '1' } })
  );
  assert.equal(result.applied, false);
  assert.equal(fs.existsSync(dataFile(root)), false);
});

test('flag "true": the three fixtures and their images join the one post', async () => {
  const root = makeCheckout();
  const result = await quietly(() =>
    applyBlogFixtures({ root, env: { E2E_BLOG_FIXTURES: 'true' } })
  );
  assert.equal(result.applied, true);
  const data = JSON.parse(fs.readFileSync(dataFile(root), 'utf8'));
  assert.equal(data.count, 4);
  assert.deepEqual(
    data.posts.map((p) => p.slug).sort(),
    [...SLUGS, 'hello-world'].sort()
  );
  for (const slug of SLUGS) {
    assert.ok(
      fs.existsSync(
        path.join(root, 'public', 'blog-images', slug, 'featured.svg')
      ),
      `${slug} image was copied`
    );
  }
});

test('the real fixtures exist and the live blog dir holds no fixture post', () => {
  for (const slug of SLUGS) {
    assert.ok(
      fs.existsSync(path.join(REPO, 'tests', 'fixtures', 'blog', `${slug}.md`)),
      `${slug}.md is a fixture`
    );
    assert.equal(
      fs.existsSync(path.join(REPO, 'public', 'blog', `${slug}.md`)),
      false,
      `${slug}.md must not sit in public/blog`
    );
    assert.equal(
      fs.existsSync(path.join(REPO, 'public', 'blog-images', slug)),
      false,
      `${slug} images must not sit in public/blog-images`
    );
  }
});

test('only the two E2E workflows set the flag, and they set it before pnpm build', () => {
  const withFlag = fs
    .readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) =>
      fs
        .readFileSync(path.join(WORKFLOWS, f), 'utf8')
        .includes('E2E_BLOG_FIXTURES')
    )
    .sort();
  assert.deepEqual(withFlag, ['e2e-local.yml', 'e2e.yml']);

  for (const file of withFlag) {
    const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    const flag = text.indexOf("E2E_BLOG_FIXTURES: 'true'");
    const load = text.indexOf('node scripts/ci/apply-blog-fixtures.cjs');
    const build = text.indexOf('run: pnpm build');
    assert.ok(flag > 0 && load > 0 && build > 0, `${file} has all three`);
    assert.ok(load < build, `${file} loads the fixtures before pnpm build`);
    assert.ok(flag < build, `${file} sets the flag before pnpm build`);
  }
});

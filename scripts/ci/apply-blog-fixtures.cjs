#!/usr/bin/env node

/**
 * Load the blog test fixtures into a CI checkout, for the E2E builds only.
 *
 * The browser specs for blog rendering need posts that have tables, quotes, code and
 * collapsible sections. The live site has one post (hello-world), so those posts are
 * kept under tests/fixtures/ and never ship. The two E2E workflows run this script
 * before `pnpm build` with E2E_BLOG_FIXTURES=true. With the flag unset (the deploy
 * build, local builds, every other workflow) it does nothing at all.
 *
 * When the flag is set it copies the fixture posts into public/blog/, the fixture
 * images into public/blog-images/, and regenerates src/lib/blog/blog-data.json so the
 * pages, the sitemap and the feed see them. It changes the CI checkout only; nothing
 * is committed from there.
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateBlogData } = require('../generate-blog-data');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

async function applyBlogFixtures({
  root = process.cwd(),
  env = process.env,
} = {}) {
  if (env.E2E_BLOG_FIXTURES !== 'true') {
    console.log('E2E_BLOG_FIXTURES is not "true": blog fixtures not loaded.');
    return { applied: false };
  }

  const fixtures = path.join(root, 'tests', 'fixtures');
  const blogDir = path.join(root, 'public', 'blog');
  const imagesDir = path.join(root, 'public', 'blog-images');
  const outputDir = path.join(root, 'src', 'lib', 'blog');

  fs.mkdirSync(blogDir, { recursive: true });
  for (const file of fs.readdirSync(path.join(fixtures, 'blog'))) {
    if (file.endsWith('.md')) {
      fs.copyFileSync(
        path.join(fixtures, 'blog', file),
        path.join(blogDir, file)
      );
    }
  }
  copyDir(path.join(fixtures, 'blog-images'), imagesDir);

  const output = await generateBlogData({
    blogDir,
    outputDir,
    outputFile: path.join(outputDir, 'blog-data.json'),
  });
  return { applied: true, count: output ? output.count : 0 };
}

if (require.main === module) {
  applyBlogFixtures().catch((error) => {
    console.error('Could not load the blog fixtures:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { applyBlogFixtures };

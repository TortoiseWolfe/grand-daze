/**
 * Guards the root-anchored E2E build.
 *
 * The Signup Mailer E2E job runs `node scripts/detect-project.js` once WITHOUT
 * DISABLE_BASE_PATH, which writes NEXT_PUBLIC_BASE_PATH=/<repo> into the local
 * env file. The later `pnpm build` has DISABLE_BASE_PATH=true, but Next loads
 * that file first, so next.config.ts must check the flag before it reads the
 * variable. If it does not, every script URL gets the /<repo> prefix,
 * `serve out` answers 404 for all of them, React never hydrates, and every E2E
 * test fails.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'next.config.ts'),
  'utf8'
);

test('next.config.ts checks DISABLE_BASE_PATH before it reads NEXT_PUBLIC_BASE_PATH', () => {
  const flag = source.indexOf("process.env.DISABLE_BASE_PATH === 'true'");
  const envRead = source.indexOf('process.env.NEXT_PUBLIC_BASE_PATH');
  assert.ok(flag !== -1, 'next.config.ts does not look at DISABLE_BASE_PATH');
  assert.ok(
    envRead !== -1,
    'next.config.ts no longer reads NEXT_PUBLIC_BASE_PATH'
  );
  assert.ok(
    flag < envRead,
    'DISABLE_BASE_PATH must be checked before NEXT_PUBLIC_BASE_PATH'
  );
});

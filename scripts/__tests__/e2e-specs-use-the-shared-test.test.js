/**
 * Every E2E file imports `test` from the shared fixture, never from `@playwright/test` (#28).
 *
 * WHY. `tests/e2e/fixtures/test.ts` makes each `page.goto()` and `page.reload()` let the
 * page being left finish its own loads first. Without it, WebKit cancels the old page's
 * in-flight requests and then sometimes fails to load the next page ("WebKit encountered an
 * internal error", or a `<main>` that stays empty). That made required checks flaky, and
 * the fix has to live in ONE place: a spec that imports `test` straight from Playwright
 * opts out without anyone noticing, and the flake comes back in exactly that file.
 *
 * WHAT THIS CHECKS. Under `tests/e2e`, no file other than the fixture itself imports the
 * VALUE `test` (including `test as setup`) from `@playwright/test`. Type-only imports,
 * `expect`, `devices` and the rest are fine.
 *
 * WHAT IT CANNOT CHECK. A file that reaches `test` some other way (a `require`, a re-export
 * from a third module). The scan also reports how many files it read and how many import
 * the shared fixture, so a scan that reads nothing cannot pass for a clean one.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const E2E = path.join(ROOT, 'tests', 'e2e');
const FIXTURE = path.join(E2E, 'fixtures', 'test.ts');

function tsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Import statements from Playwright, joined across lines so a multi-line import is seen. */
const PLAYWRIGHT_IMPORT =
  /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/g;

/** True when the import brings in the value `test`, bare or renamed. */
function importsTestValue(source) {
  for (const m of source.matchAll(PLAYWRIGHT_IMPORT)) {
    if (m[1]) continue; // `import type { ... }`
    const names = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.some((n) => n === 'test' || n.startsWith('test as ')))
      return true;
  }
  return false;
}

const SHARED_IMPORT = /from\s+['"]\.[./]*\/fixtures\/test['"]/;

describe('E2E files take `test` from the shared fixture (#28)', () => {
  const files = tsFiles(E2E).filter((f) => f !== FIXTURE);

  it('reads the suite and finds it using the shared fixture', () => {
    assert.ok(
      files.length > 50,
      `expected to read the suite, read ${files.length}`
    );
    const users = files.filter((f) =>
      SHARED_IMPORT.test(fs.readFileSync(f, 'utf8'))
    );
    assert.ok(
      users.length > 50,
      `expected most specs to import the shared fixture, found ${users.length}. ` +
        'Zero offences below would prove nothing if the scan cannot see them.'
    );
  });

  it('no file imports `test` straight from @playwright/test', () => {
    const offenders = files
      .filter((f) => importsTestValue(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));
    assert.deepStrictEqual(
      offenders,
      [],
      'These files import `test` from @playwright/test, which skips the settle-before-' +
        'navigating wrapper. Import it from the shared fixture instead, e.g.\n\n' +
        "    import { test } from '../fixtures/test';\n"
    );
  });

  it('can fail: the matcher sees a direct import in each shape the suite uses', () => {
    assert.ok(
      importsTestValue("import { test, expect } from '@playwright/test';")
    );
    assert.ok(
      importsTestValue("import { test as setup } from '@playwright/test';")
    );
    assert.ok(
      importsTestValue(
        "import {\n  expect,\n  test,\n} from '@playwright/test';"
      )
    );
    assert.ok(!importsTestValue("import { expect } from '@playwright/test';"));
    assert.ok(
      !importsTestValue("import type { test } from '@playwright/test';")
    );
  });
});

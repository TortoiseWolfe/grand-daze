/**
 * A NEW PROJECT'S SCHEDULED MONITORS MUST NOT BE RED FOR ASKING ABOUT
 * INFRASTRUCTURE IT DOES NOT HAVE (#985).
 *
 * This repository was created from the ScriptHammer template before the template learned
 * to skip what a fork has not configured, and kept the older workflows. With no Supabase
 * project, no Resend account and no live domain, six scheduled workflows failed every
 * day: Prod Schema Drift, Auth Config Drift, Data Retention, Supabase Keep-Alive, Email
 * Health and Production Smoke. Prod Schema Drift also carried a hardcoded fallback to
 * ScriptHammer's own production project ref.
 *
 * Failing is the wrong signal for "not configured yet". It teaches that red checks are
 * normal, which is the state in which the next real failure is ignored.
 *
 * WHAT THIS PINS, and the shape matters more than any one line:
 *
 *   1. Each gate exists and is wired to the job or step it gates.
 *   2. HALF-CONFIGURED STILL FAILS wherever a credential comes in a pair. Skipping on
 *      "anything missing" would mean deleting a token silently retires a daily gate --
 *      a protection going quiet is precisely what these workflows exist to catch.
 *   3. No workflow carries a hardcoded fallback to another project's Supabase ref.
 *   4. Every skip says what to set.
 *
 * WHY THE SOURCE IS COMMENT-STRIPPED FIRST. A guard that greps a file matches its own
 * explanatory prose and passes with the code deleted.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/** Full-line `#` comments only — an inline one is attached to real syntax. */
function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function body(name) {
  return stripComments(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8'));
}

/** The lines of one job, from its key to the next key at the same indent. */
function job(src, name) {
  const start = src.search(new RegExp(`^  ${name}:$`, 'm'));
  assert.notStrictEqual(start, -1, `no job "${name}"`);
  const rest = src.slice(start).split('\n').slice(1);
  const end = rest.findIndex((line) => /^  \S/.test(line));
  return [`  ${name}:`, ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

/** The lines of one `- name:` step, from its dash to the next step at that indent. */
function step(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex((line) =>
    line.trim().startsWith(`- name: ${name}`)
  );
  assert.notStrictEqual(start, -1, `no step "${name}"`);
  const indent = lines[start].search(/\S/);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line) => line.trim().startsWith('- ') && line.search(/\S/) <= indent
  );
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}

describe('an unprovisioned project skips what it has not configured (#985)', () => {
  // NON-VACUITY. Every assertion below is over text these helpers return. If the
  // slicing breaks they all pass against nothing, which is the shape this file exists
  // to prevent — and the shape #934 shipped as a green required check.
  it('reads all six workflows and finds the jobs it is about', () => {
    assert.match(job(body('auth-config-drift.yml'), 'drift'), /runs-on:/);
    assert.match(job(body('prod-schema-drift.yml'), 'drift'), /runs-on:/);
    assert.match(job(body('email-health.yml'), 'bounce-rate'), /runs-on:/);
    assert.match(job(body('data-retention.yml'), 'audit-logs'), /runs-on:/);
    assert.match(job(body('supabase-keepalive.yml'), 'keepalive'), /runs-on:/);
    assert.match(job(body('smoke.yml'), 'smoke'), /runs-on:/);
  });

  describe('Auth Config Drift', () => {
    const src = () => body('auth-config-drift.yml');

    it('the preflight publishes an output, because a secret cannot be read in a job-level if:', () => {
      const changes = job(src(), 'changes');
      assert.match(
        changes,
        /configured:\s*\$\{\{\s*steps\.configured\.outputs\.configured\s*\}\}/
      );
      const preflight = step(changes, 'Is a Supabase project configured?');
      assert.match(
        preflight,
        /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN/
      );
      assert.match(
        preflight,
        /SUPABASE_PROJECT_REF:\s*\$\{\{\s*vars\.SUPABASE_PROJECT_REF/
      );
    });

    it('the drift job runs only when a project is configured', () => {
      assert.match(
        job(src(), 'drift'),
        /needs\.changes\.outputs\.configured\s*==\s*'true'/
      );
    });

    it('half-configured FAILS rather than skipping', () => {
      const preflight = step(
        job(src(), 'changes'),
        'Is a Supabase project configured?'
      );
      assert.match(preflight, /exit 1/, 'the half-configured branch must fail');
      assert.match(preflight, /missing repository VARIABLE/);
      assert.match(preflight, /missing repository SECRET/);
    });

    it('the required aggregate reports green when unconfigured, and red when the preflight failed', () => {
      const result = job(src(), 'result');
      assert.match(result, /if:\s*always\(\)/);
      assert.match(result, /CONFIGURED.*!=.*true/s);
      assert.match(
        result,
        /needs\.changes\.result\s*\}\}"\s*!=\s*"success"/,
        'a failed preflight must not be laundered into green by the skip branch'
      );
    });
  });

  describe('Prod Schema Drift', () => {
    const src = () => body('prod-schema-drift.yml');

    it('carries no hardcoded fallback to this project', () => {
      // Checked against the comment-stripped body on purpose: the paragraph that
      // explains the removal is still in the file, and would satisfy a naive grep.
      assert.doesNotMatch(
        src(),
        /vars\.SUPABASE_PROJECT_REF\s*\|\|/,
        'a fork must not interrogate the template owner’s database'
      );
    });

    it('EVERY step that reaches production is gated on the preflight', () => {
      // Derived from the workflow, not a list kept in step with it by memory: any step
      // carrying the production token must carry the gate, so a second detector added
      // later cannot go in ungated.
      const text = src();
      const named = [...text.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) =>
        m[1].trim()
      );
      const reaching = named.filter((n) => {
        const body_ = step(text, n);
        // The preflight reads the token too -- that is how it decides. It DEFINES the gate,
        // so it cannot consume it; excluded by the id it sets rather than by its name.
        return (
          /SUPABASE_ACCESS_TOKEN/.test(body_) &&
          !/id:\s*configured\b/.test(body_)
        );
      });
      assert.ok(
        reaching.length >= 1,
        `expected at least one step reading production, found ${reaching.length}`
      );
      for (const n of reaching) {
        assert.match(
          step(text, n),
          /if:.*steps\.configured\.outputs\.configured\s*==\s*'true'/,
          `"${n}" reads production but is not gated on the preflight`
        );
      }
    });

    it('half-configured FAILS rather than skipping', () => {
      assert.match(step(src(), 'Is a Supabase project configured?'), /exit 1/);
    });
  });

  describe('Email Health', () => {
    const src = () => body('email-health.yml');

    it('the bounce-rate check is gated on a configured sender', () => {
      assert.match(
        step(src(), 'Check bounce rate against Resend'),
        /if:\s*steps\.configured\.outputs\.configured\s*==\s*'true'/
      );
      assert.match(
        step(src(), 'Is a sending account configured?'),
        /RESEND_API_KEY:\s*\$\{\{\s*secrets\.RESEND_API_KEY/
      );
    });
  });

  describe('Data Retention', () => {
    const src = () => body('data-retention.yml');

    it('EVERY step after the preflight is gated on it', () => {
      const text = src();
      const names = [...text.matchAll(/^\s*- name:\s*(.+)$/gm)].map((m) =>
        m[1].trim()
      );
      const gated = names.filter(
        (n) => !/id:\s*configured\b/.test(step(text, n))
      );
      assert.ok(
        gated.length >= 5,
        `expected checkout, pnpm, node, install and the job itself; found ${gated.length}`
      );
      for (const n of gated) {
        assert.match(
          step(text, n),
          /if:\s*steps\.configured\.outputs\.configured\s*==\s*'true'/,
          `"${n}" runs without the preflight`
        );
      }
    });

    it('half-configured FAILS rather than skipping', () => {
      const preflight = step(src(), 'Is a Supabase project configured?');
      assert.match(preflight, /exit 1/);
      assert.match(preflight, /missing repository VARIABLE/);
      assert.match(preflight, /missing repository SECRET/);
    });
  });

  describe('Supabase Keep-Alive', () => {
    const src = () => body('supabase-keepalive.yml');

    it('skips only when the ref list AND both tokens are absent', () => {
      const ping = step(src(), 'Ping every project');
      assert.match(
        ping,
        /if \[ -z "\$\{TOKEN_A:-\}" \] && \[ -z "\$\{TOKEN_B:-\}" \]; then[\s\S]*?::notice::[\s\S]*?exit 0/,
        'an empty ref list with no tokens must exit 0 with a notice'
      );
    });

    it('an empty ref list WITH a token still fails', () => {
      const ping = step(src(), 'Ping every project');
      assert.match(
        ping,
        /::error::vars\.SUPABASE_KEEPALIVE_REFS is empty[\s\S]*?exit 1/,
        'an emptied variable on a configured repository must stay red'
      );
    });
  });

  describe('Production Smoke', () => {
    const src = () => body('smoke.yml');

    it('runs only when a production URL is configured', () => {
      const lines = job(src(), 'smoke').split('\n');
      const i = lines.findIndex((l) => /^\s{4}if:/.test(l));
      assert.notStrictEqual(i, -1, 'the smoke job lost its condition');
      assert.match(lines[i], /vars\.NEXT_PUBLIC_DEPLOY_URL\s*!=\s*''/);
    });

    it('carries no hardcoded production origin for the job to probe', () => {
      assert.doesNotMatch(
        job(src(), 'smoke').split('\n').slice(0, 20).join('\n'),
        /BASE_URL:\s*https?:/,
        'BASE_URL must come from the repository variable, not a literal'
      );
    });
  });
  it('every skip names what to set', () => {
    const notices = [
      [
        'auth-config-drift.yml',
        /SUPABASE_PROJECT_REF[\s\S]*SUPABASE_ACCESS_TOKEN/,
      ],
      [
        'prod-schema-drift.yml',
        /SUPABASE_PROJECT_REF[\s\S]*SUPABASE_ACCESS_TOKEN/,
      ],
      ['email-health.yml', /RESEND_API_KEY/],
      [
        'data-retention.yml',
        /SUPABASE_PROJECT_REF[\s\S]*SUPABASE_ACCESS_TOKEN/,
      ],
      [
        'supabase-keepalive.yml',
        /SUPABASE_KEEPALIVE_REFS[\s\S]*SUPABASE_ACCESS_TOKEN/,
      ],
    ];
    for (const [file, names] of notices) {
      const src = body(file);
      const notice = src
        .split('\n')
        .filter((line) => line.includes('::notice::'))
        .join('\n');
      assert.ok(notice, `${file} has no ::notice:: explaining the skip`);
      assert.match(notice, names, `${file}'s notice does not name what to set`);
    }
  });
});

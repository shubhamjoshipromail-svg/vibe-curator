import { guardEffectSource, buildFragmentSource } from './harness';
import { compileFragment } from './compile';
import { FIXTURE_VALID, FIXTURE_COMPILE_ERROR, FIXTURE_GUARD_VIOLATION } from './fixtures';

export interface SelfTestResult {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  detail?: string;
}

/**
 * Exercises the whole validation path against known-good and known-bad input.
 * Exposed on the dev handle so the pipeline can be verified in a browser with
 * no API key configured.
 */
export function runEffectSelfTest(): SelfTestResult[] {
  const results: SelfTestResult[] = [];

  // 1. Valid shader: passes the guard AND compiles.
  {
    const guard = guardEffectSource(FIXTURE_VALID);
    const compiled = guard.ok
      ? compileFragment(buildFragmentSource(FIXTURE_VALID))
      : { ok: false, log: 'guard rejected' };
    results.push({
      name: 'valid shader compiles',
      expected: 'accepted',
      actual: guard.ok && compiled.ok ? 'accepted' : 'rejected',
      pass: guard.ok && compiled.ok,
      detail: compiled.ok ? undefined : compiled.log || guard.errors.join('; '),
    });
  }

  // 2. Syntax error: guard lets it through, compiler must catch it.
  {
    const guard = guardEffectSource(FIXTURE_COMPILE_ERROR);
    const compiled = compileFragment(buildFragmentSource(FIXTURE_COMPILE_ERROR));
    results.push({
      name: 'syntax error caught by compiler',
      expected: 'compile failure',
      actual: compiled.ok ? 'compiled (missed!)' : 'compile failure',
      pass: guard.ok && !compiled.ok,
      detail: compiled.log.split('\n')[0],
    });
  }

  // 3. Unbounded loop: compiles fine, so ONLY the guard can catch it.
  {
    const guard = guardEffectSource(FIXTURE_GUARD_VIOLATION);
    results.push({
      name: 'unbounded loop caught by guard',
      expected: 'guard rejection',
      actual: guard.ok ? 'accepted (missed!)' : 'guard rejection',
      pass: !guard.ok,
      detail: guard.errors[0],
    });
  }

  return results;
}

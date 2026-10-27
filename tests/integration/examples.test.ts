/**
 * Every catalog example is built with the workshop assembler and run on the
 * machine host exactly as the UI's "Run & check" button does it: same
 * controller, same default debugger settings (break on faults enabled), same
 * request and the same check evaluation from the published view.
 */
import { describe, expect, it } from 'vitest';
import { checkStateFromView, EXAMPLES, evaluateCheck } from '../../src/catalog/examples';
import { buildProject, defaultProject } from '../../src/app/project';
import { defaultDebugSettings } from '../../src/app/store';
import { MachineController } from '../../src/host/controller';

function controllerWithUiDefaults(): MachineController {
  const c = new MachineController();
  const d = defaultDebugSettings();
  c.handle({ type: 'setBreakOn', breakOn: d.breakOn }, 0);
  c.handle({ type: 'setTrace', enabled: d.traceEnabled, capacity: d.traceCapacity }, 0);
  return c;
}

describe('example catalog', () => {
  it('covers every difficulty, and every bare-metal example must run to its HLT', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(20);
    for (const d of ['beginner', 'intermediate', 'advanced'])
      expect(EXAMPLES.some((e) => e.difficulty === d)).toBe(true);
    for (const e of EXAMPLES.filter((x) => x.kind === 'bare')) expect(e.check.halted, e.id).toBe(true);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s', (_id, ex) => {
    const project = defaultProject();
    if (ex.kind === 'bare') {
      project.mode = 'bare';
      project.bareMain = ex.file!;
    } else {
      project.mode = 'os';
      project.os.programs = ex.programs!.map((p) => ({ ...p }));
    }
    const build = buildProject(project);
    expect(build.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(build.ok).toBe(true);
    const c = controllerWithUiDefaults();
    c.handle({ type: 'load', request: build.load! }, 0);
    // A user breakpoint must not cut the check short either.
    c.handle({ type: 'setBreakpoints', addresses: [0x0100, 0x6000] }, 0);

    // Before running, the check must not already hold (it is not vacuous).
    expect(evaluateCheck(ex.check, checkStateFromView(c.view())).ok).toBe(false);

    if (ex.check.keys) c.handle({ type: 'injectKeys', bytes: [...ex.check.keys].map((k) => k.charCodeAt(0)) }, 0);
    c.request({ type: 'runDeterministic', cycles: ex.check.cycles, ignoreDebugStops: true });
    const v = c.view();
    const result = evaluateCheck(ex.check, checkStateFromView(v));
    expect(result.failed).toEqual([]);
    expect(v.cpu.status).not.toBe('machine-check');
    // Debugger settings are restored after the check run.
    expect(v.breakpoints).toEqual([0x0100, 0x6000]);
    expect(v.breakOn.faults).toBe(true);
  });
});

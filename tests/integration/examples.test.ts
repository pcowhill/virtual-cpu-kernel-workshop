/**
 * Every catalog example is built with the workshop assembler, run on the
 * emulator, and must satisfy its declared check — the same check the UI's
 * "Run & check" button evaluates.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLES, evaluateCheck } from '../../src/catalog/examples';
import { buildProject, defaultProject } from '../../src/app/project';
import { Machine } from '../../src/core/machine/machine';
import { kernelLayout, readProcessTable } from '../../src/core/os/awareness';

describe('example catalog', () => {
  it('has at least one example per required topic', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(20);
    for (const d of ['beginner', 'intermediate', 'advanced'])
      expect(EXAMPLES.some((e) => e.difficulty === d)).toBe(true);
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
    const m = new Machine();
    m.breakOn.faults = false;
    m.powerOn(build.load!.config);
    for (const c of ex.check.keys ?? '') m.injectKey(c.charCodeAt(0));
    m.run(ex.check.cycles);
    const layout = build.load!.kernelSymbols ? kernelLayout(build.load!.kernelSymbols) : null;
    const result = evaluateCheck(ex.check, {
      terminal: m.terminal.text(),
      r: Array.from(m.cpu.r),
      peek: (a) => m.bus.peek(a),
      leds: m.gpio.leds,
      processes: layout ? readProcessTable((a) => m.bus.peek(a), layout) : null,
    });
    expect(result.failed).toEqual([]);
    expect(m.cpu.status).not.toBe('machine-check');
  });
});

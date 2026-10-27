/**
 * Every guided lesson, performed on the real emulator through the same
 * operations the workbench offers. For each step: its check must NOT hold
 * before the step's solution (checks are not vacuous) and MUST hold after.
 */
import { describe, expect, it } from 'vitest';
import { LESSONS } from '../../src/lessons/lessons';
import {
  applySetup,
  describeCheck,
  editSource,
  evaluateLessonCheck,
  performActions,
  type Lesson,
  type LessonContext,
  type LessonDriver,
} from '../../src/lessons/engine';
import { buildProject, defaultProject, hashSources, type BuildOutput, type Project } from '../../src/app/project';
import { defaultDebugSettings } from '../../src/app/store';
import { MachineController } from '../../src/host/controller';
import { EXAMPLES } from '../../src/catalog/examples';

/** A driver over a MachineController, with the workbench's default debugger settings. */
class TestDriver implements LessonDriver {
  ctl = new MachineController();
  project: Project = defaultProject();
  out: BuildOutput | null = null;
  loadedHash: string | null = null;
  private bps: number[] = [];
  private wps: [number, 'r' | 'w' | 'rw'][] = [];

  ctx(): LessonContext {
    return {
      view: this.ctl.view(),
      build: this.out,
      project: this.project,
      sourcesMatchLoaded: this.loadedHash === hashSources(this.project),
    };
  }
  setup(lesson: Lesson): Promise<boolean> {
    applySetup(this.project, lesson.setup);
    return Promise.resolve(this.build_());
  }
  private build_(): boolean {
    const out = buildProject(this.project);
    this.out = out;
    if (!out.ok || !out.load) return false;
    const d = defaultDebugSettings();
    this.ctl.handle({ type: 'load', request: out.load }, 0);
    this.ctl.handle({ type: 'setBreakOn', breakOn: d.breakOn }, 0);
    this.ctl.handle({ type: 'setBreakpoints', addresses: this.bps }, 0);
    this.ctl.handle({ type: 'setWatchpoints', watchpoints: this.wps }, 0);
    this.loadedHash = out.sourceHash;
    return true;
  }
  send(cmd: Parameters<LessonDriver['send']>[0]): void {
    if (cmd.type === 'setBreakpoints') this.bps = [...cmd.addresses];
    this.ctl.handle(cmd, 0);
  }
  run(cycles: number): Promise<void> {
    if (cycles > 0) this.ctl.request({ type: 'runDeterministic', cycles });
    return Promise.resolve();
  }
  symbol(name: string): number | undefined {
    return this.out?.symbols.find((s) => s.name === name)?.value;
  }
  edit(file: string, find: string, replace: string): boolean {
    return editSource(this.project, file, find, replace);
  }
  build(): boolean {
    return this.build_();
  }
  breakpoints(): number[] {
    return [...this.bps];
  }
  watch(at: number, access: 'r' | 'w' | 'rw'): void {
    this.wps = [...this.wps.filter(([a]) => a !== at), [at, access]];
    this.ctl.handle({ type: 'setWatchpoints', watchpoints: this.wps }, 0);
  }
  unwatch(at: number): void {
    this.wps = this.wps.filter(([a]) => a !== at);
    this.ctl.handle({ type: 'setWatchpoints', watchpoints: this.wps }, 0);
  }
}

describe('guided lessons', () => {
  it('there are 18 lessons covering the required topics, numbered in order', () => {
    expect(LESSONS).toHaveLength(18);
    expect(LESSONS.map((l) => l.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(18);
    for (const l of LESSONS) {
      expect(l.objectives.length).toBeGreaterThan(0);
      expect(l.explanation.length).toBeGreaterThan(100);
      expect(l.steps.length).toBeGreaterThan(1);
      expect(l.experiments.length).toBeGreaterThan(0);
      expect(l.observations.length).toBeGreaterThan(0);
      for (const id of l.examples ?? [])
        expect(
          EXAMPLES.some((e) => e.id === id),
          `${l.id}: example ${id}`,
        ).toBe(true);
      // Every step is checked against the machine and can be demonstrated with "Show me".
      for (const s of l.steps) {
        expect(s.check, `${l.id}: ${s.title}`).toBeDefined();
        expect(s.solution, `${l.id}: ${s.title} can be demonstrated`).toBeDefined();
      }
    }
  });

  for (const lesson of LESSONS) {
    it(`lesson ${lesson.number}: ${lesson.title}`, async () => {
      const d = new TestDriver();
      await performActions(lesson, [{ do: 'setup' }], d);
      for (const step of lesson.steps) {
        const label = `${lesson.id} / ${step.title}: ${describeCheck(step.check!)}`;
        expect(evaluateLessonCheck(step.check!, d.ctx()), `${label} (holds before the step)`).toBe(false);
        await performActions(lesson, step.solution!, d);
        const v = d.ctx().view!;
        const procs = v.os?.processes.map((p) => `${p.name}:${p.state}:${p.runs}:${p.exitCode}`).join(',');
        expect(
          evaluateLessonCheck(step.check!, d.ctx()),
          `${label} — pc=${v.cpu.pc.toString(16)} stop=${v.stop?.reason} cycle=${v.cycle} ticks=${v.os?.ticks} procs=${procs}`,
        ).toBe(true);
      }
    });
  }
});

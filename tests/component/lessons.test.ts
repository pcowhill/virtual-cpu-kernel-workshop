/**
 * The lessons UI against the real machine host (inline): starting a lesson
 * loads its machine, step checks are evaluated from machine views, "Show me"
 * performs the step with ordinary commands, and progress is recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { resetStore, useStore } from '../../src/app/store';
import { resetLessons, useLessons } from '../../src/app/lessons';
import LessonsLab from '../../src/ui/labs/LessonsLab.vue';
import LessonGuide from '../../src/ui/components/LessonGuide.vue';

async function settle(pred: () => boolean, timeoutMs = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out');
    await flushPromises();
    await new Promise((r) => setTimeout(r, 10));
  }
  await nextTick();
}

const mounted: VueWrapper[] = [];
beforeEach(() => {
  vi.stubGlobal('Worker', undefined);
  localStorage.clear();
  resetStore();
  resetLessons();
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetLessons();
  resetStore();
  vi.unstubAllGlobals();
});

describe('guided lessons', () => {
  it('lists 18 lessons and starts one on the real machine', async () => {
    const lab = mount(LessonsLab, { attachTo: document.body });
    mounted.push(lab);
    expect(
      lab.findAll('[data-testid^="lesson-"]').filter((w) => /lesson-[a-z]/.test(w.attributes('data-testid')!)).length,
    ).toBeGreaterThanOrEqual(18);
    await lab.get('[data-testid=lesson-flags]').trigger('click');
    expect(lab.text()).toContain('Arithmetic operations and CPU flags');
    await lab.get('[data-testid=lesson-start]').trigger('click');
    const s = useStore();
    await settle(() => !!s.view.value?.label.includes('overflow-carry'));
    expect(useLessons().active.value?.id).toBe('flags');
  });

  it('a step is only marked done when the machine shows it, by the user or by "Show me"', async () => {
    const L = useLessons();
    const s = useStore();
    await L.start('registers');
    await settle(() => !!s.view.value?.label.includes('first-program'));
    const guide = mount(LessonGuide, { attachTo: document.body });
    mounted.push(guide);
    await nextTick();
    expect(guide.get('[data-testid=lesson-check]').text()).toMatch(/^Waiting for:/);

    // The user steps: the check is observed from the machine view.
    s.send({ type: 'stepInstruction' });
    await settle(() => L.passed[0] === true);
    expect(guide.get('[data-testid=lesson-check]').text()).toMatch(/Observed/);

    // Step 2 via "Show me".
    await guide.get('[data-testid=lesson-next]').trigger('click');
    expect(guide.get('[data-testid=lesson-check]').text()).toMatch(/^Waiting for:/);
    await guide.get('[data-testid=lesson-show-me]').trigger('click');
    await settle(() => L.passed[1] === true);
    expect(s.view.value!.cpu.r[1]).toBe(10);

    // Step 3 and completion.
    await guide.get('[data-testid=lesson-next]').trigger('click');
    await guide.get('[data-testid=lesson-show-me]').trigger('click');
    await settle(() => L.passed[2] === true);
    expect(s.view.value!.memory[0x2000]).toBe(0x37);
    await settle(() => guide.find('[data-testid=lesson-complete]').exists());
    expect(L.completed.value).toContain('registers');
    expect(JSON.parse(localStorage.getItem('vck.lessons.completed')!)).toContain('registers');
  });

  it('a step whose work was done earlier is marked done on arrival', async () => {
    const L = useLessons();
    const s = useStore();
    await L.start('first-program');
    await settle(() => !!s.view.value?.label.includes('first-program'));
    // While still on step 1, do step 2's work: edit, rebuild, run to the end.
    s.project.files['examples/first-program.asm'] = s.project.files['examples/first-program.asm']!.replace(
      'MOV R1, #10 ',
      'MOV R1, #5  ',
    );
    expect(s.buildAndLoad()).toBe(true);
    await s.client.request({ type: 'runDeterministic', cycles: 10_000 });
    await settle(() => s.view.value?.devices.gpio.leds === 15);
    expect(L.passed[1]).toBeFalsy();
    L.go(1);
    await settle(() => L.passed[1] === true);
  });

  it('starting a lesson resets debugger stops and flags edited kernel sources', async () => {
    const L = useLessons();
    const s = useStore();
    s.debug.watchpoints.push([0x2000, 'w']);
    s.debug.breakpoints.push(0x0100);
    s.debug.breakOn.interrupts = true;
    s.project.files['kernel/main.asm'] = s.project.files['kernel/main.asm']!.replace(
      '= 2000          ;',
      '= 500           ;',
    );
    const lesson = (await import('../../src/lessons/lessons')).LESSONS.find((l) => l.id === 'modes')!;
    expect(L.modifiedFiles(lesson)).toContain('kernel/main.asm');
    await L.start('modes');
    expect(s.debug.watchpoints).toEqual([]);
    expect(s.debug.breakpoints).toEqual([]);
    expect(s.debug.breakOn.interrupts).toBe(false);
    L.restoreFiles(lesson);
    expect(L.modifiedFiles(lesson)).toEqual([]);
    // Leaving gives the user's own debugger settings back.
    L.exit();
    expect(s.debug.watchpoints).toEqual([[0x2000, 'w']]);
    expect(s.debug.breakpoints).toEqual([0x0100]);
    expect(s.debug.breakOn.interrupts).toBe(true);
  });
});

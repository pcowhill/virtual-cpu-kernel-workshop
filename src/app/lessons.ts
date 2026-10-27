/**
 * Lesson session state: which lesson is active, which step, which steps have
 * been observed passing. Checks are re-evaluated on every machine view; a step
 * counts as done once its check has held while the step was current.
 */
import { computed, reactive, ref, watch } from 'vue';
import { useStore } from './store';
import { GUEST_SOURCES } from '../guest';
import { LESSONS } from '../lessons/lessons';
import {
  applySetup,
  editSource,
  evaluateLessonCheck,
  performActions,
  type Lesson,
  type LessonContext,
  type LessonDriver,
} from '../lessons/engine';
import type { RunResult } from '../core/machine/machine';

const PROGRESS_KEY = 'vck.lessons.completed';

function loadProgress(): string[] {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveProgress(ids: string[]): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(ids));
  } catch {
    /* progress is a convenience; ignore storage failures */
  }
}

/** Source files a lesson relies on (its program and the files its solutions edit). */
export function lessonFiles(lesson: Lesson): string[] {
  const files = new Set<string>();
  if (lesson.setup.kind === 'bare') files.add(lesson.setup.file);
  else lesson.setup.programs.forEach((p) => files.add(p.path));
  for (const st of lesson.steps) for (const a of st.solution ?? []) if (a.do === 'edit') files.add(a.file);
  return [...files];
}

function createLessons() {
  const s = useStore();
  const activeId = ref<string | null>(null);
  const step = ref(0);
  const passed = reactive<boolean[]>([]);
  const completed = ref<string[]>(loadProgress());
  const busy = ref(false);
  const error = ref<string | null>(null);

  const active = computed(() => LESSONS.find((l) => l.id === activeId.value) ?? null);
  const current = computed(() => active.value?.steps[step.value] ?? null);

  const ctx = computed<LessonContext>(() => ({
    view: s.view.value,
    build: s.loadedBuild.value,
    project: s.project,
    sourcesMatchLoaded: s.loadedHash.value !== null && !s.buildStale.value,
  }));

  /** Live status of the current step's check. */
  const currentHolds = computed(() => {
    const c = current.value?.check;
    return c ? evaluateLessonCheck(c, ctx.value) : false;
  });

  watch(
    currentHolds,
    (ok) => {
      if (ok && active.value && !busy.value) markPassed();
    },
    { immediate: true },
  );

  function markPassed(): void {
    passed[step.value] = true;
    const l = active.value!;
    if (l.steps.every((_, i) => passed[i]) && !completed.value.includes(l.id)) {
      completed.value = [...completed.value, l.id];
      saveProgress(completed.value);
    }
  }

  /** Files used by the lesson that differ from the shipped originals. */
  function modifiedFiles(lesson: Lesson): string[] {
    return lessonFiles(lesson).filter((f) => s.project.files[f] !== GUEST_SOURCES[f]);
  }

  function restoreFiles(lesson: Lesson): void {
    for (const f of modifiedFiles(lesson)) {
      if (GUEST_SOURCES[f] !== undefined) s.project.files[f] = GUEST_SOURCES[f]!;
    }
  }

  const driver: LessonDriver = {
    async setup(lesson) {
      applySetup(s.project, lesson.setup);
      s.selectedFile.value = lesson.setup.kind === 'bare' ? lesson.setup.file : lesson.setup.programs[0]!.path;
      const ok = s.buildAndLoad();
      await s.client.request({ type: 'sync' });
      return ok;
    },
    send: (cmd) => s.send(cmd),
    async run(cycles) {
      if (cycles > 0) await s.client.request<RunResult>({ type: 'runDeterministic', cycles });
      else await s.client.request({ type: 'sync' });
    },
    symbol: (name) => s.symbol(name),
    edit(file, find, replace) {
      s.selectedFile.value = file;
      return editSource(s.project, file, find, replace);
    },
    build: () => s.buildAndLoad(),
    breakpoints: () => [...s.debug.breakpoints],
    watch(at, access) {
      const others = s.debug.watchpoints.filter(([a]) => a !== at);
      s.debug.watchpoints.splice(0, s.debug.watchpoints.length, ...others, [at, access]);
      s.syncDebug();
    },
    unwatch(at) {
      const others = s.debug.watchpoints.filter(([a]) => a !== at);
      s.debug.watchpoints.splice(0, s.debug.watchpoints.length, ...others);
      s.syncDebug();
    },
  };

  async function guarded(fn: () => Promise<void>): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
      await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
      if (currentHolds.value && active.value) markPassed();
    }
  }

  /** Start (or restart) a lesson: configure and load its machine. */
  async function start(id: string): Promise<void> {
    const l = LESSONS.find((x) => x.id === id);
    if (!l) return;
    activeId.value = id;
    step.value = 0;
    passed.splice(0, passed.length);
    s.lab.value = l.lab;
    await guarded(() => performActions(l, [{ do: 'setup' }], driver));
  }

  /** Perform the current step's solution with the ordinary workbench operations. */
  async function showMe(): Promise<void> {
    const l = active.value;
    const st = current.value;
    if (!l || !st?.solution) return;
    if (st.lab) s.lab.value = st.lab;
    await guarded(() => performActions(l, st.solution!, driver));
  }

  function go(i: number): void {
    const l = active.value;
    if (!l) return;
    step.value = Math.max(0, Math.min(l.steps.length - 1, i));
    const lab = l.steps[step.value]!.lab;
    if (lab) s.lab.value = lab;
  }

  function exit(): void {
    activeId.value = null;
    error.value = null;
  }

  function resetProgress(): void {
    completed.value = [];
    saveProgress([]);
  }

  return {
    active,
    step,
    current,
    passed,
    completed,
    busy,
    error,
    currentHolds,
    start,
    showMe,
    go,
    exit,
    modifiedFiles,
    restoreFiles,
    resetProgress,
  };
}

let lessons: ReturnType<typeof createLessons> | null = null;

export function useLessons(): ReturnType<typeof createLessons> {
  if (!lessons) lessons = createLessons();
  return lessons;
}

/** For tests. */
export function resetLessons(): void {
  lessons = null;
}

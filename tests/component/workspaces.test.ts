/** The workspace session: what counts as unsaved, and saving/renaming/opening. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { resetStore, useStore } from '../../src/app/store';
import { resetWorkspaces, useWorkspaces } from '../../src/app/workspaces';

async function loaded(): Promise<void> {
  const s = useStore();
  s.buildAndLoad();
  await s.client.request({ type: 'sync' });
  await flushPromises();
}

beforeEach(() => {
  vi.stubGlobal('Worker', undefined);
  resetStore();
  resetWorkspaces();
});
afterEach(() => {
  resetWorkspaces();
  resetStore();
  vi.unstubAllGlobals();
});

describe('workspace session', () => {
  it('an untouched workspace is clean; sources, debugger settings and notes make it dirty', async () => {
    const W = useWorkspaces();
    const s = useStore();
    expect(W.dirty.value).toBe(false);
    s.debug.breakpoints.push(0x0100);
    expect(W.dirty.value).toBe(true);
    s.debug.breakpoints.splice(0);
    expect(W.dirty.value).toBe(false);
    W.current.notes = 'x';
    expect(W.dirty.value).toBe(true);
  });

  it('saving records exactly what was saved; an edit during the save stays unsaved', async () => {
    const W = useWorkspaces();
    const s = useStore();
    await loaded();
    W.current.name = 'Session test';
    const saving = W.save();
    s.project.files['examples/first-program.asm'] += '\n; edited while saving\n';
    await saving;
    expect(W.dirty.value).toBe(true);
    await W.save();
    expect(W.dirty.value).toBe(false);
  });

  it('renaming the open workspace keeps it saved, and opening restores sources and settings', async () => {
    const W = useWorkspaces();
    const s = useStore();
    await loaded();
    W.current.name = 'Rename me';
    s.debug.breakpoints.push(0x0106);
    await W.save();
    const id = W.current.id!;
    await W.rename(id, 'Renamed');
    expect(W.current.name).toBe('Renamed');
    expect(W.dirty.value).toBe(false);

    s.debug.breakpoints.splice(0);
    s.project.files['examples/first-program.asm'] = '; gone\n';
    expect(W.dirty.value).toBe(true);
    expect(await W.open(id)).toBe(true);
    expect(s.debug.breakpoints).toEqual([0x0106]);
    expect(s.project.files['examples/first-program.asm']).toContain('first-program');
    expect(W.dirty.value).toBe(false);
  });
});

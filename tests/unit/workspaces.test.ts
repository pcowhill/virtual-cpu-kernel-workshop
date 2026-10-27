/**
 * Workspace format, validation of untrusted imports, IndexedDB storage, and
 * determinism of saved/restored execution.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  exportWorkspace,
  ImportError,
  importWorkspace,
  newId,
  validateSnapshot,
  type Workspace,
} from '../../src/app/workspace-format';
import { deleteWorkspace, getWorkspace, listWorkspaces, putWorkspace } from '../../src/app/workspace-db';
import { buildProject, defaultProject } from '../../src/app/project';
import { defaultDebugSettings } from '../../src/app/store';
import { MachineController } from '../../src/host/controller';
import type { MachineSnapshot } from '../../src/core/machine/machine';

function osController(): { c: MachineController; hash: string } {
  const p = defaultProject();
  p.mode = 'os';
  const b = buildProject(p);
  const c = new MachineController();
  c.handle({ type: 'load', request: b.load! }, 0);
  return { c, hash: b.sourceHash };
}

function workspace(machine: MachineSnapshot | null, hash: string | null): Workspace {
  const p = defaultProject();
  p.mode = 'os';
  const rec = machine
    ? { id: newId(), name: 'state at save', createdAt: 1, cycle: machine.cycle, label: 'os', sourceHash: hash, machine }
    : null;
  return {
    id: newId(),
    name: 'My experiment',
    notes: 'Timer quantum 2000; echo blocks on getc.',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    project: p,
    debug: { ...defaultDebugSettings(), breakpoints: [0x2000], watchpoints: [[0x5040, 'w']] },
    machine: rec,
    snapshots: rec ? [{ ...rec, id: newId(), name: 'after boot' }] : [],
  };
}

describe('workspace export/import', () => {
  it('round-trips a workspace with machine state, and execution continues identically', () => {
    const { c, hash } = osController();
    c.handle({ type: 'injectKeys', bytes: [0x68, 0x69] }, 0);
    c.request({ type: 'runDeterministic', cycles: 400_000 });
    const snap = c.machine.snapshot();
    const text = exportWorkspace(workspace(snap, hash));
    const back = importWorkspace(text);
    expect(back.name).toBe('My experiment');
    expect(back.notes).toContain('quantum');
    expect(back.debug.watchpoints).toEqual([[0x5040, 'w']]);
    expect(back.snapshots).toHaveLength(1);

    // Continue the original and the imported state for the same number of cycles.
    c.request({ type: 'runDeterministic', cycles: 300_000 });
    const expected = JSON.stringify(c.machine.snapshot());
    const { c: c2 } = osController();
    c2.handle({ type: 'restore', snapshot: back.machine!.machine }, 0);
    c2.request({ type: 'runDeterministic', cycles: 300_000 });
    expect(JSON.stringify(c2.machine.snapshot())).toBe(expected);
  });

  const valid = () => JSON.parse(exportWorkspace(workspace(osController().c.machine.snapshot(), null))) as {
    workspace: Record<string, unknown> & { project: { files: Record<string, string> }; machine: { machine: MachineSnapshot } };
    version: number;
  };
  const reject = (mutate: (d: ReturnType<typeof valid>) => void, msg: RegExp) => {
    const d = valid();
    mutate(d);
    expect(() => importWorkspace(JSON.stringify(d))).toThrow(msg);
  };

  it('rejects malformed and incompatible files with a readable reason', () => {
    expect(() => importWorkspace('not json')).toThrow(ImportError);
    expect(() => importWorkspace('{"format":"something-else"}')).toThrow(/not a VC-8 workspace/);
    reject((d) => (d.version = 2), /unsupported workspace version 2/);
    reject((d) => (d.workspace.project.files = {}), /files is empty/);
    reject((d) => (d.workspace.project.files['../../etc/passwd.asm'] = 'x'), /invalid source file name/);
    reject((d) => (d.workspace.project.files['a.js'] = 'alert(1)'), /invalid source file name/);
    reject((d) => ((d.workspace.project as unknown as { bareMain: string }).bareMain = 'missing.asm'), /not one of the files/);
    reject((d) => ((d.workspace['debug'] as { breakpoints: unknown[] }).breakpoints = [70000]), /breakpoint 1/);
    reject((d) => ((d.workspace.machine.machine.cpu.r as number[])[0] = 300), /cpu\.r\[0\]/);
    reject((d) => ((d.workspace.machine.machine.cpu as { pc: unknown }).pc = '0x100'), /wrong type/);
    reject((d) => ((d.workspace.machine.machine as unknown as { extra: number }).extra = 1), /not part of the format/);
    reject((d) => ((d.workspace.machine.machine.cpu as { programId: unknown }).programId = 'op:nonsense'), /cannot be restored|does not accept/);
    reject((d) => (d.workspace.machine.machine.memory = 'AAAA'), /cannot be restored|does not accept/);
    reject((d) => ((d.workspace.machine.machine as unknown as { format: string }).format = 'x'), /not a version 1/);
  });

  it('accepts a snapshot taken mid-instruction with a pending exception', () => {
    const p = defaultProject();
    p.bareMain = 'examples/protection-fault.asm';
    const c = new MachineController();
    c.handle({ type: 'load', request: buildProject(p).load! }, 0);
    c.handle({ type: 'setBreakOn', breakOn: { faults: true, traps: false, interrupts: false } }, 0);
    c.request({ type: 'runDeterministic', cycles: 10_000 });
    c.handle({ type: 'stepMicro' }, 0);
    const snap = c.machine.snapshot();
    expect(snap.cpu.exception).not.toBeNull();
    expect(validateSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });
});

describe('workspace storage (IndexedDB)', () => {
  it('saves, lists, renames, duplicates and deletes', async () => {
    const a = workspace(null, null);
    const b = { ...workspace(null, null), name: 'Second', updatedAt: a.updatedAt + 10 };
    await putWorkspace(a);
    await putWorkspace(b);
    let list = await listWorkspaces();
    expect(list.map((w) => w.name).slice(0, 2)).toEqual(['Second', 'My experiment']);
    await putWorkspace({ ...a, name: 'Renamed' });
    expect((await getWorkspace(a.id))?.name).toBe('Renamed');
    expect((await getWorkspace(a.id))?.project.files['kernel/main.asm']).toContain('QUANTUM');
    await deleteWorkspace(a.id);
    list = await listWorkspaces();
    expect(list.some((w) => w.id === a.id)).toBe(false);
    expect(await getWorkspace(a.id)).toBeNull();
    await deleteWorkspace(b.id);
  });
});

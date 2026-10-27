/** MachineClient: replacing a failed worker host, and reporting host failures. */
import { describe, expect, it } from 'vitest';
import { MachineClient, type MachineHost } from '../../src/host/client';
import { buildProject, defaultProject } from '../../src/app/project';
import type { FromHost, MachineView, ToHost } from '../../src/host/protocol';

function fakeWorker(): MachineHost & { fail(msg: string): void; reply(m: FromHost): void; posted: ToHost[] } {
  let failure: (m: string) => void = () => {};
  let listener: (m: FromHost) => void = () => {};
  const posted: ToHost[] = [];
  return {
    kind: 'worker',
    posted,
    post: (m) => posted.push(m),
    onMessage: (cb) => (listener = cb),
    onFailure: (cb) => (failure = cb),
    dispose: () => {},
    fail: (m) => failure(m),
    reply: (m) => listener(m),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('MachineClient', () => {
  it('falls back to the in-page host when the worker fails before answering, replaying what was sent', async () => {
    const host = fakeWorker();
    const client = new MachineClient(host);
    const views: MachineView[] = [];
    client.onView((v) => views.push(v));
    const b = buildProject(defaultProject());
    client.send({ type: 'load', request: b.load! });
    const answer = client.request<{ reason: string }>({ type: 'runDeterministic', cycles: 10_000 });
    host.fail('script failed to load');
    expect(client.hostKind).toBe('inline');
    await expect(answer).resolves.toMatchObject({ reason: 'halted' });
    await tick();
    expect(views.at(-1)?.loaded).toBe(true);
    expect(views.at(-1)?.label).toContain('first-program');
    client.dispose();
  });

  it('reports a failure after the worker has answered as an application error and rejects pending requests', async () => {
    const host = fakeWorker();
    const client = new MachineClient(host);
    const errors: string[] = [];
    client.onError((e) => errors.push(e));
    client.send({ type: 'requestView' });
    host.reply({ kind: 'error', message: 'first answer' });
    const pending = client.request({ type: 'snapshot' });
    host.fail('worker crashed');
    await expect(pending).rejects.toThrow(/not the guest program/);
    expect(client.hostKind).toBe('worker');
    expect(errors.at(-1)).toMatch(/Machine host error/);
  });
});

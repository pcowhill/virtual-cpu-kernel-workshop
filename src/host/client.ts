/**
 * MachineClient: the UI's handle on the machine host. Prefers a Web Worker;
 * falls back to running the same HostLoop on the main thread when workers are
 * unavailable (e.g. in component tests).
 */
import { HostLoop } from './loop';
import type { Command, FromHost, MachineView, Request, ToHost } from './protocol';

export interface MachineHost {
  readonly kind: 'worker' | 'inline';
  post(msg: ToHost): void;
  onMessage(cb: (msg: FromHost) => void): void;
  /** The host itself failed (not the guest machine): e.g. the worker script could not load. */
  onFailure(cb: (message: string) => void): void;
  dispose(): void;
}

export function createWorkerHost(): MachineHost {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let failure: (message: string) => void = () => {};
  worker.onerror = (e) => {
    e.preventDefault();
    failure(e.message || 'the machine worker failed to start');
  };
  worker.onmessageerror = () => failure('a message from the machine worker could not be decoded');
  return {
    kind: 'worker',
    post: (msg) => worker.postMessage(msg),
    onMessage: (cb) => {
      worker.onmessage = (e: MessageEvent<FromHost>) => cb(e.data);
    },
    onFailure: (cb) => {
      failure = cb;
    },
    dispose: () => worker.terminate(),
  };
}

export function createInlineHost(): MachineHost {
  let listener: (msg: FromHost) => void = () => {};
  const loop = new HostLoop((msg) => queueMicrotask(() => listener(msg)));
  return {
    kind: 'inline',
    post: (msg) => loop.receive(structuredClone(msg)),
    onMessage: (cb) => {
      listener = cb;
    },
    onFailure: () => {},
    dispose: () => loop.dispose(),
  };
}

export class MachineClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private viewListeners: ((v: MachineView) => void)[] = [];
  private errorListeners: ((message: string) => void)[] = [];

  private host: MachineHost;
  /** Messages posted before the host first answered: replayed if it must be replaced. */
  private unconfirmed: ToHost[] | null = [];

  constructor(host: MachineHost) {
    this.host = host;
    this.attach(host);
  }

  private attach(host: MachineHost): void {
    host.onMessage((msg) => {
      this.unconfirmed = null;
      this.dispatch(msg);
    });
    host.onFailure((message) => this.hostFailed(message));
  }

  /**
   * A worker that fails before it ever answered is replaced by the in-page
   * host (same HostLoop), and everything sent so far is replayed. A failure
   * after that is reported: it is an application error, not a guest fault.
   */
  private hostFailed(message: string): void {
    if (this.host.kind === 'worker' && this.unconfirmed) {
      const replay = this.unconfirmed;
      this.host.dispose();
      this.host = createInlineHost();
      this.attach(this.host);
      for (const m of replay) this.host.post(m);
      return;
    }
    const err = `Machine host error (workbench, not the guest program): ${message}`;
    this.errorListeners.forEach((l) => l(err));
    for (const p of this.pending.values()) p.reject(new Error(err));
    this.pending.clear();
  }

  private post(msg: ToHost): void {
    this.unconfirmed?.push(msg);
    this.host.post(msg);
  }

  static create(): MachineClient {
    let host: MachineHost;
    try {
      host = typeof Worker !== 'undefined' ? createWorkerHost() : createInlineHost();
    } catch {
      host = createInlineHost();
    }
    return new MachineClient(host);
  }

  get hostKind(): MachineHost['kind'] {
    return this.host.kind;
  }

  private dispatch(msg: FromHost): void {
    if (msg.kind === 'view') this.viewListeners.forEach((l) => l(msg.view));
    else if (msg.kind === 'error') this.errorListeners.forEach((l) => l(msg.message));
    else {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? 'request failed'));
    }
  }

  onView(cb: (v: MachineView) => void): void {
    this.viewListeners.push(cb);
  }

  onError(cb: (message: string) => void): void {
    this.errorListeners.push(cb);
  }

  send(command: Command): void {
    this.post({ kind: 'command', command });
  }

  request<T>(request: Request): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ kind: 'request', id, request });
    });
  }

  dispose(): void {
    this.host.dispose();
    for (const p of this.pending.values()) p.reject(new Error('machine host disposed'));
    this.pending.clear();
  }
}

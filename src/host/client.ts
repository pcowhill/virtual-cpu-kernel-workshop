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
  dispose(): void;
}

export function createWorkerHost(): MachineHost {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return {
    kind: 'worker',
    post: (msg) => worker.postMessage(msg),
    onMessage: (cb) => {
      worker.onmessage = (e: MessageEvent<FromHost>) => cb(e.data);
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
    dispose: () => loop.dispose(),
  };
}

export class MachineClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private viewListeners: ((v: MachineView) => void)[] = [];
  private errorListeners: ((message: string) => void)[] = [];

  constructor(private readonly host: MachineHost) {
    host.onMessage((msg) => this.dispatch(msg));
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
    this.host.post({ kind: 'command', command });
  }

  request<T>(request: Request): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.host.post({ kind: 'request', id, request });
    });
  }

  dispose(): void {
    this.host.dispose();
  }
}

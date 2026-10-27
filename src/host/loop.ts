/**
 * HostLoop: drives a MachineController in real time and publishes views.
 * Used inside the Web Worker and, as a fallback, on the main thread.
 */
import { MachineController } from './controller';
import type { FromHost, ToHost } from './protocol';

const VIEW_INTERVAL_MS = 33; // at most ~30 views per second while running
const SLICE_INTERVAL_MS = 10;

export class HostLoop {
  readonly controller = new MachineController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastView = 0;

  constructor(
    private readonly send: (msg: FromHost, transfer?: Transferable[]) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  receive(msg: ToHost): void {
    const t = this.now();
    if (msg.kind === 'command') {
      try {
        this.controller.handle(msg.command, t);
      } catch (e) {
        this.send({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
      this.publish(true);
      this.schedule();
    } else {
      let response: FromHost;
      try {
        const value = this.controller.request(msg.request);
        response = { kind: 'response', id: msg.id, ok: true, value };
      } catch (e) {
        response = { kind: 'response', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      // Publish the resulting state first, so a client awaiting the response already has the view.
      if (this.controller.dirty) this.publish(true);
      this.send(response);
    }
  }

  private publish(force: boolean): void {
    const t = this.now();
    if (!force && t - this.lastView < VIEW_INTERVAL_MS) return;
    this.lastView = t;
    this.controller.dirty = false;
    const view = this.controller.view();
    this.send({ kind: 'view', view }, [view.memory.buffer]);
  }

  private schedule(): void {
    if (this.timer !== null || this.controller.runState !== 'running') return;
    const max = this.controller.speed === 'max';
    this.timer = setTimeout(() => this.step(), max ? 0 : SLICE_INTERVAL_MS);
  }

  private step(): void {
    this.timer = null;
    const stopped = this.controller.tick(this.now(), this.now);
    this.publish(stopped);
    this.schedule();
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

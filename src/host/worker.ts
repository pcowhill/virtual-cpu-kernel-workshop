/// <reference lib="webworker" />
/**
 * Web Worker entry: the virtual machine runs here so continuous execution
 * never blocks the user interface.
 */
import { HostLoop } from './loop';
import type { FromHost, ToHost } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const loop = new HostLoop((msg: FromHost, transfer?: Transferable[]) => scope.postMessage(msg, transfer ?? []));
scope.onmessage = (e: MessageEvent<ToHost>) => loop.receive(e.data);

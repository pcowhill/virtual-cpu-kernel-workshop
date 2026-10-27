/**
 * Workspace persistence in IndexedDB (one object store, keyed by id).
 * Records are structured-cloned plain data.
 */
import type { Workspace } from './workspace-format';

const DB_NAME = 'vc8-workbench';
const DB_VERSION = 1;
const STORE = 'workspaces';

export interface WorkspaceSummary {
  id: string;
  name: string;
  updatedAt: number;
  snapshots: number;
  mode: Workspace['project']['mode'];
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('this browser does not provide IndexedDB storage'));
      return;
    }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const db = r.result;
      // Let a newer version of the app (another tab) upgrade the database.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error ?? new Error('could not open workspace storage'));
    r.onblocked = () => reject(new Error('workspace storage is blocked by another tab'));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Run a write and resolve only when its transaction has committed (quota errors surface here). */
async function write(fn: (s: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('the workspace storage transaction was aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('workspace storage failed'));
    fn(tx.objectStore(STORE));
  });
}

/** Plain-data copy (drops Vue proxies) so IndexedDB can structured-clone it. */
function plain<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const all = await request((await store('readonly')).getAll() as IDBRequest<Workspace[]>);
  return all
    .map((w) => ({
      id: w.id,
      name: w.name,
      updatedAt: w.updatedAt,
      snapshots: w.snapshots.length,
      mode: w.project.mode,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  return ((await request((await store('readonly')).get(id))) as Workspace | undefined) ?? null;
}

export async function putWorkspace(ws: Workspace): Promise<void> {
  const data = plain(ws);
  await write((s) => s.put(data));
}

export async function deleteWorkspace(id: string): Promise<void> {
  await write((s) => s.delete(id));
}

/** For tests: forget the cached connection. */
export function closeWorkspaceDb(): void {
  void dbPromise?.then((db) => db.close());
  dbPromise = null;
}

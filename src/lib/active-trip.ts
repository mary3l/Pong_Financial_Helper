import type { CartItem } from "@/lib/grocery";

// The grocery trip you're on, kept in IndexedDB on this device so it
// survives weak signal inside the store and closing the app. Browser only.

export type ActiveTrip = {
  budget: number | null;
  store: string;
  accountId: string;
  /** 0.7, 0.8 or 0.9: when to warn. */
  warnAt: number;
  items: CartItem[];
  step: "scan" | "checkout";
  startedOn: string;
};

const DB = "pong-money";
const STORE = "grocery";
const KEY = "active-trip";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Null when there's no trip, or storage isn't available (private mode). */
export async function loadTrip(): Promise<ActiveTrip | null> {
  try {
    return ((await run("readonly", (s) => s.get(KEY))) as ActiveTrip | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveTrip(trip: ActiveTrip): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(trip, KEY));
  } catch {
    // Storage blocked: the trip still works, it just won't survive a reload.
  }
}

export async function clearTrip(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // Nothing to clear.
  }
}

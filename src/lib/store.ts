import { useEffect, useState } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

/** Minimal observable value shared between screens. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A store whose value is mirrored to localStorage as JSON. */
export function createPersistedStore<T>(key: string, fallback: T): Store<T> {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) initial = JSON.parse(raw) as T;
  } catch {
    // Corrupted entry: fall back rather than fail to boot.
  }
  const store = createStore(initial);
  return {
    ...store,
    set(next) {
      localStorage.setItem(key, JSON.stringify(next));
      store.set(next);
    },
  };
}

export function useStore<T>(store: Pick<Store<T>, 'get' | 'subscribe'>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(() => setValue(store.get()));
  }, [store]);
  return value;
}

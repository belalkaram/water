import { useEffect, useState } from 'react';

/** useState that remembers its value on this device (per key) — used to keep each page's filters */
export function usePersistedState<T extends string>(key: string, initial: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null && (!allowed || allowed.includes(raw as T))) return raw as T;
    } catch {
      // ignore
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue] as const;
}

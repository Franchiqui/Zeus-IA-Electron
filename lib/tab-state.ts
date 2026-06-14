import { useState, useEffect, useCallback } from 'react';

const tabStateStore = new Map<string, any>();

export function useTabState<T>(
  tabId: string,
  key: string,
  initialValue: T
): [T, (valueOrUpdater: T | ((prev: T) => T)) => void] {
  const fullKey = `${tabId}:${key}`;

  const [state, setState] = useState<T>(() => {
    const stored = tabStateStore.get(fullKey);
    return stored !== undefined ? stored : initialValue;
  });

  // Cuando cambia el tabId o la key, sincronizar con el store global
  useEffect(() => {
    const stored = tabStateStore.get(fullKey);
    if (stored !== undefined) {
      setState(stored);
    } else {
      setState(initialValue);
      tabStateStore.set(fullKey, initialValue);
    }
  }, [fullKey, initialValue]);

  const setTabState = useCallback(
    (valueOrUpdater: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next =
          typeof valueOrUpdater === 'function'
            ? (valueOrUpdater as (prev: T) => T)(prev)
            : valueOrUpdater;
        tabStateStore.set(fullKey, next);
        return next;
      });
    },
    [fullKey]
  );

  return [state, setTabState];
}

export function getTabState<T>(tabId: string, key: string): T | undefined {
  return tabStateStore.get(`${tabId}:${key}`);
}

export function setTabStateValue<T>(tabId: string, key: string, value: T): void {
  tabStateStore.set(`${tabId}:${key}`, value);
}

export function clearTabState(tabId: string): void {
  for (const key of Array.from(tabStateStore.keys())) {
    if (key.startsWith(`${tabId}:`)) {
      tabStateStore.delete(key);
    }
  }
}

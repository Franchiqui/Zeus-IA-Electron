import { useState, useEffect, useCallback, useRef } from 'react';

type LocalStorageValue<T> = T | null;

interface UseLocalStorageOptions<T> {
  serializer?: (value: T) => string;
  deserializer?: (value: string) => T;
  onError?: (error: Error) => void;
}

interface UseLocalStorageReturn<T> {
  value: LocalStorageValue<T>;
  setValue: (value: T | ((prev: LocalStorageValue<T>) => T)) => void;
  removeValue: () => void;
  isPersistent: boolean;
}

const defaultSerializer = <T>(value: T): string => {
  return JSON.stringify(value);
};

const defaultDeserializer = <T>(value: string): T => {
  return JSON.parse(value);
};

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {}
): UseLocalStorageReturn<T> {
  const {
    serializer = defaultSerializer,
    deserializer = defaultDeserializer,
    onError
  } = options;

  const [storedValue, setStoredValue] = useState<LocalStorageValue<T>>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? deserializer(item) : initialValue;
    } catch (error) {
      onError?.(error as Error);
      return initialValue;
    }
  });

  const [isPersistent, setIsPersistent] = useState(true);
  const initialValueRef = useRef(initialValue);
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    initialValueRef.current = initialValue;
  }, [initialValue]);

  const setValue = useCallback((value: T | ((prev: LocalStorageValue<T>) => T)) => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      const valueToStore = value instanceof Function ? value(storedValue) : value;
      
      setStoredValue(valueToStore);
      
      try {
        window.localStorage.setItem(keyRef.current, serializer(valueToStore));
        setIsPersistent(true);
      } catch (storageError) {
        setIsPersistent(false);
        onError?.(storageError as Error);
      }
    } catch (error) {
      onError?.(error as Error);
    }
  }, [storedValue, serializer, onError]);

  const removeValue = useCallback(() => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      setStoredValue(null);
      window.localStorage.removeItem(keyRef.current);
    } catch (error) {
      onError?.(error as Error);
    }
  }, [onError]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === keyRef.current && event.storageArea === window.localStorage) {
        try {
          const newValue = event.newValue ? deserializer(event.newValue) : initialValueRef.current;
          setStoredValue(newValue);
        } catch (error) {
          onError?.(error as Error);
        }
      }
    };

    const testPersistence = () => {
      try {
        const testKey = `__persistence_test_${Date.now()}__`;
        window.localStorage.setItem(testKey, 'test');
        window.localStorage.removeItem(testKey);
        setIsPersistent(true);
      } catch {
        setIsPersistent(false);
      }
    };

    testPersistence();
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [deserializer, onError]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeUnload = () => {
      try {
        if (storedValue !== null) {
          window.localStorage.setItem(keyRef.current, serializer(storedValue));
        }
      } catch (error) {
        onError?.(error as Error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [storedValue, serializer, onError]);

  return {
    value: storedValue,
    setValue,
    removeValue,
    isPersistent
  };
}

export function useLocalStorageJson<T>(
  key: string,
  initialValue: T
): UseLocalStorageReturn<T> {
  return useLocalStorage<T>(key, initialValue, {
    serializer: defaultSerializer,
    deserializer: defaultDeserializer
  });
}

export function useLocalStorageString(
  key: string,
  initialValue: string
): UseLocalStorageReturn<string> {
  return useLocalStorage<string>(key, initialValue, {
    serializer: (value) => value,
    deserializer: (value) => value
  });
}

export function useLocalStorageNumber(
  key: string,
  initialValue: number
): UseLocalStorageReturn<number> {
  return useLocalStorage<number>(key, initialValue, {
    serializer: (value) => value.toString(),
    deserializer: (value) => parseFloat(value)
  });
}

export function useLocalStorageBoolean(
  key: string,
  initialValue: boolean
): UseLocalStorageReturn<boolean> {
  return useLocalStorage<boolean>(key, initialValue, {
    serializer: (value) => value.toString(),
    deserializer: (value) => value === 'true'
  });
}
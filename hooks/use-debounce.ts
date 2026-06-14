import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseDebounceOptions {
  delay?: number;
  leading?: boolean;
  trailing?: boolean;
  maxWait?: number;
}

export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  options: UseDebounceOptions = {}
): (...args: Parameters<T>) => void {
  const {
    delay = 300,
    leading = false,
    trailing = true,
    maxWait,
  } = options;

  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallTimeRef = useRef<number | null>(null);
  const pendingArgsRef = useRef<Parameters<T> | null>(null);
  const isLeadingCallRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const clearTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (maxTimeoutRef.current) {
      clearTimeout(maxTimeoutRef.current);
      maxTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearTimeouts;
  }, [clearTimeouts]);

  const debouncedFunction = useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    const isFirstCall = lastCallTimeRef.current === null;
    
    lastCallTimeRef.current = now;
    pendingArgsRef.current = args;

    if (isFirstCall && leading) {
      isLeadingCallRef.current = true;
      callbackRef.current(...args);
    } else {
      isLeadingCallRef.current = false;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (!isLeadingCallRef.current && trailing && pendingArgsRef.current) {
        callbackRef.current(...pendingArgsRef.current);
      }
      pendingArgsRef.current = null;
      lastCallTimeRef.current = null;
      isLeadingCallRef.current = false;
      timeoutRef.current = null;
    }, delay);

    if (maxWait && !maxTimeoutRef.current) {
      maxTimeoutRef.current = setTimeout(() => {
        if (pendingArgsRef.current) {
          callbackRef.current(...pendingArgsRef.current);
          pendingArgsRef.current = null;
        }
        clearTimeouts();
        lastCallTimeRef.current = null;
        isLeadingCallRef.current = false;
      }, maxWait);
    }
  }, [delay, leading, trailing, maxWait, clearTimeouts]);

  return debouncedFunction;
}

export function useDebounceValue<T>(value: T, delay?: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay || 300);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
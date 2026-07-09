import { useEffect, useState } from "react";

export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined" || !key) return typeof initialValue === "function" ? initialValue() : initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch {
      // Keep the default value when storage is unavailable or corrupted.
    }
    return typeof initialValue === "function" ? initialValue() : initialValue;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota/localStorage disabled: the in-memory state still works.
    }
  }, [key, value]);

  return [value, setValue];
}

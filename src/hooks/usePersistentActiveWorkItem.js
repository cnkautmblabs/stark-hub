import { useCallback, useMemo, useState } from "react";

function readStoredItem(key) {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeStoredItem(key, item) {
  if (typeof window === "undefined") return;
  try {
    if (!item) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(item));
  } catch {
    // Session storage unavailable: the in-memory modal state still works.
  }
}

export function usePersistentActiveWorkItem(key, items = []) {
  const [storedItem, setStoredItem] = useState(() => readStoredItem(key));

  const activeItem = useMemo(() => {
    if (!storedItem?.id) return null;
    return items.find((entry) => String(entry.id) === String(storedItem.id)) || storedItem;
  }, [items, storedItem]);

  const openItem = useCallback((item) => {
    if (!item) return;
    setStoredItem(item);
    writeStoredItem(key, item);
  }, [key]);

  const closeItem = useCallback(() => {
    setStoredItem(null);
    writeStoredItem(key, null);
  }, [key]);

  return { activeItem, openItem, closeItem };
}

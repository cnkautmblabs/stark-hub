import { useEffect } from "react";

export function useRevalidateOnFocus(callback, { enabled = true, minIntervalMs = 30000 } = {}) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    let lastRun = 0;
    function run() {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRun < minIntervalMs) return;
      lastRun = now;
      callback();
    }
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [callback, enabled, minIntervalMs]);
}

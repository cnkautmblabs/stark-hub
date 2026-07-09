const HIGHLIGHT_CLASS = "mbw-item-highlight";
const PENDING_KEY = "starkHubPendingWorkItemHighlight";

export function highlightWorkItem(id) {
  if (typeof document === "undefined" || id == null) return false;
  const selector = `[data-work-item-id="${id}"], [data-id="${id}"], [data-workitem-id="${id}"]`;
  const target = document.querySelector(selector);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  target.classList.remove(HIGHLIGHT_CLASS);
  window.setTimeout(() => target.classList.add(HIGHLIGHT_CLASS), 30);
  window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), 3600);
  return true;
}

export function savePendingWorkItemHighlight(id) {
  if (typeof window === "undefined" || id == null) return;
  try {
    window.sessionStorage.setItem(PENDING_KEY, String(id));
  } catch {
    // Ignore session storage failures.
  }
}

export function consumePendingWorkItemHighlight() {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

export function workItemHash(id) {
  return id == null ? "" : `#work-item-${id}`;
}

export function readWorkItemHash() {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#work-item-(\d+)/);
  return match ? Number(match[1]) : null;
}

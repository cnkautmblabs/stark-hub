const monthAliases = {
  janeiro: "Jan",
  fevereiro: "Feb",
  marco: "Mar",
  março: "Mar",
  abril: "Apr",
  maio: "May",
  junho: "Jun",
  julho: "Jul",
  agosto: "Aug",
  setembro: "Sep",
  outubro: "Oct",
  novembro: "Nov",
  dezembro: "Dec",
  january: "Jan",
  february: "Feb",
  march: "Mar",
  april: "Apr",
  may: "May",
  june: "Jun",
  july: "Jul",
  august: "Aug",
  september: "Sep",
  october: "Oct",
  november: "Nov",
  december: "Dec"
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sprintLeaf(value) {
  return String(value || "").split("\\").pop() || "";
}

export function compactSprintLabel(value) {
  const raw = sprintLeaf(value);
  const match = raw.match(/([A-Za-zÀ-ÿ]+)\s*\[?(20\d{2})\]?/i);
  if (!match) return raw || "-";
  const monthKey = match[1].toLowerCase();
  const month = monthAliases[monthKey] || match[1].slice(0, 3);
  return `${month}${match[2].slice(-2)}`;
}

export function isWebAppMbLabsSprint(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("webapp") && text.includes("mb labs");
}

export function currentSprintLabel(date = new Date()) {
  return `${monthNames[date.getMonth()]}${String(date.getFullYear()).slice(-2)}`;
}

export function findCurrentSprint(options = [], date = new Date()) {
  const current = currentSprintLabel(date).toLowerCase();
  return options.find((option) => compactSprintLabel(option).toLowerCase() === current) || "";
}

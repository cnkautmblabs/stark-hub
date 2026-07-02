import React from "react";

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export default function Avatar({ name, imageUrl, color = "#38bdf8", size = 34 }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (imageUrl) {
    return <span className="stark-avatar" style={{ ...style, backgroundImage: `url(${imageUrl})` }} title={name} />;
  }
  return (
    <span className="stark-avatar" style={{ ...style, background: color }} title={name}>
      {initials(name)}
    </span>
  );
}

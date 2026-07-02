import React from "react";

const hotPattern = /block|imped|critical|hotfix|devbox/i;

export default function TagPills({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <span className="d-inline-flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className={`stark-tag-pill ${hotPattern.test(tag) ? "hot" : ""}`}>{tag}</span>
      ))}
    </span>
  );
}

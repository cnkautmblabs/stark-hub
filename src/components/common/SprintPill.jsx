import React from "react";

export default function SprintPill({ sprint }) {
  if (!sprint) return null;
  return (
    <span className="stark-sprint-pill" title={sprint}>
      {sprint}
    </span>
  );
}

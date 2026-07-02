import React from "react";

export function SkeletonLine({ width = "100%", height = 14 }) {
  return <div className="stark-skeleton mb-2" style={{ width, height }} />;
}

export function SkeletonCard() {
  return (
    <div className="stark-card">
      <SkeletonLine width="40%" height={16} />
      <SkeletonLine width="90%" />
      <SkeletonLine width="70%" />
    </div>
  );
}

import React from "react";

// Ícone original inspirado em um "núcleo de energia" (reactor core) genérico,
// sem reproduzir personagens ou marcas registradas de terceiros.
export default function ReactorLogo({ size = 30 }) {
  return (
    <svg
      className="stark-reactor"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="30" fill="#0b1220" stroke="#38bdf8" strokeWidth="2" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.5" />
      <g className="core">
        <circle cx="32" cy="32" r="13" fill="#0ea5e9" opacity="0.25" />
        <circle cx="32" cy="32" r="8" fill="#38bdf8" />
        <circle cx="32" cy="32" r="4" fill="#e0f4ff" />
      </g>
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <rect
          key={angle}
          x="30.5"
          y="6"
          width="3"
          height="10"
          rx="1.5"
          fill="#38bdf8"
          opacity="0.8"
          transform={`rotate(${angle} 32 32)`}
        />
      ))}
    </svg>
  );
}

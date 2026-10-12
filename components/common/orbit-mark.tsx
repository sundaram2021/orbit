import React from "react";

interface OrbitMarkProps {
  className?: string;
}

export function OrbitMark({ className = "" }: OrbitMarkProps) {
  return (
    <span className={`orbit-mark ${className}`} aria-hidden="true">
      <span />
    </span>
  );
}

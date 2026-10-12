import React from "react";

interface LiveDotProps {
  className?: string;
}

export function LiveDot({ className = "" }: LiveDotProps) {
  return <span className={`live-dot ${className}`} />;
}

"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * Drawn as one SVG path from the module matrix. Always dark on light, in
 * both themes: authenticator-app scanners expect that contrast, and an
 * inverted code fails on many of them.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 4 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, size: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-48 rounded-lg bg-white text-black"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

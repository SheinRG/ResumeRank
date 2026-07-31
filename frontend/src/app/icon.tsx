import { ImageResponse } from "next/og";

// The tab icon mirrors the in-app logo mark: an ink "R" on the lime tile
// (--color-brand-lime / --color-brand-night in globals.css).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#c6f24e",
          color: "#0a0d14",
          fontSize: 24,
          fontWeight: 700,
          borderRadius: 7,
        }}
      >
        R
      </div>
    ),
    size,
  );
}

import { ImageResponse } from "next/og";

export const alt = "ResumeRank — Evidence-based AI resume screening";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const VERDICTS: Array<{ label: string; color: string }> = [
  { label: "Strong", color: "#34d399" },
  { label: "Partial", color: "#fbbf24" },
  { label: "Missing", color: "#fb7185" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "radial-gradient(circle at 18% 12%, #312e81 0%, #0b0b14 55%, #050507 100%)",
          color: "#f4f4f5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#6366f1",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>
            ResumeRank
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 920 }}>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.12, letterSpacing: -1.5 }}>
            Score every applicant against your actual requirements — with evidence.
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#a1a1aa", fontWeight: 400 }}>
            Weighted scores, quoted evidence, and explicit gaps — no black box.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {VERDICTS.map((v) => (
            <div
              key={v.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: v.color,
                }}
              />
              {v.label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}

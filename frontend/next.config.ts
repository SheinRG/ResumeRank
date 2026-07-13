import { config } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// The repo keeps a single .env at the root; Next runs with the frontend
// workspace as cwd, so load it from one level up before the config is read.
config({ path: resolve(process.cwd(), "../.env") });

const isDev = process.env.NODE_ENV === "development";

// 'unsafe-inline'/'unsafe-eval' are the pragmatic floor for Next.js without
// per-request nonces; everything else is locked to self.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@resumerank/core"],
  // Pin the monorepo root so file tracing spans backend + frontend and does not
  // latch onto an unrelated lockfile higher up the filesystem.
  turbopack: { root: resolve(process.cwd(), "..") },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

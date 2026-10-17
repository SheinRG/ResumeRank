import { config } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

import { contentSecurityPolicy, samlPostFormPolicy } from "./src/lib/csp";

// The repo keeps a single .env at the root; Next runs with the frontend
// workspace as cwd, so load it from one level up before the config is read.
config({ path: resolve(process.cwd(), "../.env") });

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Pages get a per-request nonce policy from the proxy. API responses render
// no React, so they get a fixed policy with no inline script at all, except
// the SAML POST-binding page, which may post off-site to the tenant's IdP.
// Later entries win, so its policy replaces the API one.
const apiPolicy = [{ key: "Content-Security-Policy", value: contentSecurityPolicy("none") }];
const ssoAuthorizePolicy = [{ key: "Content-Security-Policy", value: samlPostFormPolicy() }];

const nextConfig: NextConfig = {
  transpilePackages: ["@resumerank/core"],
  // The SSO service lazily requires database drivers it never uses here
  // (TypeORM, Mongo, MSSQL); bundling it would try to resolve them all. The
  // resume readers load native binaries, worker threads, WebAssembly and
  // language data by path at runtime, so they too stay in node_modules.
  serverExternalPackages: [
    "@boxyhq/saml-jackson",
    "@napi-rs/canvas",
    "@tesseract.js-data/eng",
    "mammoth",
    "tesseract.js",
    "unpdf",
  ],
  // Those runtime paths are invisible to file tracing; ship them with every
  // route that reads resume files (the upload action's page, the poll, the cron).
  outputFileTracingIncludes: Object.fromEntries(
    ["/candidates/\\[id\\]", "/api/candidates/\\[id\\]/resume-files", "/api/cron/resume-files"].map((route) => [
      route,
      [
        "../node_modules/@tesseract.js-data/eng/4.0.0/**/*",
        "../node_modules/tesseract.js/src/worker-script/**/*",
        "../node_modules/tesseract.js-core/*",
      ],
    ]),
  ),
  cacheComponents: true,
  // Pin the monorepo root so file tracing spans backend + frontend and does not
  // latch onto an unrelated lockfile higher up the filesystem.
  turbopack: { root: resolve(process.cwd(), "..") },
  experimental: {
    // Resume uploads are files of up to 4 MB, plus the multipart envelope.
    serverActions: { bodySizeLimit: "4.5mb" },
    // Persist Turbopack's compile graph to .next between dev restarts, and cut
    // per-route first-visit compiles by only bundling named imports actually
    // used from these export-heavy packages.
    turbopackFileSystemCacheForDev: true,
    optimizePackageImports: ["framer-motion", "gsap"],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/api/:path*", headers: apiPolicy },
      { source: "/api/oauth/authorize", headers: ssoAuthorizePolicy },
    ];
  },
};

export default nextConfig;

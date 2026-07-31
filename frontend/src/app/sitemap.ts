import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

// Only public marketing pages are indexable; everything under the signed-in
// app is excluded (see robots.ts) and has no reason to appear in a sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();

  return [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/register`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/login`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}

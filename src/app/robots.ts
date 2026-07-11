import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/jobs",
        "/candidates",
        "/applications",
        "/activity",
        "/settings",
        "/api",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

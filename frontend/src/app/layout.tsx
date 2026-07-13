import type { Metadata } from "next";
import {
  Instrument_Sans,
  JetBrains_Mono,
  Space_Grotesk,
  Fredoka,
} from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { siteUrl } from "@/lib/site";

import "./globals.css";

// Body copy across the whole product.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

// Metadata, labels, scores — the monospace voice.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Display face for the marketing surface.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Display face for the signed-in app.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const DESCRIPTION =
  "ResumeRank scores every applicant against your job's actual requirements — with quoted evidence and explicit gaps — so you can shortlist in under 60 seconds without trusting a black box.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "ResumeRank — Evidence-based AI resume screening",
    template: "%s · ResumeRank",
  },
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ResumeRank",
    title: "ResumeRank — Evidence-based AI resume screening",
    description: DESCRIPTION,
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ResumeRank — Evidence-based AI resume screening",
    description: DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable} ${fredoka.variable} h-full`}
    >
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

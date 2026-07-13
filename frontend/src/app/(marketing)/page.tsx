import { siteUrl } from "@/lib/site";

import { FAQ_ITEMS } from "./_components/faq-data";
import { Faq } from "./_components/faq";
import { FinalCta } from "./_components/final-cta";
import { Hero } from "./_components/hero";
import { HowItWorks } from "./_components/how-it-works";
import { LandingMotion } from "./_components/landing-motion";
import { Marquee } from "./_components/marquee";
import { Testimonials } from "./_components/testimonials";
import { ValueProps } from "./_components/value-props";

function jsonLd() {
  const base = siteUrl();

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ResumeRank",
    description:
      "ResumeRank scores every applicant against your job's actual requirements — with quoted evidence and explicit gaps — so you can shortlist in under 60 seconds without trusting a black box.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: base,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  const faqPage = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return [softwareApplication, faqPage];
}

export default function MarketingHomePage() {
  return (
    <>
      {jsonLd().map((data) => (
        <script
          key={data["@type"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}

      <Hero />
      <Marquee />
      <ValueProps />
      <HowItWorks />
      <Testimonials />
      <Faq />
      <FinalCta />

      <LandingMotion />
    </>
  );
}

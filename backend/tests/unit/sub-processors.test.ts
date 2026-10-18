import { describe, expect, it } from "vitest";

import { subProcessors } from "../../src/sub-processors";

const names = (config: Parameters<typeof subProcessors>[0]) => subProcessors(config).map((entry) => entry.name);

describe("subProcessors", () => {
  it("lists nobody for a self-hosted install with nothing configured", () => {
    expect(names({ DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/resumerank" })).toEqual([]);
  });

  it("names the hosted stack from its configuration", () => {
    expect(
      names({
        VERCEL: "1",
        DATABASE_URL: "postgresql://app:secret@ep-quiet-sun-123456-pooler.eu-central-1.aws.neon.tech/neondb",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x",
        GROQ_API_KEY: "gsk_x",
        RESEND_API_KEY: "re_x",
        STRIPE_SECRET_KEY: "sk_test_x",
        AUTH_GOOGLE_ID: "id",
        AUTH_GOOGLE_SECRET: "secret",
      }),
    ).toEqual(["Vercel", "Neon", "Vercel Blob", "Groq", "Resend", "Stripe", "Google"]);
  });

  it("doesn't mistake a lookalike host for Neon", () => {
    expect(names({ DATABASE_URL: "postgresql://u:p@neon.tech.example.com/db" })).toEqual([]);
    expect(names({ DATABASE_URL: "not a url" })).toEqual([]);
  });

  it("lists the email provider that actually delivers", () => {
    const smtp = { SMTP_HOST: "smtp.gmail.com", SMTP_USER: "me@gmail.com", SMTP_PASSWORD: "app-password" };
    expect(names(smtp)).toEqual(["Google (Gmail)"]);
    expect(names({ ...smtp, RESEND_API_KEY: "re_x" })).toEqual(["Resend"]);
    expect(names({ ...smtp, SMTP_PASSWORD: undefined })).toEqual([]);
    expect(names({ SMTP_HOST: "mail.internal.example.com", SMTP_USER: "u", SMTP_PASSWORD: "p" })).toEqual([]);
  });

  it("needs both halves of the Google client before listing Google sign-in", () => {
    expect(names({ AUTH_GOOGLE_ID: "id" })).toEqual([]);
  });
});

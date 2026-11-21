import { describe, expect, it } from "vitest";

import { canonicalForMatch, isListedOnly, listingLines } from "../../src/scoring/evidence";
import { copiedWordCount, copiesJob } from "../../src/scoring/jd-copy";

describe("canonicalForMatch", () => {
  it("keeps only letters and digits, folded", () => {
    expect(canonicalForMatch("Built “ﬁnance” pipe-\nlines!")).toBe("builtfinancepipelines");
  });
});

describe("listingLines", () => {
  it("marks labelled skills lines and the list under a skills heading, until the next section", () => {
    const lines = [
      "Alex Kim — Engineer",
      "Technical Skills",
      "Python, SQL, Airflow",
      "Cloud: AWS, GCP",
      "Experience",
      "Built 40 Airflow DAGs for the finance team.",
      "Tools: Docker | Helm",
      "Languages: Spanish (native), English",
    ];
    expect(listingLines(lines)).toEqual([false, true, true, true, false, false, true, false]);
  });

  it("ends a skills section at the first line that describes rather than lists", () => {
    expect(listingLines(["Skills", "Go, Rust", "Rewrote the billing service in Go over six months."])).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("isListedOnly", () => {
  const resume = [
    "Jordan Lee — Support Lead",
    "- Ran the support rota for a 12-person team.",
    "- Wrote Python scripts that triage incoming tickets.",
    "",
    "Skills: Kubernetes, Terraform, Python",
  ].join("\n");

  it("is true for a skill that appears only in the skills list", () => {
    expect(isListedOnly("Kubernetes", resume)).toBe(true);
    expect(isListedOnly("Skills: Kubernetes, Terraform", resume)).toBe(true);
  });

  it("is false once the skill also appears in use", () => {
    expect(isListedOnly("Python", resume)).toBe(false);
    expect(isListedOnly("Wrote Python scripts that triage incoming tickets.", resume)).toBe(false);
  });

  it("is false for a quote not in the resume or with nothing to match", () => {
    expect(isListedOnly("Ansible", resume)).toBe(false);
    expect(isListedOnly("—", resume)).toBe(false);
  });

  it("judges a quote that spans lines by every line it needs", () => {
    const wrapped = "Skills: Kubernetes, Terraform,\nPython\nWrote Python scripts.";
    expect(isListedOnly("Terraform, Python", wrapped)).toBe(true);
  });
});

describe("copiesJob", () => {
  const job = {
    description:
      "You will own the design system and the performance of our customer dashboard, working closely with product and design to ship accessible, fast interfaces.",
    requirements: [{ label: "Production React experience" }],
  };

  it("flags a resume that lifts the job's sentences", () => {
    const resume = `Summary: I will own the design system and the performance of our customer dashboard, working closely with product and design to ship accessible, fast interfaces.\nBuilt React apps.`;
    expect(copiedWordCount(job, resume)).toBeGreaterThanOrEqual(20);
    expect(copiesJob(job, resume)).toBe(true);
  });

  it("leaves a resume that shares the job's vocabulary but not its sentences", () => {
    const resume =
      "Owned the design system at Ledgerly and cut dashboard load time by 40%, working with product and design on accessible interfaces in React.";
    expect(copiedWordCount(job, resume)).toBe(0);
    expect(copiesJob(job, resume)).toBe(false);
  });

  it("does not flag one short shared phrase", () => {
    const resume = "Worked closely with product and design to ship accessible, fast interfaces for our customers.";
    expect(copiesJob(job, resume)).toBe(false);
  });
});

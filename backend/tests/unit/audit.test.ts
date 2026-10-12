import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { describeChainBreak, findChainBreak, type ChainEntry } from "../../src/audit/chain";
import { AUDIT_CSV_HEADER, auditCsvRow, toAuditEvent, type AuditEvent } from "../../src/audit/events";
import { isPublicAddress, OutboundError, parseOutboundUrl } from "../../src/audit/outbound";
import {
  buildStreamRequest,
  generateSigningSecret,
  SIGNATURE_HEADER,
  signWebhook,
  streamBackoffMs,
} from "../../src/audit/stream-format";
import { auditExportParamsSchema, auditRetentionSchema, auditStreamSchema } from "../../src/validators/audit";

function entry(seq: number, prevHash: string | null, hash = `h${seq}`, expectedHash = hash): ChainEntry {
  return { seq, prevHash, hash, expectedHash };
}

function chain(length: number, from = 1): ChainEntry[] {
  return Array.from({ length }, (_, index) => {
    const seq = from + index;
    return entry(seq, seq === 1 ? null : `h${seq - 1}`);
  });
}

const EVENT: AuditEvent = {
  id: "evt_1",
  seq: 42,
  timestamp: "2026-10-12T09:30:00.000Z",
  companyId: "company_1",
  action: "candidate.export",
  entityType: "candidate",
  entityId: "company_1",
  actorId: "user_1",
  actorName: "Ada Admin",
  actorEmail: "ada@example.test",
  summary: "exported 3 candidates to CSV",
  metadata: { rowCount: 3 },
  prevHash: "a".repeat(64),
  hash: "b".repeat(64),
};

describe("findChainBreak", () => {
  it("accepts an unbroken chain from the first entry", () => {
    expect(findChainBreak(null, chain(5))).toBeNull();
  });

  it("accepts a later batch that continues from the previous one", () => {
    expect(findChainBreak({ seq: 3, hash: "h3" }, chain(3, 4))).toBeNull();
  });

  it("flags an entry whose content no longer matches its hash", () => {
    const entries = chain(4);
    entries[2] = entry(3, "h2", "h3", "recomputed-differently");
    expect(findChainBreak(null, entries)).toEqual({ seq: 3, fault: "altered" });
  });

  it("flags a gap in the sequence as the first missing entry", () => {
    const entries = chain(5).filter((item) => item.seq !== 3);
    expect(findChainBreak(null, entries)).toEqual({ seq: 3, fault: "missing" });
  });

  it("flags an entry that doesn't point at its predecessor", () => {
    const entries = chain(3);
    entries[2] = entry(3, "forged");
    expect(findChainBreak(null, entries)).toEqual({ seq: 3, fault: "unlinked" });
  });

  it("flags a chain whose oldest entries are gone without an anchor", () => {
    expect(findChainBreak(null, chain(3, 7))).toEqual({ seq: 7, fault: "unanchored" });
  });

  it("flags a first entry that claims a predecessor", () => {
    expect(findChainBreak(null, [entry(1, "h0")])).toEqual({ seq: 1, fault: "unanchored" });
  });

  it("describes every fault in words", () => {
    for (const fault of ["missing", "unlinked", "altered", "unanchored"] as const) {
      expect(describeChainBreak({ seq: 9, fault })).toContain("#9");
    }
  });
});

describe("audit events", () => {
  it("skips rows their transaction hasn't sealed", () => {
    const row = {
      id: "evt_1",
      seq: null,
      createdAt: new Date(EVENT.timestamp),
      companyId: "company_1",
      action: "job.create",
      entityType: "job",
      entityId: "job_1",
      actorId: null,
      summary: "created a job",
      metadata: null,
      prevHash: null,
      hash: null,
      actor: null,
    };
    expect(toAuditEvent(row)).toBeNull();
    expect(toAuditEvent({ ...row, seq: BigInt(7), hash: "c".repeat(64) })).toMatchObject({ seq: 7, actorName: null });
  });

  it("writes one CSV cell per header column, with metadata as JSON", () => {
    const cells = auditCsvRow(EVENT).split(",");
    expect(cells).toHaveLength(AUDIT_CSV_HEADER.length);
    expect(auditCsvRow(EVENT)).toContain('"{""rowCount"":3}"');
  });

  it("neutralises spreadsheet formulas in exported text", () => {
    const row = auditCsvRow({ ...EVENT, summary: "=HYPERLINK(\"http://evil.test\")" });
    expect(row).toContain("'=HYPERLINK");
  });
});

describe("stream requests", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");

  it("signs webhook batches over the timestamp and body", () => {
    const secret = generateSigningSecret();
    const request = buildStreamRequest("WEBHOOK", secret, [EVENT], now);
    const timestamp = Math.floor(now.getTime() / 1000);
    const expected = createHmac("sha256", secret).update(`${timestamp}.${request.body}`).digest("hex");

    expect(JSON.parse(request.body)).toEqual({ events: [EVENT] });
    expect(request.headers[SIGNATURE_HEADER]).toBe(`t=${timestamp},v1=${expected}`);
    expect(signWebhook(secret, `${request.body} `, timestamp)).not.toBe(request.headers[SIGNATURE_HEADER]);
  });

  it("generates distinct, prefixed signing secrets", () => {
    const secret = generateSigningSecret();
    expect(secret).toMatch(/^whsec_[\w-]{43}$/);
    expect(generateSigningSecret()).not.toBe(secret);
  });

  it("sends Splunk one HEC event object per entry", () => {
    const request = buildStreamRequest("SPLUNK", "hec-token", [EVENT, { ...EVENT, id: "evt_2", seq: 43 }], now);
    const lines = request.body.split("\n").map((line) => JSON.parse(line));

    expect(request.headers.Authorization).toBe("Splunk hec-token");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      time: Date.parse(EVENT.timestamp) / 1000,
      source: "resumerank",
      sourcetype: "resumerank:audit",
      event: EVENT,
    });
  });

  it("sends Datadog an array with the event under its own attribute", () => {
    const request = buildStreamRequest("DATADOG", "dd-key", [EVENT], now);
    const [log] = JSON.parse(request.body);

    expect(request.headers["DD-API-KEY"]).toBe("dd-key");
    expect(log).toMatchObject({
      ddsource: "resumerank",
      timestamp: EVENT.timestamp,
      message: "Ada Admin exported 3 candidates to CSV",
      audit: EVENT,
    });
  });

  it("backs off from a minute, doubling, up to an hour", () => {
    expect(streamBackoffMs(1)).toBe(60_000);
    expect(streamBackoffMs(2)).toBe(120_000);
    expect(streamBackoffMs(4)).toBe(480_000);
    expect(streamBackoffMs(20)).toBe(60 * 60 * 1000);
  });
});

describe("outbound URLs", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.20.0.5",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("treats %s as private", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])("treats %s as public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("accepts an https URL on a hostname, any port", () => {
    expect(parseOutboundUrl("https://splunk.example.com:8088/services/collector/event").port).toBe("8088");
  });

  it.each([
    ["http://siem.example.com/hook", "https://"],
    ["https://user:pass@siem.example.com/hook", "credentials"],
    ["https://169.254.169.254/latest/meta-data", "private"],
    ["https://[::1]/hook", "private"],
    ["not a url", "full URL"],
  ])("rejects %s", (url, message) => {
    expect(() => parseOutboundUrl(url)).toThrow(OutboundError);
    expect(() => parseOutboundUrl(url)).toThrow(message);
  });
});

describe("audit validators", () => {
  it("allows only the listed retention periods, or forever", () => {
    expect(auditRetentionSchema.safeParse({ retentionDays: 365 }).success).toBe(true);
    expect(auditRetentionSchema.safeParse({ retentionDays: null }).success).toBe(true);
    expect(auditRetentionSchema.safeParse({ retentionDays: 1 }).success).toBe(false);
  });

  it("checks the export range", () => {
    expect(auditExportParamsSchema.safeParse({ format: "jsonl", from: "2026-01-01", to: "2026-02-01" }).success).toBe(true);
    expect(auditExportParamsSchema.safeParse({ format: "csv" }).success).toBe(true);
    const backwards = auditExportParamsSchema.safeParse({ format: "csv", from: "2026-02-01", to: "2026-01-01" });
    expect(backwards.success).toBe(false);
    expect(auditExportParamsSchema.safeParse({ format: "xml" }).success).toBe(false);
    expect(auditExportParamsSchema.safeParse({ format: "csv", from: "yesterday" }).success).toBe(false);
  });

  it("requires an https endpoint for a stream", () => {
    expect(auditStreamSchema.safeParse({ kind: "SPLUNK", url: "https://splunk.example.com", token: "t" }).success).toBe(true);
    expect(auditStreamSchema.safeParse({ kind: "WEBHOOK", url: "http://example.com" }).success).toBe(false);
    expect(auditStreamSchema.safeParse({ kind: "SYSLOG", url: "https://example.com" }).success).toBe(false);
  });
});

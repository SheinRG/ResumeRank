/**
 * Checks a company's audit hash chain (built by the audit_seal trigger in
 * the "audit_log" migration). The hashes themselves are recomputed in SQL by
 * audit_entry_hash, so there is exactly one definition of the encoding.
 */

export interface ChainEntry {
  seq: number;
  prevHash: string | null;
  hash: string;
  /** What audit_entry_hash computes from the entry's stored content now. */
  expectedHash: string;
}

export interface ChainLink {
  seq: number;
  hash: string;
}

/**
 * - `missing`: an entry in the middle of the chain is gone.
 * - `unlinked`: an entry doesn't name the hash of the one before it.
 * - `altered`: an entry's content no longer matches its own hash.
 * - `unanchored`: the oldest entries are gone and no retention purge accounts for it.
 */
export type ChainFault = "missing" | "unlinked" | "altered" | "unanchored";

export interface ChainBreak {
  seq: number;
  fault: ChainFault;
}

/**
 * The first break in `entries`, which continue from `previous` — the entry
 * before them, or null when they start the chain.
 */
export function findChainBreak(previous: ChainLink | null, entries: readonly ChainEntry[]): ChainBreak | null {
  let last = previous;
  for (const entry of entries) {
    if (last === null) {
      if (entry.seq !== 1 || entry.prevHash !== null) return { seq: entry.seq, fault: "unanchored" };
    } else {
      if (entry.seq !== last.seq + 1) return { seq: last.seq + 1, fault: "missing" };
      if (entry.prevHash !== last.hash) return { seq: entry.seq, fault: "unlinked" };
    }
    if (entry.hash !== entry.expectedHash) return { seq: entry.seq, fault: "altered" };
    last = { seq: entry.seq, hash: entry.hash };
  }
  return null;
}

export function describeChainBreak({ seq, fault }: ChainBreak): string {
  switch (fault) {
    case "missing":
      return `Entry #${seq} is missing from the log.`;
    case "unlinked":
      return `Entry #${seq} doesn't point at the entry before it, so entries were removed or reordered.`;
    case "altered":
      return `Entry #${seq} was changed after it was written.`;
    case "unanchored":
      return `Entries before #${seq} were deleted, and not by the retention policy.`;
  }
}

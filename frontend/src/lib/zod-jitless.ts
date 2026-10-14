import { config } from "zod";

// Zod probes `new Function` on first parse to decide whether it may compile
// object parsers. The CSP forbids eval, so the probe would fail and file a
// violation report on every form page; opting out skips it.
config({ jitless: true });

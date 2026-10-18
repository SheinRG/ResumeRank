"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

import type { ActionResult } from "@resumerank/core/types/action";

/** Runs a server action; if it needs a recent sign-in, asks the person to confirm it's them and runs it again. */
export type StepUpRunner = <T>(run: () => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;

const passthrough: StepUpRunner = (run) => run();

const StepUpContext = createContext<StepUpRunner>(passthrough);

/** Outside the signed-in app there's nothing to step up, so it simply runs the action. */
export function useStepUp(): StepUpRunner {
  return useContext(StepUpContext);
}

// Loaded the first time it's needed: the passkey library and the forms would
// otherwise ride along on every page of the app.
const StepUpDialog = dynamic(() => import("./step-up-dialog"), { ssr: false });

/**
 * Lets any component in the signed-in app run a sensitive action through
 * `useStepUp()`: when the server answers `reauth_required`, the dialog asks
 * the person to confirm it's them and the action is retried once.
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpening((count) => count + 1);
        setOpen(true);
      }),
    [],
  );

  const withStepUp = useCallback<StepUpRunner>(
    async (run) => {
      const first = await run();
      if (first.ok || first.code !== "reauth_required") return first;
      return (await confirm()) ? run() : first;
    },
    [confirm],
  );

  function done(confirmed: boolean) {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  }

  return (
    <StepUpContext.Provider value={withStepUp}>
      {children}
      {opening > 0 ? <StepUpDialog key={opening} open={open} onDone={done} /> : null}
    </StepUpContext.Provider>
  );
}

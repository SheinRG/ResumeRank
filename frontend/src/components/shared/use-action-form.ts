"use client";

import { useState, useTransition } from "react";
import type { ZodType } from "zod";

import type { ActionResult } from "@resumerank/core/types/action";

export type FieldErrors = Record<string, string[] | undefined>;

/**
 * The shared submit lifecycle for forms backed by a server action: validate
 * the raw input with the same Zod schema the server uses, surface per-field
 * errors, run the action inside a transition, and route the typed result to
 * `onSuccess` / `onError`. Keeps every form's `handleSubmit` down to building
 * its input object and calling `submit`.
 */
export function useActionForm<TInput, TData>({
  schema,
  action,
  onSuccess,
  onError,
}: {
  schema: ZodType<TInput>;
  action: (input: TInput) => Promise<ActionResult<TData>>;
  onSuccess: (data: TData) => void;
  onError?: (message: string) => void;
}) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(rawInput: unknown) {
    setFormError(null);
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = await action(parsed.data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        onError?.(result.error);
        return;
      }
      onSuccess(result.data);
    });
  }

  return { fieldErrors, formError, isPending, submit };
}

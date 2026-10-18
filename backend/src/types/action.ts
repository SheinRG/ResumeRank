/**
 * Uniform result type for every server action. Actions never throw at the
 * boundary — client code can always narrow on `ok` and show a named error.
 */
/** Failures the client handles itself rather than just showing: `reauth_required` opens the step-up dialog. */
export type ActionErrorCode = "reauth_required";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: ActionErrorCode };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError<T = undefined>(
  error: string,
  fieldErrors?: Record<string, string[]>,
  code?: ActionErrorCode,
): ActionResult<T> {
  return code ? { ok: false, error, fieldErrors, code } : { ok: false, error, fieldErrors };
}

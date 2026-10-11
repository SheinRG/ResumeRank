/**
 * The browser rejects a WebAuthn ceremony with a DOMException-style name;
 * these are the ones people cause themselves and can act on.
 */
export function passkeyErrorMessage(error: unknown, ceremony: "register" | "verify"): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return ceremony === "register"
      ? "Passkey setup was cancelled or timed out. Try again when you're ready."
      : "The passkey check was cancelled or timed out. Try again.";
  }
  if (name === "InvalidStateError") {
    return "That passkey is already registered to your account.";
  }
  if (name === "SecurityError") {
    return "Passkeys don't work on this address. Open ResumeRank at its usual web address and try again.";
  }
  return ceremony === "register"
    ? "Your browser couldn't create a passkey. Try another device or an authenticator app."
    : "Your browser couldn't use a passkey. Try another method.";
}

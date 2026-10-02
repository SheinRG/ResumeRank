"use client";

import { Loader2, LogOut } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { signOutEverywhereAction } from "@/server/actions/users";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <LogOut aria-hidden="true" />
      )}
      {pending ? "Signing out…" : "Sign out of all devices"}
    </Button>
  );
}

export function SignOutEverywhere() {
  return (
    <form action={signOutEverywhereAction}>
      <SubmitButton />
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { useState, useTransition } from "react";

import { AuthAlert } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { acceptPendingInviteAction } from "@/server/actions/company";

function InviteJoinButton({
  inviteId,
  companyName,
}: {
  inviteId: string;
  companyName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleJoin() {
    setError(null);
    startTransition(async () => {
      const result = await acceptPendingInviteAction(inviteId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <AuthAlert>{error}</AuthAlert> : null}
      <Button className="w-full" disabled={isPending} onClick={handleJoin}>
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <LogIn aria-hidden="true" />
        )}
        Join {companyName}
      </Button>
    </div>
  );
}

export { InviteJoinButton };

"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { Button } from "@/components/ui/button";
import type { PasswordPolicy } from "@resumerank/core/auth/password-policy";
import { logoutAction } from "@/server/actions/auth";

export function PasswordChangeGate({ policy }: { policy: PasswordPolicy }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <ChangePasswordForm
        policy={policy}
        onChanged={() => {
          router.push("/dashboard");
          router.refresh();
        }}
      />
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" className="-ml-3">
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

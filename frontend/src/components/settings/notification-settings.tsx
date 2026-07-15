"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { updateNotificationPreferencesAction } from "@/server/actions/users";

export function NotificationSettings({
  notifyByEmail,
}: {
  notifyByEmail: boolean;
}) {
  const [enabled, setEnabled] = useState(notifyByEmail);
  const [isPending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await updateNotificationPreferencesAction({
        notifyByEmail: next,
      });
      if (!result.ok) {
        setEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Email notifications on." : "Email notifications off.");
    });
  }

  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Email notifications</p>
        <p className="text-sm text-muted-foreground">
          Optional product and activity updates. Security emails — verification
          and password resets — are always sent.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={isPending}
        aria-label="Email notifications"
      />
    </div>
  );
}

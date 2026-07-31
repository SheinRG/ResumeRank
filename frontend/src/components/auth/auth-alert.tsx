import { CircleAlert, CircleCheckBig } from "lucide-react";

import { cn } from "@/lib/utils";

type AuthAlertProps = {
  tone?: "error" | "success";
  children: React.ReactNode;
  className?: string;
};

function AuthAlert({ tone = "error", children, className }: AuthAlertProps) {
  const Icon = tone === "success" ? CircleCheckBig : CircleAlert;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "error"
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-emerald-600/20 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="leading-snug">{children}</p>
    </div>
  );
}

export { AuthAlert };

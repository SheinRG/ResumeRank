"use client";

import { LogOut, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mfa/confirm-dialog";
import { SignOutEverywhere } from "@/components/settings/sign-out-everywhere";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type Formatters } from "@/lib/format";
import { useFormat } from "@/components/format/format-provider";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/server/actions/sessions";
import type { LoginSessionSummary } from "@/server/queries/sessions";

const METHOD_LABELS: Record<LoginSessionSummary["method"], string> = {
  PASSWORD: "Password",
  GOOGLE: "Google",
  SSO: "SSO",
};

function sessionDetail(session: LoginSessionSummary, format: Formatters): string {
  return [
    session.workspace,
    session.ipAddress,
    `signed in ${format.date(session.createdAt)}`,
    session.current ? "active now" : `active ${format.relative(session.lastSeenAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SessionRow({ session }: { session: LoginSessionSummary }) {
  const format = useFormat();
  const Icon = /(?:iOS|Android)$/.test(session.device) ? Smartphone : Monitor;

  async function revoke(): Promise<boolean> {
    const result = await revokeSessionAction({ sessionId: session.id });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(`Signed out of ${session.device}.`);
    return true;
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{session.device}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {METHOD_LABELS[session.method]}
            </Badge>
            {session.current ? (
              <Badge variant="outline" className="border-verdict-strong/40 text-verdict-strong">
                This device
              </Badge>
            ) : null}
          </div>
          <span className="font-mono text-xs text-muted-foreground">{sessionDetail(session, format)}</span>
        </div>
      </div>
      {session.current ? null : (
        <ConfirmDialog
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Sign out of ${session.device}`}
            >
              <LogOut aria-hidden="true" />
            </Button>
          }
          title={`Sign out of ${session.device}?`}
          description="That device is signed out on its next request and has to sign in again."
          confirmLabel="Sign out"
          pendingLabel="Signing out…"
          onConfirm={revoke}
        />
      )}
    </li>
  );
}

export function ActiveSessions({ sessions }: { sessions: LoginSessionSummary[] }) {
  const others = sessions.filter((session) => !session.current).length;

  async function revokeOthers(): Promise<boolean> {
    const result = await revokeOtherSessionsAction();
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    const { revoked } = result.data;
    toast.success(
      revoked === 1 ? "Signed out of 1 other session." : `Signed out of ${revoked} other sessions.`,
    );
    return true;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Everywhere you&apos;re signed in. Sign out of anything you don&apos;t recognise, then change
          your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
        {others === 0 ? (
          <p className="text-sm text-muted-foreground">You aren&apos;t signed in anywhere else.</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {others > 0 ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="outline">
                  <LogOut aria-hidden="true" />
                  Sign out of other sessions
                </Button>
              }
              title="Sign out of every other session?"
              description="Every device except this one has to sign in again."
              confirmLabel="Sign out others"
              pendingLabel="Signing out…"
              onConfirm={revokeOthers}
            />
          ) : null}
          <SignOutEverywhere />
        </div>
      </CardContent>
    </Card>
  );
}

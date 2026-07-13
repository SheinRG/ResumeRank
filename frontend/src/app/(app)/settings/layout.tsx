import type { ReactNode } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Manage your profile and team." />
      <SettingsNav />
      {children}
    </div>
  );
}

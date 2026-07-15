"use client";

import { usePathname, useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "profile", href: "/settings", label: "Profile" },
  { value: "account", href: "/settings/account", label: "Account" },
  { value: "team", href: "/settings/team", label: "Team" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active = pathname.startsWith("/settings/team")
    ? "team"
    : pathname.startsWith("/settings/account")
      ? "account"
      : "profile";

  function handleChange(value: string) {
    const tab = TABS.find((item) => item.value === value);
    if (tab) router.push(tab.href);
  }

  return (
    <Tabs value={active} onValueChange={handleChange}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

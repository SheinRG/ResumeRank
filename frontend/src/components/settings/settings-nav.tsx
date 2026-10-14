"use client";

import { usePathname, useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "profile", href: "/settings", label: "Profile" },
  { value: "account", href: "/settings/account", label: "Account" },
  { value: "security", href: "/settings/security", label: "Security" },
  { value: "team", href: "/settings/team", label: "Team" },
  { value: "departments", href: "/settings/departments", label: "Departments" },
  { value: "company", href: "/settings/company", label: "Company" },
  { value: "sso", href: "/settings/sso", label: "SSO" },
  { value: "audit", href: "/settings/audit", label: "Audit log" },
  { value: "api", href: "/settings/api", label: "API" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active =
    TABS.find((tab) => tab.href !== "/settings" && pathname.startsWith(tab.href))?.value ?? "profile";

  function handleChange(value: string) {
    const tab = TABS.find((item) => item.value === value);
    if (tab) router.push(tab.href);
  }

  return (
    <Tabs value={active} onValueChange={handleChange}>
      {/* The tabs outgrow a phone screen; the strip scrolls instead of the page. */}
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

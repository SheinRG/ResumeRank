import { SiteFooter } from "./_components/site-footer";
import { SiteNav } from "./_components/site-nav";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1 flex-col overflow-x-clip bg-brand-night text-brand-cream">
      <SiteNav />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

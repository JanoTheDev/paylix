import { getActiveOrgOrRedirect } from "@/lib/require-active-org";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { ModeBanner } from "@/components/mode-banner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { livemode } = await getActiveOrgOrRedirect();
  const mode = livemode ? "live" : "test";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar mode={mode} />
      <MobileNav mode={mode} />
      <div className="min-h-screen lg:ml-60">
        <ModeBanner mode={mode} />
        {children}
      </div>
    </div>
  );
}

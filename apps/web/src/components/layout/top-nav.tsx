import Link from "next/link";
import { siteConfig } from "@/config/site";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { ProfileMenu } from "@/components/layout/profile-menu";

export function TopNav({ homeHref }: { homeHref: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
      <Link href={homeHref} className="text-sm font-semibold">
        {siteConfig.name}
      </Link>
      <div className="flex items-center gap-2">
        <ThemeSwitcher />
        <ProfileMenu />
      </div>
    </header>
  );
}

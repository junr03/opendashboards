import { requireUser } from "@/lib/auth/user";

import { AvatarCircle } from "./user-avatar";
import { UserMenu } from "./user-menu";

/** The signed-in user at the bottom of the sidebar. Reads the request, so it renders behind Suspense. */
export async function SidebarUser() {
  const user = await requireUser();
  return (
    <UserMenu
      email={user.email}
      side="top"
      align="start"
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-black/[0.06]"
    >
      <AvatarCircle name={user.email} className="size-7" />
      <span className="min-w-0 truncate text-sm text-foreground/80">{user.email}</span>
    </UserMenu>
  );
}

export function SidebarUserFallback() {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5" aria-hidden>
      <span className="size-7 rounded-full bg-neutral-200" />
      <span className="h-3 w-20 rounded bg-neutral-200" />
    </div>
  );
}

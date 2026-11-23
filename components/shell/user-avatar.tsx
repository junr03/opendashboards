import { requireUser } from "@/lib/auth/user";
import { cn } from "@/lib/utils";

import { UserMenu } from "./user-menu";

export function initialsFor(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export function AvatarCircle({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-700",
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}

/** The compact avatar for the mobile top bar. Reads the request, so it renders behind Suspense. */
export async function UserAvatar() {
  const user = await requireUser();
  return (
    <UserMenu
      email={user.email}
      side="bottom"
      align="end"
      className="rounded-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <AvatarCircle name={user.email} />
    </UserMenu>
  );
}

export function UserAvatarFallback() {
  return <span className="size-8 rounded-full bg-neutral-200" aria-hidden />;
}

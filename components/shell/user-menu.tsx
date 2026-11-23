"use client";

import { LogOutIcon } from "lucide-react";
import posthog from "posthog-js";
import { useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The gateway in front of OpenDashboards owns the session: it signs out on a POST here and sends the browser to `next`. */
const SIGN_OUT_URL = "/auth/signout?next=/";

/** The signed-in user's menu: who they are, and logging out. `children` is the trigger. */
export function UserMenu({
  email,
  side,
  align,
  className,
  children,
}: {
  email: string;
  side: "top" | "bottom";
  align: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);

  function logOut() {
    if (posthog.__loaded) posthog.reset();
    form.current?.submit();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Account menu for ${email}`} className={className}>
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align={align} className="min-w-52">
          <DropdownMenuLabel className="font-normal">
            Signed in as
            <span className="block truncate text-foreground" title={email}>
              {email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={logOut}>
            <LogOutIcon aria-hidden />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={form} method="post" action={SIGN_OUT_URL} hidden />
    </>
  );
}

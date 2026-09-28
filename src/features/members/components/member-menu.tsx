"use client"

import { HEADER_FOCUS } from "@/components/app-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { signOutAction } from "../actions"
import { initialsOf } from "../initials"

/**
 * The avatar menu in the app header (UX-DR10): the member's name, then Sign
 * out. The trigger is a 44px target around a 32px avatar, named for screen
 * readers as "<name>, account".
 */
export function MemberMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}, account`}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full",
          HEADER_FOCUS
        )}
      >
        <Avatar aria-hidden className="size-8 after:border-transparent">
          <AvatarFallback className="bg-white text-xs font-semibold text-navy">
            {initialsOf(name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuLabel className="text-sm text-foreground">
          {name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          {/* Keep the menu open on select: closing it would unmount this
              form before the browser submits it. The redirect to /login
              replaces the page. */}
          <DropdownMenuItem
            asChild
            onSelect={(event) => event.preventDefault()}
          >
            <button type="submit" className="min-h-11 w-full">
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

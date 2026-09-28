"use client"

import { useState } from "react"
import { Menu } from "lucide-react"

import { HEADER_FOCUS } from "@/components/app-header"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { AdminNavLinks } from "./admin-nav"

/**
 * The admin nav's mobile/tablet path (below `lg`): a menu button in the
 * header that opens a `Sheet` holding the same links as the sidebar. Its own
 * component, separate from admin-shell.tsx, for the same reason as
 * admin-nav.tsx: no @/features/members import here.
 */
export function AdminMobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open admin menu"
            className={cn("text-white hover:bg-white/10", HEADER_FOCUS)}
          >
            <Menu aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Admin</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <AdminNavLinks onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

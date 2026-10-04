import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import {
  getCurrentMember,
  PersonaSignIn,
  safeReturnPath,
} from "@/features/members"
import { personasEnabled } from "@/lib/env.server"

export const metadata: Metadata = {
  title: "Sign in · The Pillar Portal",
}

// Prototype sign-in (AD-7): persona buttons while PROTOTYPE_PERSONAS is on.
// Story 2.1 adds Sign in with Google.
//
// `next` is where the visitor was going; src/proxy.ts sets it when it sends a
// signed-out visitor here. An active member is sent straight there. Pending
// and rowless callers see the page as anyone signed out does.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams
  const returnPath = safeReturnPath(next)

  const member = await getCurrentMember()
  if (member && member.role !== "pending") redirect(returnPath)

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-160 px-page-margin-mobile py-12 md:px-page-margin-desktop">
        <div className="rounded-lg border border-card-edge bg-card p-card-padding shadow-card">
          <h1 className="font-heading text-display text-navy">Sign in</h1>
          {personasEnabled ? (
            <>
              <p className="mt-2 mb-4 text-muted-foreground">
                Prototype: choose who to sign in as.
              </p>
              <PersonaSignIn next={returnPath} />
            </>
          ) : (
            <p className="mt-2 text-muted-foreground">
              Sign-in isn&apos;t available yet.
            </p>
          )}
        </div>
      </main>
    </>
  )
}

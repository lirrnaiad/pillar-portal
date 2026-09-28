import type { Metadata } from "next"

import { AppHeader } from "@/components/app-header"
import { PersonaSignIn } from "@/features/members"
import { personasEnabled } from "@/lib/env.server"

export const metadata: Metadata = {
  title: "Sign in · The Pillar Portal",
}

// Prototype sign-in (AD-7): persona buttons while PROTOTYPE_PERSONAS is on.
// Google and Discord replace them in Story 2.1.
export default function LoginPage() {
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
              <PersonaSignIn />
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

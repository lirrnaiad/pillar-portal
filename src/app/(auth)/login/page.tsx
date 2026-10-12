import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import {
  AccountStateNotice,
  detectInAppBrowser,
  getCurrentMember,
  GoogleSignIn,
  InAppBrowserNotice,
  LOGIN_ERROR_SIGN_IN,
  loginPath,
  memberErrorMessage,
  PersonaSignIn,
  safeReturnPath,
} from "@/features/members"
import { clientEnv } from "@/lib/env.client"
import { personasEnabled } from "@/lib/env.server"

export const metadata: Metadata = {
  title: "Sign in · The Pillar Portal",
}

// Sign-in and account states (UX-DR52, AD-7).
//
// `next` is where the visitor was going; src/proxy.ts sets it when it sends a
// signed-out visitor here, and every use goes through safeReturnPath. The
// caller's own members row decides what renders:
// - an active member goes straight to `next` (or /dashboard), so there's no
//   redirect loop with the member and admin pages' state check;
// - a pending, declined or deactivated member sees their state and Sign out;
// - anyone else gets Sign in with Google, or, inside Messenger's or
//   Facebook's in-app browser (from the user agent), the hand-off to the
//   phone's browser, since Google refuses sign-in there. `error=sign-in`
//   (from a sign-in that didn't finish) adds the "didn't finish" line.
// Persona buttons render below whenever PROTOTYPE_PERSONAS is on.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams
  const returnPath = safeReturnPath(next)

  const member = await getCurrentMember()
  if (member?.state === "active") redirect(returnPath)

  let content: React.ReactNode
  if (member) {
    content = <AccountStateNotice state={member.state} />
  } else {
    const inApp = detectInAppBrowser((await headers()).get("user-agent"))
    content = (
      <>
        <h1 className="font-heading text-display text-navy">Sign in</h1>
        {inApp ? (
          <InAppBrowserNotice
            browser={inApp}
            loginUrl={
              new URL(
                loginPath({ next: returnPath }),
                clientEnv.NEXT_PUBLIC_SITE_URL
              ).href
            }
          />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {error === LOGIN_ERROR_SIGN_IN && (
              <p role="alert" className="text-sm text-status-attention-text">
                {memberErrorMessage("auth.sign_in_failed")}
              </p>
            )}
            <GoogleSignIn next={returnPath} />
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-160 px-page-margin-mobile py-12 md:px-page-margin-desktop">
        <div className="rounded-lg border border-card-edge bg-card p-card-padding shadow-card">
          {content}
          {personasEnabled && (
            <div className="mt-8 border-t border-card-edge pt-6">
              <p className="mb-4 text-muted-foreground">
                Prototype: choose who to sign in as.
              </p>
              <PersonaSignIn next={returnPath} />
            </div>
          )}
        </div>
      </main>
    </>
  )
}

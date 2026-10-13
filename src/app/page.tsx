import { redirect } from "next/navigation"

import { loginPath } from "@/features/members"

// The placeholder home, which is also where Supabase Auth falls back to (the
// Site URL) when it can't use the sign-in's own redirect: an expired or
// invalid OAuth state, or a refused `redirect_to`. It then sends `?code=…`
// (a finished sign-in) or `?error=…`, so:
// - a `code` goes on to /auth/callback, which exchanges it (with `next`
//   lost, the member lands on /dashboard);
// - any `error` goes to /login with "Sign-in didn't finish";
// - anything else renders the placeholder.
export default async function Page({ searchParams }: PageProps<"/">) {
  const { code, error } = await searchParams

  if (typeof code === "string") {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`)
  }
  if (error !== undefined) {
    redirect(loginPath({ next: "/dashboard", error: true }))
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-160 flex-col justify-center gap-4 px-page-margin-mobile py-12 md:px-page-margin-desktop">
      <div className="rounded-lg border border-card-edge bg-card p-card-padding shadow-card">
        <h1 className="font-heading text-display text-navy">
          The Pillar Portal
        </h1>
        <p className="mt-2 text-muted-foreground">
          The portal is being built. Check back soon.
        </p>
      </div>
    </main>
  )
}

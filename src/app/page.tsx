import { redirect } from "next/navigation"

import { loginPath } from "@/features/members"

// `/` is where Supabase Auth falls back to (the Site URL) when it can't use
// the sign-in's own redirect: an expired or invalid OAuth state, or a refused
// `redirect_to`. It then sends `?code=…` (a finished sign-in) or `?error=…`,
// so:
// - a `code` goes on to /auth/callback, which exchanges it (with `next`
//   lost, the member lands on /dashboard);
// - any `error` goes to /login with "Sign-in didn't finish";
// - anything else goes to /dashboard. The portal has no home page of its own
//   (the placeholder that said it was being built went once it was in use),
//   so `/` opens the portal: the proxy sends a signed-out visitor on to
//   /login, and requireActiveMember() sends a pending, declined or
//   deactivated one to /login's account state.
export default async function Page({ searchParams }: PageProps<"/">) {
  const { code, error } = await searchParams

  if (typeof code === "string") {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`)
  }
  if (error !== undefined) {
    redirect(loginPath({ next: "/dashboard", error: true }))
  }

  redirect("/dashboard")
}

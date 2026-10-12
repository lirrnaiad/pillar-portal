// Messenger's and Facebook's in-app browsers (NFR8). Google refuses sign-in
// inside them, and that is where most portal links get opened, so /login
// shows a hand-off to the phone's own browser there instead of the Google
// button. Pure, no imports: detection, the hand-off URLs and the copy live
// here so they can be tested, and the real-iPhone check edits only the
// constants below.

export type InAppApp = "messenger" | "facebook"
export type InAppPlatform = "ios" | "android" | "other"
export type InAppBrowser = { app: InAppApp; platform: InAppPlatform }

// Messenger: `FBAN/Messenger…` on iOS (MessengerForiOS, MessengerLiteForiOS),
// `FB_IAB/MESSENGER` or `FB_IAB/Orca-Android` on Android.
const MESSENGER = /FBAN\/Messenger|FB_IAB\/MESSENGER|Orca-Android/
// Facebook (and any other Meta app using the same browser): `FBAN/FBIOS` on
// iOS, `FB_IAB/FB4A` on Android, and `FBAV/` in both.
const FACEBOOK = /FBAN\/|FBAV\/|FB_IAB\//
const IOS = /iPhone|iPad|iPod/
const ANDROID = /Android/

/** The in-app browser a user agent belongs to, or null for any other. */
export function detectInAppBrowser(
  userAgent: string | null | undefined
): InAppBrowser | null {
  if (!userAgent) return null

  const app: InAppApp | null = MESSENGER.test(userAgent)
    ? "messenger"
    : FACEBOOK.test(userAgent)
      ? "facebook"
      : null
  if (app === null) return null

  const platform: InAppPlatform = IOS.test(userAgent)
    ? "ios"
    : ANDROID.test(userAgent)
      ? "android"
      : "other"
  return { app, platform }
}

/**
 * The link that opens `loginUrl` in the phone's own browser: an Android
 * intent for the default browser (with the URL's own scheme), or iOS's
 * `x-safari-https://` / `x-safari-http://` hand-off, which Apple doesn't
 * document (kept only while IOS_SAFARI_HANDOFF says the iPhone check passed).
 * Null on any other platform.
 */
export function handoffUrl(
  loginUrl: string,
  platform: InAppPlatform
): string | null {
  const url = new URL(loginUrl)
  const scheme = url.protocol.slice(0, -1)
  switch (platform) {
    case "android":
      return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`
    case "ios":
      return `x-safari-${url.href}`
    case "other":
      return null
  }
}

// What the real-iPhone check decides (Story 2.1's manual check), recorded in
// the story's spec:
// - whether Open in your browser hands off to Safari from both apps;
// - each app's own menu steps, in the exact words it shows (first draft);
// - the setting, if any, that opens links in Safari (null: none known).
export const IOS_SAFARI_HANDOFF = true

export const IOS_MENU_STEPS: Record<InAppApp, readonly string[]> = {
  messenger: ["Tap ⋯ at the top right.", "Tap Open in Safari."],
  facebook: ["Tap ⋯ at the top right.", "Tap Open in Safari."],
}

export const IOS_SKIP_SETTING: Record<InAppApp, string | null> = {
  messenger: null,
  facebook: null,
}

// EXPERIENCE.md's in-app browser copy (first draft where the story says so).
export const IN_APP_COPY = {
  lead: "To sign in with Google, open this page in your browser.",
  open: "Open in your browser",
  menuHint: "Or open the ⋯ menu and choose to open this page in your browser.",
  copyLink: "Copy link",
  copied: "Link copied — open Safari and paste it.",
  linkToCopy: "Link to copy",
  skipNextTime: (setting: string) => `Skip this next time: ${setting}.`,
} as const

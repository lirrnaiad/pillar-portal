import { Button } from "@/components/ui/button"

import {
  handoffUrl,
  IN_APP_COPY,
  IOS_MENU_STEPS,
  IOS_SAFARI_HANDOFF,
  IOS_SKIP_SETTING,
  type InAppBrowser,
} from "../in-app-browser"
import { CopyLinkButton } from "./copy-link-button"

/**
 * /login inside Messenger's or Facebook's in-app browser (UX-DR52, NFR8),
 * where Google refuses to sign anyone in, so there is no Google button.
 * `loginUrl` is this page's absolute URL with `next`, built from
 * NEXT_PUBLIC_SITE_URL, so the phone's browser opens on the same page.
 *
 * - Android: Open in your browser (an intent for the default browser), then
 *   the ⋯ menu line.
 * - iOS: Open in your browser (the Safari hand-off) while IOS_SAFARI_HANDOFF,
 *   the app's own menu steps, Copy link, and the setting that skips this page
 *   when one is known.
 * - Anything else: the ⋯ menu line and Copy link.
 */
export function InAppBrowserNotice({
  browser,
  loginUrl,
}: {
  browser: InAppBrowser
  loginUrl: string
}) {
  const { app, platform } = browser
  const openHref =
    platform === "ios" && !IOS_SAFARI_HANDOFF
      ? null
      : handoffUrl(loginUrl, platform)
  const skipSetting = platform === "ios" ? IOS_SKIP_SETTING[app] : null

  return (
    <div className="mt-2 flex flex-col gap-4">
      <p>{IN_APP_COPY.lead}</p>
      {openHref !== null && (
        <Button asChild className="min-h-11 w-full text-base">
          <a href={openHref}>{IN_APP_COPY.open}</a>
        </Button>
      )}
      {platform === "ios" ? (
        <ol className="list-decimal space-y-1 pl-6">
          {IOS_MENU_STEPS[app].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground">{IN_APP_COPY.menuHint}</p>
      )}
      {platform !== "android" && <CopyLinkButton url={loginUrl} />}
      {skipSetting !== null && <p>{IN_APP_COPY.skipNextTime(skipSetting)}</p>}
    </div>
  )
}

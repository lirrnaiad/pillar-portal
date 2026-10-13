import { describe, expect, it } from "vitest"

import {
  detectInAppBrowser,
  handoffUrl,
  IN_APP_COPY,
  IOS_MENU_STEPS,
  IOS_SAFARI_HANDOFF,
  IOS_SKIP_SETTING,
} from "./in-app-browser"

// Real user agents, as these apps and browsers send them.
const UA = {
  messengerIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerLiteForiOS;FBAV/466.0.0.36.106;FBBV/617331536;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/0]",
  messengerIosOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/420.0.0.24.115;FBBV/518335164;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]",
  messengerAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/468.1.0.55.109;]",
  messengerAndroidUpper:
    "Mozilla/5.0 (Linux; Android 14; 23021RAA2Y Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/471.0.0.40.109;]",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/476.0.0.41.109;FBBV/645287462;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/648091398]",
  facebookIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/627145463;FBDV/iPad13,18;FBMD/iPad;FBSN/iPadOS;FBSV/17.5;FBSS/2;FBID/tablet;FBLC/en_US;FBOP/5;FBRV/0]",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/479.0.0.51.64;]",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  samsungInternet:
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  safariDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  firefoxDesktop:
    "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
}

describe("detectInAppBrowser", () => {
  it.each([
    ["Messenger on iOS", UA.messengerIos, "messenger", "ios"],
    ["Messenger (older) on iOS", UA.messengerIosOld, "messenger", "ios"],
    ["Messenger on Android", UA.messengerAndroid, "messenger", "android"],
    [
      "Messenger on Android (FB_IAB/MESSENGER)",
      UA.messengerAndroidUpper,
      "messenger",
      "android",
    ],
    ["Facebook on iOS", UA.facebookIos, "facebook", "ios"],
    ["Facebook on an iPad", UA.facebookIpad, "facebook", "ios"],
    ["Facebook on Android", UA.facebookAndroid, "facebook", "android"],
  ] as const)("detects %s", (_label, userAgent, app, platform) => {
    expect(detectInAppBrowser(userAgent)).toEqual({ app, platform })
  })

  it("names an unknown platform `other`", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (X11; Linux x86_64) [FBAN/FBIOS;FBAV/476.0.0.41.109]"
      )
    ).toEqual({ app: "facebook", platform: "other" })
  })

  it.each([
    ["iOS Safari", UA.safariIos],
    ["Chrome on iOS", UA.chromeIos],
    ["Android Chrome", UA.chromeAndroid],
    ["Samsung Internet", UA.samsungInternet],
    ["desktop Chrome", UA.chromeDesktop],
    ["desktop Safari", UA.safariDesktop],
    ["desktop Firefox", UA.firefoxDesktop],
    ["an empty user agent", ""],
    ["no user agent", null],
  ])("doesn't match %s", (_label, userAgent) => {
    expect(detectInAppBrowser(userAgent)).toBeNull()
  })
})

describe("handoffUrl", () => {
  const HTTPS = "https://pillar.example/login?next=%2Fdashboard%2Ftasks%2Fabc"
  const HTTP = "http://localhost:3000/login?next=%2Fdashboard"

  it("opens the default browser on Android through an intent, keeping the scheme", () => {
    expect(handoffUrl(HTTPS, "android")).toBe(
      "intent://pillar.example/login?next=%2Fdashboard%2Ftasks%2Fabc#Intent;scheme=https;action=android.intent.action.VIEW;end"
    )
    expect(handoffUrl(HTTP, "android")).toBe(
      "intent://localhost:3000/login?next=%2Fdashboard#Intent;scheme=http;action=android.intent.action.VIEW;end"
    )
  })

  it("opens Safari on iOS through x-safari-https:// or x-safari-http://", () => {
    expect(handoffUrl(HTTPS, "ios")).toBe(`x-safari-${HTTPS}`)
    expect(handoffUrl(HTTPS, "ios")).toMatch(/^x-safari-https:\/\//)
    expect(handoffUrl(HTTP, "ios")).toBe(
      "x-safari-http://localhost:3000/login?next=%2Fdashboard"
    )
  })

  it("has no hand-off elsewhere", () => {
    expect(handoffUrl(HTTPS, "other")).toBeNull()
  })
})

describe("the iPhone check's constants", () => {
  it("start from the story's first drafts", () => {
    expect(IOS_SAFARI_HANDOFF).toBe(true)
    expect(IOS_MENU_STEPS).toEqual({
      messenger: ["Tap ⋯ at the top right.", "Tap Open in Safari."],
      facebook: ["Tap ⋯ at the top right.", "Tap Open in Safari."],
    })
    expect(IOS_SKIP_SETTING).toEqual({ messenger: null, facebook: null })
  })

  it("use EXPERIENCE.md's copy", () => {
    expect(IN_APP_COPY.lead).toBe(
      "To sign in with Google, open this page in your browser."
    )
    expect(IN_APP_COPY.open).toBe("Open in your browser")
    expect(IN_APP_COPY.menuHint).toBe(
      "Or open the ⋯ menu and choose to open this page in your browser."
    )
    expect(IN_APP_COPY.copied).toBe("Link copied — open Safari and paste it.")
    expect(IN_APP_COPY.skipNextTime("Settings > Links")).toBe(
      "Skip this next time: Settings > Links."
    )
  })
})

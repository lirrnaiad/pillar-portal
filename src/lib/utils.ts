import { createCn } from "cn/config"

// `cn` merges Tailwind classes and resolves conflicts. The stock `cn` doesn't
// know the DESIGN.md token names in src/app/globals.css, so it would read
// `text-display` as a color and drop it next to `text-navy`, and it wouldn't
// let `shadow-sm` or `p-2` override `shadow-card` or `p-card-padding`.
// Registering the tokens in their theme scales fixes that. Add a token here
// when you add a named font size, shadow or spacing value to globals.css.
// Components import `cn` from here only (lint bans importing "cn" elsewhere).
export const cn = createCn({
  extend: {
    theme: {
      text: ["wordmark", "display", "heading", "heading-sm", "status-badge"],
      shadow: ["card"],
      spacing: [
        "card-padding",
        "column-gap",
        "page-margin-mobile",
        "page-margin-desktop",
      ],
    },
  },
})

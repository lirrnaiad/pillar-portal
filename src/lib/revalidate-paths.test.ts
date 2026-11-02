import { existsSync } from "node:fs"

import { NEXT_CACHE_IMPLICIT_TAG_ID } from "next/dist/lib/constants"
import { getImplicitTags } from "next/dist/server/lib/implicit-tags"
import { describe, expect, it } from "vitest"

import { ADMIN_AREA, MEMBER_AREA } from "./revalidate-paths"

// Each area, a real page beneath it (its route file path, as Next passes it
// to getImplicitTags) and one URL of that page.
const AREAS = [
  {
    name: "MEMBER_AREA",
    area: MEMBER_AREA,
    url: "/dashboard",
    page: "/(member)/dashboard/tasks/[id]/page",
    pathname: "/dashboard/tasks/00000000-0000-4000-8000-000000000001",
  },
  {
    name: "ADMIN_AREA",
    area: ADMIN_AREA,
    url: "/admin",
    page: "/(admin)/admin/tasks/page",
    pathname: "/admin/tasks",
  },
]

// The tag `revalidatePath(path, "layout")` expires (Next's revalidate.js).
const layoutTag = (path: string) =>
  `${NEXT_CACHE_IMPLICIT_TAG_ID}${path}/layout`

describe.each(AREAS)("$name", ({ area, url, page, pathname }) => {
  it("is a folder under src/app, holding the page", () => {
    expect(existsSync(new URL(`../app${area}`, import.meta.url))).toBe(true)
    expect(existsSync(new URL(`../app${page}.tsx`, import.meta.url))).toBe(true)
  })

  it(`is the layout tag Next derives for ${page}`, async () => {
    const { tags } = await getImplicitTags(page, pathname, null)

    expect(tags).toContain(layoutTag(area))
    // The URL form would match nothing.
    expect(tags).not.toContain(layoutTag(url))
  })
})

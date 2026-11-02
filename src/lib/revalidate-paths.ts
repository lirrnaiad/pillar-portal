// The paths the slices' actions pass to `revalidatePath(..., "layout")`.
// No imports: client-safe.
//
// Each is a route file path, route group included, not a URL. Next tags a
// render with tags it derives from the page's file path, groups included
// (`getDerivedTags` in node_modules/next/dist/server/lib/implicit-tags.js):
// Task detail, `/(member)/dashboard/tasks/[id]/page`, gets
// `/(member)/dashboard/layout`, and never `/dashboard/layout`. Next's
// revalidatePath.md gives the route-group form,
// `revalidatePath('/(main)/post/[slug]', 'layout')`. So
// `revalidatePath(MEMBER_AREA, "layout")` refreshes every member page and
// `revalidatePath(ADMIN_AREA, "layout")` every admin page, where the URLs
// `/dashboard` and `/admin` would match no layout tag. A plain URL, such as
// `revalidatePath("/admin/tasks")`, matches only that page's own URL tag.
// revalidate-paths.test.ts fails if a group is renamed or Next changes how
// it derives these tags.

/** Every member page: src/app/(member)/dashboard and beneath it. */
export const MEMBER_AREA = "/(member)/dashboard"

/** Every admin page: src/app/(admin)/admin and beneath it. */
export const ADMIN_AREA = "/(admin)/admin"

import { describe, expect, it } from "vitest"

import {
  MAX_ADMIN_BANNERS,
  visibleAdminBanners,
  type AdminBanner,
} from "./admin-banners"

function banner(
  id: string,
  family: AdminBanner["family"],
  since: string
): AdminBanner {
  return { id, family, text: `Banner ${id}`, since }
}

const ids = (banners: AdminBanner[]) => banners.map((b) => b.id)

describe("visibleAdminBanners", () => {
  it("shows at most three", () => {
    expect(MAX_ADMIN_BANNERS).toBe(3)
  })

  it("returns [] for no banners", () => {
    expect(visibleAdminBanners([])).toEqual([])
  })

  it("puts attention before progress, even when the progress one is older", () => {
    const banners = [
      banner("reset", "progress", "2026-10-01T00:00:00.000Z"),
      banner("backup", "attention", "2026-10-15T00:00:00.000Z"),
    ]
    expect(ids(visibleAdminBanners(banners))).toEqual(["backup", "reset"])
  })

  it("orders each family oldest `since` first", () => {
    const banners = [
      banner("p-new", "progress", "2026-10-12T00:00:00.000Z"),
      banner("a-new", "attention", "2026-10-11T00:00:00.000Z"),
      banner("p-old", "progress", "2026-10-02T00:00:00.000Z"),
      banner("a-old", "attention", "2026-10-01T00:00:00.000Z"),
    ]
    expect(ids(visibleAdminBanners(banners))).toEqual([
      "a-old",
      "a-new",
      "p-old",
    ])
  })

  it("compares `since` as instants, not as strings", () => {
    // 08:00 at +08:00 is midnight UTC, earlier than 01:00Z.
    const banners = [
      banner("utc", "attention", "2026-10-01T01:00:00Z"),
      banner("manila", "attention", "2026-10-01T08:00:00+08:00"),
    ]
    expect(ids(visibleAdminBanners(banners))).toEqual(["manila", "utc"])
  })

  it("sorts an unparseable `since` as the newest in its family, then by id", () => {
    const banners = [
      banner("bad-b", "attention", "not a date"),
      banner("new", "attention", "2026-10-15T00:00:00.000Z"),
      banner("bad-a", "attention", ""),
      banner("old", "attention", "2026-10-01T00:00:00.000Z"),
    ]

    // The same answer whatever order they arrive in: a consistent comparator.
    expect(ids(visibleAdminBanners(banners))).toEqual(["old", "new", "bad-a"])
    expect(ids(visibleAdminBanners([...banners].reverse()))).toEqual([
      "old",
      "new",
      "bad-a",
    ])
    expect(
      ids(visibleAdminBanners([banners[0], banners[2], banners[1]]))
    ).toEqual(["new", "bad-a", "bad-b"])
  })

  it("still puts an attention banner with an unparseable `since` before progress", () => {
    const banners = [
      banner("progress", "progress", "2026-10-01T00:00:00.000Z"),
      banner("bad", "attention", "not a date"),
    ]
    expect(ids(visibleAdminBanners(banners))).toEqual(["bad", "progress"])
  })

  it("breaks a tie on family and `since` by id", () => {
    const since = "2026-10-01T00:00:00.000Z"
    const banners = [
      banner("c", "attention", since),
      banner("a", "attention", since),
      banner("b", "attention", since),
    ]
    expect(ids(visibleAdminBanners(banners))).toEqual(["a", "b", "c"])
  })

  it("caps four at the first three after sorting, leaving the input as it was", () => {
    const banners = [
      banner("p1", "progress", "2026-10-01T00:00:00.000Z"),
      banner("a2", "attention", "2026-10-03T00:00:00.000Z"),
      banner("p2", "progress", "2026-10-02T00:00:00.000Z"),
      banner("a1", "attention", "2026-10-04T00:00:00.000Z"),
    ]
    const before = ids(banners)

    expect(ids(visibleAdminBanners(banners))).toEqual(["a2", "a1", "p1"])
    expect(ids(banners)).toEqual(before)
  })
})

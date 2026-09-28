import { readFileSync } from "node:fs"
import { parseEnv } from "node:util"

import { describe, expect, it } from "vitest"

import { Constants } from "@/lib/supabase/database.types"

import { PERSONAS } from "./personas"
import { PRODUCTION_ROLE_LABELS } from "./production-roles"

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8")

const seedSql = read("../../../supabase/seed.sql")

describe("PRODUCTION_ROLE_LABELS", () => {
  it("labels exactly the values of the production_role enum", () => {
    expect(Object.keys(PRODUCTION_ROLE_LABELS).sort()).toEqual(
      [...Constants.public.Enums.production_role].sort()
    )
  })
})

describe("personas", () => {
  it.each(Object.entries(PERSONAS))(
    "seed.sql creates %s with the same email and name",
    (key, persona) => {
      expect(persona.email).toBe(`persona-${key}@example.com`)
      expect(seedSql).toContain(
        `('${persona.email}', '${persona.name}', true, array['${key}'])`
      )
    }
  )

  it("seed.sql creates no other persona", () => {
    const seeded = [...seedSql.matchAll(/'persona-([a-z_]+)@example\.com'/g)]
    expect(seeded.map((match) => match[1]).sort()).toEqual(
      Object.keys(PERSONAS).sort()
    )
  })

  it("seed.sql gives the personas .env.example's password", () => {
    const example = parseEnv(read("../../../.env.example"))
    const password = example.PROTOTYPE_PERSONA_PASSWORD
    expect(password).toBeTruthy()
    expect(seedSql).toContain(`extensions.crypt('${password}'`)
  })
})

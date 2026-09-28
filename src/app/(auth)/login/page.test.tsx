// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

// The persona buttons have their own tests; here only whether they render.
vi.mock("@/features/members", () => ({
  PersonaSignIn: () => <div data-testid="persona-sign-in" />,
}))

// env.server reads the environment when it loads, so each test stubs it and
// imports the page afresh.
async function renderLoginPage({ personas }: { personas: string | undefined }) {
  vi.stubEnv("PROTOTYPE_PERSONAS", personas)
  vi.stubEnv("PROTOTYPE_PERSONA_PASSWORD", "a-persona-password-for-tests")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
  vi.resetModules()
  const { default: LoginPage } = await import("./page")
  return render(<LoginPage />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe("LoginPage", () => {
  it("offers the persona buttons while personas are on", async () => {
    const { container } = await renderLoginPage({ personas: "true" })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Sign in"
    )
    expect(
      screen.getByText("Prototype: choose who to sign in as.")
    ).toBeInTheDocument()
    expect(screen.getByTestId("persona-sign-in")).toBeInTheDocument()
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })

  it.each([undefined, "false"])(
    "renders no persona buttons when PROTOTYPE_PERSONAS is %j",
    async (personas) => {
      const { container } = await renderLoginPage({ personas })

      expect(screen.queryByTestId("persona-sign-in")).not.toBeInTheDocument()
      expect(
        screen.getByText("Sign-in isn't available yet.")
      ).toBeInTheDocument()
      const results = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
      expect(results.violations).toEqual([])
    }
  )
})

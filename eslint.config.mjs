import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

// AD-2 slices. `members`, `files` and `email` import no other slice.
// `tasks`, `reports` and `recruitment` may import only `members`, `files` and
// `email`.
const leafSlices = ["members", "files", "email"]
const composedSlices = ["tasks", "reports", "recruitment"]
const slices = [...leafSlices, ...composedSlices]

const sliceDir = (slice) => `./src/features/${slice}`

const ENV_MODULES = ["src/lib/env.server.ts", "src/lib/env.client.ts"]
const CN_WRAPPER = "src/lib/utils.ts"
const ENV_MESSAGE =
  "Read environment variables through src/lib/env.server.ts or src/lib/env.client.ts (AD-6)."

// Every file under src/ that is not inside src/app.
const outsideApp = ["./src/!(app)/**/*", "./src/*"]

const sliceZones = [
  // Nothing outside src/app imports src/app.
  {
    target: outsideApp,
    from: "./src/app",
    message: "Only src/app may import src/app (AD-2).",
  },
  // Code outside a slice imports it only through its index.ts.
  ...slices.map((slice) => ({
    target: [
      "./src/!(features)/**/*",
      "./src/*",
      `./src/features/!(${slice})/**/*`,
    ],
    from: sliceDir(slice),
    except: ["./index.ts"],
    message: `Import the ${slice} slice through its index.ts only (AD-2).`,
  })),
  // Leaf slices import no other slice.
  ...leafSlices.map((slice) => ({
    target: sliceDir(slice),
    from: slices.filter((other) => other !== slice).map(sliceDir),
    message: `The ${slice} slice imports no other slice (AD-2).`,
  })),
  // Composed slices import only the leaf slices.
  ...composedSlices.map((slice) => ({
    target: sliceDir(slice),
    from: composedSlices.filter((other) => other !== slice).map(sliceDir),
    message: `The ${slice} slice may import only ${leafSlices.join(", ")} (AD-2).`,
  })),
]

// A folder under src/features/ that isn't a known slice would escape every
// zone above, so refuse to load the config instead.
function assertKnownSlices(rootDir) {
  const featuresDir = path.join(rootDir, "src", "features")
  if (!existsSync(featuresDir)) return
  for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !slices.includes(entry.name)) {
      throw new Error(
        `eslint.config.mjs: src/features/${entry.name} is not an AD-2 slice ` +
          `(${slices.join(", ")}). Add it to the slice lists or move it.`
      )
    }
  }
}

// `no-restricted-imports` options are replaced, not merged, when two config
// blocks match one file, so each block states its full list.
function restrictedImports({ cn, process }) {
  const paths = []
  const patterns = []
  if (cn) {
    const message = `Import cn from @/lib/utils, which knows the DESIGN.md tokens.`
    paths.push({ name: "cn", message })
    patterns.push({ group: ["cn/*"], message })
  }
  if (process) {
    for (const name of ["process", "node:process"]) {
      paths.push({ name, message: ENV_MESSAGE })
    }
  }
  return ["error", { paths, patterns }]
}

/**
 * Builds the config for the project at `rootDir`. The zones, the tsconfig
 * that resolves `@/` and the slice check all hang off it, so tests can lint
 * fixture projects in a temp dir.
 */
export function createConfig(rootDir) {
  assertKnownSlices(rootDir)

  return defineConfig([
    ...nextVitals,
    ...nextTs,
    {
      name: "pillar/architecture",
      files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      settings: {
        "import/resolver": {
          node: { extensions: [".js", ".jsx", ".ts", ".tsx"] },
          typescript: {
            alwaysTryTypes: true,
            project: path.join(rootDir, "tsconfig.json"),
          },
        },
      },
      rules: {
        "import/no-cycle": ["error", { ignoreExternal: true }],
        "import/no-restricted-paths": [
          "error",
          { basePath: rootDir, zones: sliceZones },
        ],
      },
    },
    {
      // Only src/lib/utils.ts builds cn from the "cn" package.
      name: "pillar/cn-wrapper",
      files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      ignores: [CN_WRAPPER],
      rules: {
        "no-restricted-imports": restrictedImports({
          cn: true,
          process: false,
        }),
      },
    },
    {
      // AD-6: only the two env modules touch process (and so process.env).
      name: "pillar/env-access",
      files: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
      ignores: ENV_MODULES,
      rules: {
        "no-restricted-globals": [
          "error",
          { name: "process", message: ENV_MESSAGE },
        ],
        "no-restricted-properties": [
          "error",
          { object: "process", property: "env", message: ENV_MESSAGE },
        ],
        "no-restricted-syntax": [
          "error",
          {
            selector:
              "MemberExpression[object.type='MemberExpression'][object.property.name='process'][property.name='env']",
            message: ENV_MESSAGE,
          },
        ],
        "no-restricted-imports": restrictedImports({
          cn: true,
          process: true,
        }),
      },
    },
    {
      name: "pillar/cn-wrapper-env",
      files: [CN_WRAPPER],
      rules: {
        "no-restricted-imports": restrictedImports({
          cn: false,
          process: true,
        }),
      },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
      // Default ignores of eslint-config-next:
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Local planning material and tooling, never published:
      "_bmad/**",
      "_bmad-output/**",
      ".claude/**",
      "docs/**",
    ]),
  ])
}

export default createConfig(import.meta.dirname)

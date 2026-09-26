import type { NextConfig } from "next"

// Validates NEXT_PUBLIC_* at config load, so `next build`, `next dev` and
// `next start` stop with the variable named when it is missing or malformed.
import "./src/lib/env.client"

const nextConfig: NextConfig = {}

export default nextConfig

// Liveness probe. Reads nothing, writes nothing (AD-3: GET handlers never
// write). Epic 2 adds the database ping.
export function GET() {
  return Response.json({ status: "ok", timestamp: new Date().toISOString() })
}

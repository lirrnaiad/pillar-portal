/**
 * Writes to the clipboard; false when there is no access or it is refused
 * (some in-app browsers have none), so the caller can show the text to copy
 * by hand instead.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

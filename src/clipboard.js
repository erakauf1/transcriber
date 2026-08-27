// iOS Safari only allows clipboard writes inside a user gesture —
// callers must invoke this directly from a tap handler.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

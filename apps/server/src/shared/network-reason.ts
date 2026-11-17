/**
 * Why a request didn't get an answer. `fetch` says only "fetch failed"; the reason
 * (DNS, refused, blocked, timed out) is in its `cause` chain.
 */
export const networkReason = (error: unknown): string => {
  const parts: Array<string> = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const text = current.name === "TimeoutError" ? "timed out" : current.message;
      parts.push(typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(": ");
};

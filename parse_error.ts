export function getFriendlyErrorMessage(err: any, defaultMsg: string): string {
  let msg = err?.message || defaultMsg;
  try {
    const parsed = JSON.parse(msg);
    if (parsed?.error?.message) {
      msg = parsed.error.message;
    }
  } catch {}
  
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
    return "AI Rate limit reached. Please wait a minute and try again.";
  }
  if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("high demand")) {
    return "The AI model is experiencing high demand. Please try again in a few moments.";
  }
  return msg;
}

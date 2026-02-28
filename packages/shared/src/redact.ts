function replaceAll(text: string, pattern: RegExp, replacement: string): string {
  return text.replace(pattern, replacement);
}

export function redactMessageText(input: string): string {
  let text = String(input ?? "");

  // Emails
  text = replaceAll(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");

  // Phone numbers (very rough): sequences that look like US numbers.
  text = replaceAll(text, /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[REDACTED_PHONE]");

  // CashApp / cashtags
  text = replaceAll(text, /\$[A-Za-z0-9_]{2,32}\b/g, "[REDACTED_CASHTAG]");

  // @handles (X/IG/etc)
  text = replaceAll(text, /(^|[\s(])@[A-Za-z0-9_]{1,30}\b/g, "$1@user");

  // Common crypto address patterns (best-effort)
  text = replaceAll(text, /\b0x[a-fA-F0-9]{40}\b/g, "[REDACTED_WALLET]");
  text = replaceAll(text, /\b(bc1[0-9a-z]{25,62})\b/gi, "[REDACTED_WALLET]");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}


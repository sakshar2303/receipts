// Credential shapes. Each has a label so redacted output still says what was there.
const KNOWN: [RegExp, string][] = [
  // The whole block when it is in one string; the header alone when it is one diff line.
  [
    /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----)?/g,
    "private key",
  ],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "AWS key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, "GitHub token"],
  [/\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}\b/g, "API key"],
  [/\bgsk_[A-Za-z0-9]{20,}\b/g, "API key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "Google API key"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, "Stripe key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "JWT"],
];

// A long, random-looking value assigned to a name that says it is secret.
const ASSIGNED =
  /\b([A-Za-z_]*(?:key|token|secret|passw(?:or)?d|pwd|credential)[A-Za-z_]*)\b(["']?\s*[:=]\s*["']?)([A-Za-z0-9+/_\-.=]{20,})/gi;

export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const looksRandom = (value: string) =>
  entropy(value) >= 3.5 && /\d/.test(value) && /[A-Za-z]/.test(value);

export interface SecretHit {
  label: string;
  value: string;
}

/** Credential-looking values in a piece of text. */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const [re, label] of KNOWN) {
    for (const m of text.matchAll(re)) hits.push({ label, value: m[0] });
  }
  for (const m of text.matchAll(ASSIGNED)) {
    const value = m[3] ?? "";
    if (
      looksRandom(value) &&
      !hits.some((h) => h.value.includes(value) || value.includes(h.value))
    ) {
      hits.push({ label: "secret", value });
    }
  }
  return hits;
}

/**
 * Replaces every credential-looking value with a label. Every string Receipts
 * prints from a transcript or a diff goes through this.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const hit of findSecrets(text)) {
    out = out.split(hit.value).join(`[redacted ${hit.label}]`);
  }
  return out;
}

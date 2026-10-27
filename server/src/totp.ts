/**
 * Two-step sign-in: authenticator app codes (TOTP, RFC 6238: 30 s, 6 digits, HMAC-SHA1)
 * and one-time recovery codes. Works on Node and on Cloudflare Workers alike (Web Crypto).
 */
const enc = new TextEncoder();
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The 6-digit code for a given 30 s step. */
export async function totpAt(secret: Uint8Array, step: number): Promise<string> {
  const msg = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) {
    msg[i] = n & 255;
    n = Math.floor(n / 256);
  }
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

const sameText = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/**
 * Checks a code: the previous, current and next step are accepted (for clock drift).
 * A step already used (lastStep) is not accepted again. Returns the matching step, or null.
 */
export async function checkTotp(secretB32: string, code: string, lastStep = 0, now = Date.now()): Promise<number | null> {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(now / 30_000);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    if (sameText(await totpAt(secret, s), digits)) return s;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

export const otpauthUri = (secret: string, account: string, issuer = 'Hyperfocus') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Recovery codes: no letters that are easy to mix up (0/o, 1/l/i).
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const r = crypto.getRandomValues(new Uint8Array(10));
    const s = [...r].map((b) => RC[b % RC.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeRecovery = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The TOTP secret is stored encrypted (the key comes from SESSION_SECRET, so a leaked database alone cannot read it). */
async function sealKey(sessionSecret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`hyperfocus-2fa:${sessionSecret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealSecret(sessionSecret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(sessionSecret), enc.encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function openSecret(sessionSecret: string, sealed: string): Promise<string | null> {
  try {
    const [iv, ct] = sealed.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, await sealKey(sessionSecret), unb64(ct!));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

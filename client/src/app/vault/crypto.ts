/**
 * Library encryption (in the browser only; no password or plain text ever goes to the server).
 *
 * - A random data key (AES-256-GCM) encrypts every note and file.
 * - That key is "wrapped" in two separate ways and stored on the server:
 *   1) with a key derived from the encryption password (PBKDF2-SHA256, 600,000 rounds),
 *   2) with a 256-bit recovery key that is shown once.
 * - Every encrypted piece is bound to its own id (AES-GCM "additional data"): the server cannot swap pieces around.
 */
const enc = new TextEncoder();
// ignoreBOM: a BOM at the start of the file is kept (so it stays byte for byte the same as the Obsidian file)
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
export const PBKDF2_ITERATIONS = 600_000;

export const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface WrappedKey {
  iv: string;
  key: string;
}
/** The key file on the server (everything in it is encrypted, or harmless in the open). */
export interface KeyFile {
  v: 1;
  kdf: { name: 'PBKDF2-SHA256'; iter: number; salt: string };
  /** The data key wrapped with the encryption password. */
  pw: WrappedKey;
  /** The data key wrapped with the recovery key. */
  rk: WrappedKey;
  created: string;
}

async function passwordKek(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}
const recoveryKek = (rk: Uint8Array) => crypto.subtle.importKey('raw', new Uint8Array(rk), 'AES-GCM', false, ['wrapKey', 'unwrapKey']);

async function wrap(dek: CryptoKey, kek: CryptoKey): Promise<WrappedKey> {
  const iv = rand(12);
  const key = new Uint8Array(await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }));
  return { iv: b64(iv), key: b64(key) };
}
const unwrap = (w: WrappedKey, kek: CryptoKey, extractable: boolean) =>
  crypto.subtle.unwrapKey('raw', unb64(w.key), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

// ---- The recovery key: 32 bytes, in readable groups (no letters that are easy to mix up) ----
const RK = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += RK[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RK[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}
export function parseRecoveryKey(text: string): Uint8Array | null {
  // Dashes and spaces are ignored; upper or lower case does not matter
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = RK.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return out.length === 32 ? new Uint8Array(out) : null;
}

/** A copy for use in memory that cannot be exported. */
async function liveCopy(dek: CryptoKey) {
  const raw = await crypto.subtle.exportKey('raw', dek);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** A new vault: the data key + two wrapped copies + the recovery key, shown once. */
export async function createKeyFile(password: string): Promise<{ file: KeyFile; dek: CryptoKey; recoveryKey: string }> {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = rand(16);
  const rk = rand(32);
  const file: KeyFile = {
    v: 1,
    kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: b64(salt) },
    pw: await wrap(dek, await passwordKek(password, salt, PBKDF2_ITERATIONS)),
    rk: await wrap(dek, await recoveryKek(rk)),
    created: new Date().toISOString(),
  };
  return { file, dek: await liveCopy(dek), recoveryKey: formatRecoveryKey(rk) };
}

/** Opens with the encryption password; null if it is wrong. `extractable`: only for wrapping again. */
export async function openWithPassword(file: KeyFile, password: string, extractable = false): Promise<CryptoKey | null> {
  try {
    return await unwrap(file.pw, await passwordKek(password, unb64(file.kdf.salt), file.kdf.iter), extractable);
  } catch {
    return null;
  }
}

export async function openWithRecovery(file: KeyFile, recoveryKey: string, extractable = false): Promise<CryptoKey | null> {
  const rk = parseRecoveryKey(recoveryKey);
  if (!rk) return null;
  try {
    return await unwrap(file.rk, await recoveryKek(rk), extractable);
  } catch {
    return null;
  }
}

/** A new encryption password (the data key stays the same; nothing is encrypted again). */
export async function rewrapWithPassword(file: KeyFile, dek: CryptoKey, password: string): Promise<KeyFile> {
  const salt = rand(16);
  return { ...file, kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITERATIONS, salt: b64(salt) }, pw: await wrap(dek, await passwordKek(password, salt, PBKDF2_ITERATIONS)) };
}

/** A new recovery key (the old one stops working). */
export async function rewrapWithNewRecovery(file: KeyFile, dek: CryptoKey): Promise<{ file: KeyFile; recoveryKey: string }> {
  const rk = rand(32);
  return { file: { ...file, rk: await wrap(dek, await recoveryKek(rk)) }, recoveryKey: formatRecoveryKey(rk) };
}

export const toLive = liveCopy;

// ---- Veri ----
export async function seal(dek: CryptoKey, data: Uint8Array, aad: string): Promise<Uint8Array> {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, dek, new Uint8Array(data)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function unseal(dek: CryptoKey, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12), additionalData: enc.encode(aad) }, dek, sealed.slice(12));
  return new Uint8Array(pt);
}

export const sealText = async (dek: CryptoKey, text: string, aad: string) => b64(await seal(dek, enc.encode(text), aad));
export const unsealText = async (dek: CryptoKey, s: string, aad: string) => dec.decode(await unseal(dek, unb64(s), aad));

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

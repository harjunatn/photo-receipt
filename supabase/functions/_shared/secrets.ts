/**
 * Seals a franchise's payment keys before they go into the database, and opens
 * them again. The master key lives only in the Edge Functions' secrets
 * (SECRETS_KEY), so a copy of the database alone does not give the keys away.
 * AES-256-GCM through WebCrypto, so the same file runs in Deno and in the tests.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyFrom(master: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(master));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * "v1.<iv>.<ciphertext>", both base64. A fresh random iv every time. `owner` (the franchise's id)
 * is bound into the seal, so a blob copied onto another franchise's row cannot be opened there.
 */
export async function seal(plain: string, master: string, owner: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(owner) }, await keyFrom(master), encoder.encode(plain));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

/** The sealed text again, or null when it was sealed with another master key, for another owner, or has been altered. */
export async function open(sealed: string, master: string, owner: string): Promise<string | null> {
  const [version, iv, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(owner) },
      await keyFrom(master),
      fromBase64(data),
    );
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

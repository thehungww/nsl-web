const encoder = new TextEncoder();
export function randomHex(bytes = 24) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
export function bytesToBase64(bytes) {
  let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function fromBase64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
async function encryptionKey(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('Máy chủ chưa có APP_SECRET. Chạy bước thiết lập Cloudflare.');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), x => parseInt(x, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(value));
  return bytesToBase64(iv) + '.' + bytesToBase64(new Uint8Array(encrypted));
}
export async function decrypt(value, secret) {
  const [iv, data] = value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await encryptionKey(secret), fromBase64(data)));
}
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}
export class UserError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function endpoint(value) {
  let url; try { url = new URL(String(value).trim()); } catch { throw new UserError('Endpoint không hợp lệ.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.a.run.app') || url.hostname.length <= 10 || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new UserError('Endpoint phải là URL HTTPS gốc của deployment a.run.app.');
  return url.origin;
}

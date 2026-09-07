import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const cookieName = '__Host-family_session';
const lifetime = 60 * 60 * 24 * 365;
export function secret(name: 'SESSION_SECRET' | 'INVITE_TOKEN') {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error('Authentication unavailable');
  return value;
}
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function publicOrigin() {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('Invalid public origin');
  return origin;
}
export function signSession() {
  const payload = `${Math.floor(Date.now() / 1000) + lifetime}.${randomBytes(24).toString('base64url')}`;
  const signature = createHmac('sha256', secret('SESSION_SECRET')).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function authenticated(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value || value.length > 256) return false;
  const [expires, nonce, signature, extra] = value.split('.');
  if (!expires || !nonce || !signature || extra || !/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000) return false;
  const expected = createHmac('sha256', secret('SESSION_SECRET')).update(`${expires}.${nonce}`).digest('base64url');
  return equalSecret(signature, expected);
}
export function sessionCookie(value: string, clear = false) {
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : lifetime}`;
}
// A bounded process-wide bucket cannot be bypassed with spoofed forwarding headers.
// This one-household service intentionally trades granular limits for proxy independence.
let invalidAttempts = 0;
let windowStart = 0;
export function inviteLimited(now = Date.now()) {
  if (now - windowStart >= 60_000) { windowStart = now; invalidAttempts = 0; }
  return invalidAttempts >= 10;
}
export function invalidInvite() { invalidAttempts++; }

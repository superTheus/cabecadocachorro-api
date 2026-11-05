import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return (
    'scrypt$' + salt + '$' + (await derive(password, salt)).toString('hex')
  );
}
export async function passwordMatches(
  password: string,
  hash: string,
): Promise<boolean> {
  const parts = hash.split('$');
  const valid =
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const actual = await derive(password, valid ? parts[1] : '0'.repeat(32));
  return valid && timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}
export function seal(
  value: unknown,
  key: string,
  store: string,
  purpose = 'customer-mail',
): string {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), nonce);
  cipher.setAAD(Buffer.from(purpose + ':' + store));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString('base64'))
    .join('.');
}
export function unseal(
  value: string,
  key: string,
  store: string,
  purpose = 'customer-mail',
): unknown {
  const [nonce, tag, encrypted] = value
    .split('.')
    .map((v) => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    nonce,
  );
  cipher.setAAD(Buffer.from(purpose + ':' + store));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8'),
  );
}

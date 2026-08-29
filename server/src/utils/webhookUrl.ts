import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class WebhookUrlError extends Error {}

type HostResolver = (hostname: string) => Promise<string[]>;

const blockedHostnames = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
]);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    blockedHostnames.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  );
}

export function isBlockedIpAddress(address: string): boolean {
  const ip = normalizeHostname(address);
  const family = net.isIP(ip);
  if (family === 4) {
    const [first, second] = ip.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }

  if (family === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;

    const mappedIpv4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return mappedIpv4 ? isBlockedIpAddress(mappedIpv4) : false;
  }

  return true;
}

async function resolvePublicHostname(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Accept only public HTTP(S) endpoints. Resolution is deliberately performed
 * every time immediately before use so saved URLs cannot later point to an
 * internal host without being checked again.
 */
export async function validateWebhookUrl(
  value: unknown,
  resolveHostname: HostResolver = resolvePublicHostname,
): Promise<URL> {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WebhookUrlError('Webhook URL is required');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WebhookUrlError('Webhook URL must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebhookUrlError('Webhook URL must use http or https');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('Webhook URL must not include credentials');
  }

  const hostname = normalizeHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new WebhookUrlError('Webhook URL must not target localhost or an internal hostname');
  }

  const addresses = net.isIP(hostname) ? [hostname] : await resolveHostname(hostname);
  if (addresses.length === 0 || addresses.some(isBlockedIpAddress)) {
    throw new WebhookUrlError('Webhook URL must resolve only to public IP addresses');
  }

  return url;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { isBlockedIpAddress, validateWebhookUrl, WebhookUrlError } from './webhookUrl';

test('blocks loopback, private, link-local, and metadata IP addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }
  assert.equal(isBlockedIpAddress('8.8.8.8'), false);
});

test('rejects unsafe URL protocols, hostnames, and DNS answers', async () => {
  await assert.rejects(() => validateWebhookUrl('file:///etc/passwd'), WebhookUrlError);
  await assert.rejects(() => validateWebhookUrl('http://localhost/hook'), WebhookUrlError);
  await assert.rejects(
    () => validateWebhookUrl('https://hooks.example.test', async () => ['169.254.169.254']),
    WebhookUrlError,
  );
});

test('accepts public HTTPS webhook URLs', async () => {
  const url = await validateWebhookUrl('https://hooks.example.test/path', async () => ['93.184.216.34']);
  assert.equal(url.toString(), 'https://hooks.example.test/path');
});

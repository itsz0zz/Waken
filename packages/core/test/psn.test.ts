import { describe, expect, it } from 'vitest';
import { accountIdFromUserId, psnCodeFrom } from '../src';

describe('PSN', () => {
  it('turns a user id into the account id chiaki links with', () => {
    // 1234567890123456789 = 0x112210F47DE98115, little endian.
    expect(accountIdFromUserId('1234567890123456789')).toBe(Buffer.from([0x15, 0x81, 0xe9, 0x7d, 0xf4, 0x10, 0x22, 0x11]).toString('base64'));
    expect(Buffer.from(accountIdFromUserId('42'), 'base64')).toHaveLength(8);
  });

  it('finds the code in the address Sony sent the browser to', () => {
    expect(psnCodeFrom('https://remoteplay.dl.playstation.net/remoteplay/redirect?code=AbC123&cid=x')).toBe('AbC123');
    expect(psnCodeFrom('  v3.AbCdEf  '.replace('.', ''))).toBe('v3AbCdEf');
    expect(psnCodeFrom('https://example.com/nothing')).toBeNull();
  });
});

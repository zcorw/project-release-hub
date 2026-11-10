import { describe, expect, it } from 'vitest';
import { runtimeConfig } from '../server/config';
describe('runtime binding', () => {
  it('keeps native startup local-only by default', () => {
    expect(runtimeConfig({})).toEqual({ port: 4310, host: '127.0.0.1' });
  });
  it('requires an explicit container bind override', () => {
    expect(runtimeConfig({ HUB_BIND_HOST: '0.0.0.0', PORT: '4311' })).toEqual({
      port: 4311,
      host: '0.0.0.0',
    });
  });
  it('ignores unrelated host environment variables', () => {
    expect(runtimeConfig({ HOST: '0.0.0.0' }).host).toBe('127.0.0.1');
  });
  it('rejects unsupported bind values', () => {
    for (const host of ['', 'localhost', '192.168.1.2', 'example.com'])
      expect(() => runtimeConfig({ HUB_BIND_HOST: host })).toThrow('HUB_BIND_HOST');
  });
  it('rejects invalid ports', () => {
    for (const port of ['', '0', '1023', '65536', '4310.5', 'abc'])
      expect(() => runtimeConfig({ PORT: port })).toThrow('PORT');
  });
});

import { test, expect } from '@playwright/test';
import { researchProviderConfig, researchCspSources, securityProviderFor } from '../src/lib/research/provider-config';

test('local development defaults to Azure and the local API base', () => {
  expect(researchProviderConfig({})).toEqual({ securityProvider: 'azure', apiBase: '/api', apiOrigin: null });
  expect(securityProviderFor('aws')).toBe('aws'); expect(securityProviderFor('turnstile')).toBe('turnstile');
  expect(() => securityProviderFor('unknown')).toThrow();
});

test('Azure production requires an explicit HTTPS API while AWS retains relative compatibility', () => {
  for (const value of [undefined, '', '/api', '/api/']) expect(() => researchProviderConfig({ VITE_RESEARCH_API_URL: value }, true)).toThrow(/explicit HTTPS/);
  expect(researchProviderConfig({ VITE_RESEARCH_SECURITY_PROVIDER: 'aws', VITE_RESEARCH_API_URL: '/api' }, true).apiBase).toBe('/api');
});

test('production CSP permits only self and the exact configured HTTPS API origin for Azure connections', () => {
  const config = researchProviderConfig({ VITE_RESEARCH_API_URL: 'https://api.melzi.test:8443/api/' }, true);
  expect(config).toEqual({ securityProvider: 'azure', apiBase: 'https://api.melzi.test:8443/api', apiOrigin: 'https://api.melzi.test:8443' });
  const sources = researchCspSources(config);
  expect(sources.connect).toEqual(['self', 'https://api.melzi.test:8443']);
  expect(sources.script).toEqual(['self']); expect(sources.frame).toEqual(['none']);
  for (const broad of ['https:', '*', 'https://*.azurewebsites.net', 'https://other.melzi.test']) expect(sources.connect).not.toContain(broad);
  expect(sources.script).not.toContain('unsafe-inline'); expect(sources.connect).not.toContain('https://challenges.cloudflare.com');
});

for (const value of [
  'http://api.melzi.test/api', '//api.melzi.test/api', 'javascript:alert(1)', 'data:text/html,x', '/elsewhere',
  'https://user:password@api.melzi.test/api', 'https://*.azurewebsites.net/api', 'https://api.melzi.test/api?secret=x',
  'https://api.melzi.test/api#fragment', ' https://api.melzi.test/api', 'https://api.melzi.test/api ',
  'https://api.melzi.test/api\\route', 'https://api.melzi.test/api\nroute'
]) test(`unsafe API configuration is rejected: ${JSON.stringify(value)}`, () => {
  expect(() => researchProviderConfig({ VITE_RESEARCH_API_URL: value }, true)).toThrow();
});

test('only explicit Turnstile configuration permits its challenge script and frame', () => {
  const sources = researchCspSources(researchProviderConfig({ VITE_RESEARCH_SECURITY_PROVIDER: 'turnstile' }, true));
  expect(sources.script).toEqual(['self', 'https://challenges.cloudflare.com']);
  expect(sources.frame).toEqual(['https://challenges.cloudflare.com']);
});

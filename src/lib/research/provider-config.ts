export type ResearchSecurityProvider = 'azure' | 'aws' | 'turnstile';
export type PublicResearchEnv = {
  VITE_RESEARCH_SECURITY_PROVIDER?: string;
  VITE_RESEARCH_API_URL?: string;
};
export type ResearchProviderConfig = {
  securityProvider: ResearchSecurityProvider;
  apiBase: string;
  apiOrigin: string | null;
};

export function securityProviderFor(value?: string): ResearchSecurityProvider {
  if (value === undefined || value === '') return 'azure';
  if (value === 'azure' || value === 'aws' || value === 'turnstile') return value;
  throw new Error('VITE_RESEARCH_SECURITY_PROVIDER must be azure, aws, or turnstile.');
}

/** Public configuration only. Never accept credentials, wildcards, or insecure API URLs. */
export function researchProviderConfig(env: PublicResearchEnv, production = false): ResearchProviderConfig {
  const securityProvider = securityProviderFor(env.VITE_RESEARCH_SECURITY_PROVIDER);
  const value = env.VITE_RESEARCH_API_URL || '/api';
  if (value === '/api' || value === '/api/') {
    if (production && securityProvider === 'azure') throw new Error('Azure static production builds require an explicit HTTPS VITE_RESEARCH_API_URL. The /api default is for local development only.');
    return { securityProvider, apiBase: '/api', apiOrigin: null };
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('VITE_RESEARCH_API_URL must be an absolute HTTPS URL or the local /api base.'); }
  if (value !== value.trim() || /[\\\s?#]/.test(value) || !value.startsWith('https://') || url.protocol !== 'https:' ||
      !url.hostname || url.hostname.includes('*') || url.username || url.password) {
    throw new Error('VITE_RESEARCH_API_URL must use HTTPS with an exact host and no credentials, whitespace, query, or fragment.');
  }
  return { securityProvider, apiBase: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), apiOrigin: url.origin };
}

export function researchCspSources(config: ResearchProviderConfig) {
  const challenge = 'https://challenges.cloudflare.com';
  const turnstile = config.securityProvider === 'turnstile';
  return {
    connect: ['self', ...(config.apiOrigin ? [config.apiOrigin] : []), ...(turnstile ? [challenge] : [])],
    script: ['self', ...(turnstile ? [challenge] : [])],
    frame: turnstile ? [challenge] : ['none']
  };
}

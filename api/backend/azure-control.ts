// App Service/Flex system-assigned managed identity only. No SDK credential
// fallback, bearer logging, arbitrary destination, or redirect following.
export interface AppControl { stop(): Promise<void>; start(): Promise<void> }
interface Dependencies { fetch?: typeof fetch; env?: () => NodeJS.ProcessEnv; now?: () => number }
const RESOURCE = /^\/subscriptions\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/resourceGroups\/[A-Za-z0-9_.()-]{1,90}\/providers\/Microsoft\.Web\/sites\/[A-Za-z0-9][A-Za-z0-9-]{0,59}$/i;
export function armTarget(env: NodeJS.ProcessEnv): URL {
  const id = env.API_RESOURCE_ID;
  const version = env.AZURE_API_VERSION ?? '2025-03-01';
  if (!id || !RESOURCE.test(id) || !/^20\d{2}-\d{2}-\d{2}$/.test(version)) throw new Error('Invalid Azure control configuration');
  return new URL(`https://management.azure.com${id}?api-version=${version}`);
}
export function identityTarget(value: string | undefined): URL {
  if (!value) throw new Error('Managed identity unavailable');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid managed identity endpoint'); }
  const host = url.hostname;
  const linkLocal = /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) && host.split('.').every(part => Number(part) <= 255);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !(['localhost', '127.0.0.1', '[::1]'].includes(host) || linkLocal) ||
      url.username || url.password || url.search || url.hash ||
      !['/msi/token', '/metadata/identity/oauth2/token'].includes(url.pathname)) throw new Error('Invalid managed identity endpoint');
  url.searchParams.set('api-version', '2019-08-01');
  url.searchParams.set('resource', 'https://management.azure.com/');
  return url;
}

export function createAzureControl(dependencies: Dependencies = {}): AppControl & { state(): Promise<string> } {
  const request = dependencies.fetch ?? fetch;
  const environment = dependencies.env ?? (() => process.env);
  const now = dependencies.now ?? Date.now;
  let cached: { token: string; expires: number; endpoint: string; header: string } | undefined;
  let loading: Promise<string> | undefined;

  async function send(url: URL, init: RequestInit, deadline: AbortSignal): Promise<Response> {
    // At most one retry, only transient transport/429/5xx failures. The whole
    // operation is bounded so two recovery operations fit the DB session latch.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(900)]) });
        if (response.ok) return response;
        const transient = response.status === 429 || response.status >= 500;
        await response.body?.cancel().catch(() => {});
        if (!transient || attempt === 1 || deadline.aborted) throw new Error('control_request_rejected');
      } catch (error) {
        if (attempt === 1 || deadline.aborted || (error as Error)?.message === 'control_request_rejected') throw new Error('Azure control request failed');
      }
    }
    throw new Error('Azure control request failed');
  }
  async function token(deadline: AbortSignal): Promise<string> {
    const env = environment();
    const target = identityTarget(env.IDENTITY_ENDPOINT);
    const header = env.IDENTITY_HEADER;
    if (!header || /[\r\n]/.test(header) || header.length > 8192) throw new Error('Managed identity unavailable');
    if (cached && cached.endpoint === target.href && cached.header === header && cached.expires > now() + 30_000) return cached.token;
    if (loading) return loading;
    loading = (async () => {
      const response = await send(target, { headers: { 'X-IDENTITY-HEADER': header }, method: 'GET' }, deadline);
      const data = await response.json() as { access_token?: unknown; expires_on?: unknown; token_type?: unknown; resource?: unknown };
      const expires = Number(data.expires_on) * 1000;
      if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 32768 || /\s/.test(data.access_token) ||
          !Number.isFinite(expires) || expires <= now() + 30_000 ||
          (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer') ||
          (data.resource !== undefined && data.resource !== 'https://management.azure.com/')) throw new Error('Invalid managed identity response');
      cached = { token: data.access_token, expires: Math.min(expires, now() + 240_000), endpoint: target.href, header };
      return cached.token;
    })();
    try { return await loading; } finally { loading = undefined; }
  }
  async function stateWith(target: URL, bearer: string, deadline: AbortSignal): Promise<string> {
    const response = await send(target, { method: 'GET', headers: { authorization: `Bearer ${bearer}` } }, deadline);
    const data = await response.json() as { properties?: { state?: unknown } };
    if (typeof data.properties?.state !== 'string') throw new Error('Azure app state unavailable');
    return data.properties.state;
  }
  async function operate(action: 'start' | 'stop'): Promise<void> {
    const deadline = AbortSignal.timeout(2200);
    try {
      const target = armTarget(environment()); // Validate before obtaining any token.
      const bearer = await token(deadline);
      const operation = new URL(target);
      operation.pathname += `/${action}`;
      const response = await send(operation, { method: 'POST', headers: { authorization: `Bearer ${bearer}` } }, deadline);
      await response.body?.cancel().catch(() => {});
      const state = await stateWith(target, bearer, deadline);
      if (state !== (action === 'start' ? 'Running' : 'Stopped')) throw new Error('Azure app state unconfirmed');
    } catch {
      // Never propagate fetch diagnostics, URLs, headers, response bodies or tokens.
      throw new Error('Azure app control failed');
    }
  }
  return {
    stop: () => operate('stop'), start: () => operate('start'),
    async state() {
      try {
        const target = armTarget(environment());
        const deadline = AbortSignal.timeout(2200);
        return await stateWith(target, await token(deadline), deadline);
      } catch { throw new Error('Azure app state unavailable'); }
    }
  };
}

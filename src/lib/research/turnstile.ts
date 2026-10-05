type WidgetOptions = { sitekey: string; size: string; appearance: string; callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void; 'timeout-callback': () => void };
type Turnstile = { render: (container: HTMLElement, options: WidgetOptions) => string; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
let loading: Promise<Turnstile> | undefined;
function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    const timeout = setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error('Verification could not load')); };
    script.onerror = fail;
    script.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else fail(); };
    document.head.append(script);
  });
  return loading;
}
/** Render on demand, consume once, and render a fresh challenge for each POST attempt. */
export class ManagedTurnstile {
  private widget?: string;
  private cancel?: () => void;
  private generation = 0;
  constructor(private container: () => HTMLElement | undefined, private status: (active: boolean) => void) {}
  async token(): Promise<string> {
    this.cancel?.();
    const generation = ++this.generation;
    this.status(true);
    let api: Turnstile;
    try { api = await load(); }
    catch (error) { if (generation === this.generation) this.status(false); throw error; }
    if (generation !== this.generation) throw new Error('Verification session changed');
    const container = this.container();
    if (!container) { this.status(false); throw new Error('Open the feedback form to verify saving'); }
    if (this.widget) api.remove(this.widget);
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (token?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); this.cancel = undefined; this.status(false);
        if (token) resolve(token); else reject(new Error('Verification expired or could not complete'));
      };
      const timeout = setTimeout(() => finish(), 120000);
      this.cancel = () => finish();
      this.widget = api.render(container, {
        sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
        size: 'compact', appearance: 'interaction-only', callback: token => finish(token),
        'error-callback': () => finish(), 'expired-callback': () => finish(), 'timeout-callback': () => finish()
      });
    });
  }
  reset() { this.generation++; this.cancel?.(); if (this.widget) window.turnstile?.remove(this.widget); this.widget = undefined; this.status(false); }
}

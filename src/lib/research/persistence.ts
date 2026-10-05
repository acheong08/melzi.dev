import { choices, emptyAnswers, experiencedPain, isBuilding, isTeam, showsProblem, showsSpend, stepsFor, type Answers, type Step } from './form.js';
import { ANSWER_SCHEMA_VERSION, type DraftSnapshot, type SaveRequest, type SaveResult, type RemoteDraft } from './persistence-contract.js';
import { researchProviderConfig, type ResearchSecurityProvider } from './provider-config.js';

export const STORAGE_KEY = 'melzi.research.draft.v2';
export type PendingMutation = { method: 'POST' | 'PUT'; request: SaveRequest };
export type LocalDraft = DraftSnapshot & {
  version: 1; token: string; revision: number | null; pending: PendingMutation | null;
  acknowledged: string | null; createdAt: string; updatedAt: string;
  savedAt: string | null; expiresAt: string | null;
};
export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'retrying' | 'conflict' | 'expired' | 'invalid' | 'storage' | 'verification';
export type PersistenceView = { draft: LocalDraft | null; state: SaveState; warning: string; submitted: boolean; submitting: boolean };
type Options = {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; fetch: typeof fetch;
  challenge?: () => Promise<string>; online: () => boolean; apiBase?: string;
  securityProvider?: ResearchSecurityProvider;
  secureContext?: () => boolean;
  crypto?: Crypto; now?: () => number; debounceMs?: number; maxWaitMs?: number; timeoutMs?: number;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fingerprint = (d: DraftSnapshot) => JSON.stringify({ schemaVersion: d.schemaVersion, answers: d.answers, step: d.step, completed: d.completed });
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export function validAnswers(value: unknown): value is Answers {
  if (!value || typeof value !== 'object') return false;
  const a = value as Answers;
  for (const key of Object.keys(emptyAnswers()) as (keyof Answers)[]) {
    if (key === 'stackTools' || key === 'stackWhy') {
      if (!Array.isArray(a[key]) || a[key].length > (key === 'stackTools' ? 100 : 16) || a[key].some(v => typeof v !== 'string' || v.length > 80)) return false;
    } else if (typeof a[key] !== 'string' || a[key].length > (key === 'email' ? 254 : key === 'phone' ? 40 : 2000)) return false;
  }
  return Object.entries(choices).every(([key, opts]) => !a[key as keyof typeof choices] || opts.some(o => o.value === a[key as keyof typeof choices]));
}
export function finalValidation(answers: Answers): Step | null {
  for (const key of ['context', 'stage', 'burden'] as const) if (!answers[key]) return key;
  if (isTeam(answers) && !answers.role) return 'role';
  if (isBuilding(answers) && (!answers.stackTools.length || !answers.stackWhy.length)) return 'stack';
  if (showsProblem(answers)) {
    if (experiencedPain(answers)) { if (!answers.problemCategory) return 'problem'; }
    else if (!answers.anticipateIssues) return 'problem';
  }
  if (experiencedPain(answers)) {
    if (!answers.workaround) return 'workaround';
    if (answers.workaround === 'tried' && !answers.outcome) return 'outcome';
  }
  if (showsSpend(answers) && !answers.spend) return 'spend';
  if (isTeam(answers) && !answers.owner) return 'startup';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email.trim())) return 'contact';
  return null;
}
function validSnapshot(v: DraftSnapshot): boolean {
  return !!v && v.schemaVersion === ANSWER_SCHEMA_VERSION && validAnswers(v.answers) && typeof v.step === 'string' && typeof v.completed === 'boolean' && (!v.completed || finalValidation(v.answers) === null);
}
export function parseLocalDraft(raw: string): LocalDraft {
  const d = JSON.parse(raw) as LocalDraft;
  if (!validSnapshot(d) || d.version !== 1 || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(d.token) ||
      !(d.revision === null || revision(d.revision)) || !timestamp(d.createdAt) || !timestamp(d.updatedAt) ||
      !(d.savedAt === null || timestamp(d.savedAt)) || !(d.expiresAt === null || timestamp(d.expiresAt)) ||
      !(d.acknowledged === null || typeof d.acknowledged === 'string')) throw new Error('Invalid local draft');
  if (d.revision === null && (d.acknowledged !== null || d.savedAt !== null || d.expiresAt !== null)) throw new Error('Invalid acknowledgement');
  if (d.revision !== null && (d.revision < 1 || !d.acknowledged || !d.savedAt || !d.expiresAt || !validSnapshot(JSON.parse(d.acknowledged)))) throw new Error('Invalid acknowledgement');
  if (d.pending) {
    const p = d.pending;
    if (!['POST', 'PUT'].includes(p.method) || !validSnapshot(p.request) || !revision(p.request.expectedRevision) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.request.mutationId) ||
        (p.method === 'POST' ? p.request.expectedRevision !== 0 || d.revision !== null : p.request.expectedRevision !== d.revision)) throw new Error('Invalid pending mutation');
  } else if (d.pending !== null) throw new Error('Invalid pending mutation');
  if (!stepsFor(d.answers).includes(d.step)) d.step = 'context';
  return d;
}
function validResult(v: SaveResult): boolean {
  return !!v && revision(v.revision) && v.revision > 0 && timestamp(v.savedAt) && timestamp(v.expiresAt) && typeof v.completed === 'boolean';
}

/** One controller survives dialog closure. Pending bodies are immutable and durable before I/O. */
export class DraftPersistence {
  private draft: LocalDraft | null = null;
  private state: SaveState = 'idle';
  private warning = '';
  private listeners = new Set<(view: PersistenceView) => void>();
  private raw: string | null = null;
  private ready = false;
  private generation = 0;
  private active = false;
  private timer?: ReturnType<typeof setTimeout>;
  private firstQueued = 0;
  private failures = 0;
  private notBefore = 0;
  private checking = false;
  private abort?: AbortController;
  private now: () => number;
  constructor(private options: Options) { this.now = options.now ?? Date.now; }
  get view(): PersistenceView {
    const submitted = !!this.draft?.completed && !this.draft.pending && this.draft.acknowledged === fingerprint(this.draft);
    return { draft: this.draft ? clone(this.draft) : null, state: this.state, warning: this.warning, submitted, submitting: !!this.draft?.completed && !submitted };
  }
  subscribe(listener: (view: PersistenceView) => void) { this.listeners.add(listener); listener(this.view); return () => { this.listeners.delete(listener); }; }
  private emit() { const view = this.view; for (const listener of this.listeners) listener(view); }
  hydrate() {
    if (this.ready) return;
    try { this.raw = this.options.storage.getItem(STORAGE_KEY); if (this.raw) this.draft = parseLocalDraft(this.raw); }
    catch { this.state = 'storage'; this.warning = 'This device could not restore its draft. Download any visible answers before clearing local data.'; }
    this.ready = true;
    if (this.draft) {
      this.state = this.draft.acknowledged === fingerprint(this.draft) && !this.draft.pending ? 'saved' : 'retrying';
      if (this.draft.pending || this.draft.revision === null) this.schedule(0);
      else { this.checking = true; void this.checkRemote(); }
    }
    this.emit();
  }
  private blocked() { return ['conflict', 'expired', 'invalid', 'storage', 'verification'].includes(this.state); }
  private transportUnavailable() {
    this.state = 'invalid';
    this.warning = 'HTTPS and secure browser cryptography are required for server saving. Your answers are saved on this device only. Download your answers before changing addresses, because browser drafts belong to this address.';
  }
  private transportReady(): boolean {
    try {
      const crypto = this.options.crypto ?? globalThis.crypto;
      const secure = this.options.secureContext?.() ?? (globalThis.isSecureContext !== false);
      if (secure && typeof crypto?.getRandomValues === 'function' && typeof crypto?.randomUUID === 'function' && typeof crypto?.subtle?.digest === 'function') return true;
    } catch { /* Restricted browser crypto access is not a retryable network failure. */ }
    this.transportUnavailable(); this.emit(); return false;
  }
  private token() {
    const bytes = (this.options.crypto ?? globalThis.crypto).getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  private newDraft(answers: Answers, step: Step): LocalDraft {
    const now = new Date(this.now()).toISOString();
    return { version: 1, schemaVersion: ANSWER_SCHEMA_VERSION, token: this.token(), answers: clone(answers), step, completed: false, revision: null, pending: null, acknowledged: null, createdAt: now, updatedAt: now, savedAt: null, expiresAt: null };
  }
  update(answers: Answers, step: Step, completed = false) {
    if (!this.ready) return;
    if (completed && finalValidation(answers)) return;
    const snapshot: DraftSnapshot = { schemaVersion: ANSWER_SCHEMA_VERSION, answers: clone(answers), step: stepsFor(answers).includes(step) ? step : 'context', completed };
    if (this.draft && fingerprint(this.draft) === fingerprint(snapshot)) return;
    if (!this.draft && JSON.stringify(answers) === JSON.stringify(emptyAnswers())) return;
    this.draft = this.draft ? { ...this.draft, ...snapshot, updatedAt: new Date(this.now()).toISOString() } : { ...this.newDraft(answers, step), ...snapshot };
    if (!['conflict', 'storage'].includes(this.state) && this.persist() && !this.blocked()) { this.state = this.options.online() ? 'saving' : 'offline'; this.schedule(); }
    this.emit();
  }
  private persist(): boolean {
    try {
      if (this.options.storage.getItem(STORAGE_KEY) !== this.raw) {
        this.state = 'conflict'; this.warning = 'Another tab changed this draft. Saving is paused. Download your answers or reload the saved draft.'; return false;
      }
      const raw = this.draft ? JSON.stringify(this.draft) : null;
      if (raw) this.options.storage.setItem(STORAGE_KEY, raw); else this.options.storage.removeItem(STORAGE_KEY);
      this.raw = raw;
      return true;
    } catch {
      this.state = 'storage'; this.warning = 'Local storage is unavailable or full. These changes may be lost on reload. Download your answers, then retry storage.'; return false;
    }
  }
  private schedule(delay?: number) {
    if (this.blocked() || !this.draft) return;
    if (this.timer) clearTimeout(this.timer);
    if (!this.firstQueued) this.firstQueued = this.now();
    const debounce = Math.min(this.options.debounceMs ?? 800, Math.max(0, (this.options.maxWaitMs ?? 5000) - (this.now() - this.firstQueued)));
    const wait = Math.max(delay ?? debounce, this.notBefore - this.now(), 0);
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
  }
  async flush(keepalive = false) {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (!this.ready || !this.draft || this.active || this.checking || this.blocked()) return;
    if (!this.transportReady()) return;
    if (!this.options.online()) { this.state = 'offline'; this.emit(); return; }
    if (this.notBefore > this.now()) { this.schedule(this.notBefore - this.now()); return; }
    if (!this.draft.pending && this.draft.acknowledged === fingerprint(this.draft)) { this.state = 'saved'; this.emit(); return; }
    const generation = this.generation;
    this.active = true; this.firstQueued = 0; this.state = 'saving';
    try {
      if (!this.draft.pending) {
        let mutationId: string;
        try { mutationId = (this.options.crypto ?? globalThis.crypto).randomUUID(); }
        catch { this.transportUnavailable(); return; }
        this.draft.pending = { method: this.draft.revision === null ? 'POST' : 'PUT', request: { schemaVersion: ANSWER_SCHEMA_VERSION, answers: clone(this.draft.answers), step: this.draft.step, completed: this.draft.revision === null ? false : this.draft.completed, expectedRevision: this.draft.revision ?? 0, mutationId } };
      }
      if (!this.persist()) return;
      const pending = clone(this.draft.pending), token = this.draft.token;
      this.emit();
      const challenge = pending.method === 'POST' && this.options.securityProvider === 'turnstile' ? await this.options.challenge?.() : undefined;
      if (pending.method === 'POST' && this.options.securityProvider === 'turnstile' && !challenge) throw new Error('Verification is unavailable');
      if (generation !== this.generation || this.blocked()) return;
      const result = await this.request(pending.method, token, pending.request, challenge, keepalive) as SaveResult;
      if (generation !== this.generation || this.blocked()) return;
      if (!validResult(result) || result.revision !== pending.request.expectedRevision + 1 || result.completed !== pending.request.completed) throw new Error('Invalid save acknowledgement');
      // Acknowledge only the exact sent snapshot, never copy old answers over new edits.
      this.draft = { ...this.draft!, ...result, completed: this.draft!.completed, revision: result.revision, pending: null, acknowledged: fingerprint(pending.request) };
      this.failures = 0; this.notBefore = 0; this.warning = '';
      if (!this.persist()) return;
      this.state = this.draft.acknowledged === fingerprint(this.draft) ? 'saved' : 'saving';
    } catch (error) { if (generation === this.generation && !this.blocked()) this.handleError(error); }
    finally {
      if (generation === this.generation) {
        this.active = false; this.emit();
        if (!this.blocked() && this.state !== 'saved' && this.options.online()) this.schedule(Math.max(0, this.notBefore - this.now()));
      }
    }
  }
  private async request(method: string, token: string, body?: SaveRequest, challenge?: string, keepalive = false) {
    if (!this.transportReady()) throw new Error('Secure transport is unavailable');
    const abort = new AbortController(); this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), this.options.timeoutMs ?? 15000);
    try {
      // Serialize once: OAC hashes the exact UTF-8 bytes sent, not a reconstructed object.
      const payload = body ? JSON.stringify(body) : undefined;
      let payloadHash: string | undefined;
      if (payload !== undefined && this.options.securityProvider === 'aws') {
        const digest = await (this.options.crypto ?? globalThis.crypto).subtle.digest('SHA-256', new TextEncoder().encode(payload));
        payloadHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      }
      abort.signal.throwIfAborted();
      const response = await this.options.fetch(`${(this.options.apiBase ?? '/api').replace(/\/$/, '')}/v1/draft`, { method, headers: { Authorization: `Bearer ${token}`, ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(payloadHash ? { 'x-amz-content-sha256': payloadHash } : {}), ...(challenge ? { 'X-Turnstile-Token': challenge } : {}) }, ...(payload !== undefined ? { body: payload } : {}), signal: abort.signal, cache: 'no-store', credentials: 'omit', keepalive });
      if (!response.ok) {
        const error = new Error(`Save failed (${response.status})`) as Error & { status: number; retryAfter: number; code?: string };
        error.status = response.status;
        try { const data = await response.json(); if (typeof data?.error === 'string') error.code = data.error; } catch { /* Status remains authoritative. */ }
        const retry = response.headers.get('Retry-After');
        error.retryAfter = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - this.now())) : 0;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timeout); if (this.abort === abort) this.abort = undefined; }
  }
  private handleError(error: unknown) {
    const { status, retryAfter, code } = error as { status?: number; retryAfter?: number; code?: string };
    const azureUnavailable = status === 403 && (this.options.securityProvider ?? 'azure') === 'azure' && !['origin_not_allowed', 'forbidden'].includes(code ?? '');
    if (status === 403 && !azureUnavailable && !['challenge_failed', 'challenge_required'].includes(code ?? '')) { this.state = 'invalid'; this.warning = 'Saving is not allowed from this site. Download your answers and try the official feedback page.'; }
    else if (status === 403 && !azureUnavailable && this.failures >= 2) { this.state = 'verification'; this.warning = 'Verification could not complete. Your local answers are kept. Retry save to try a new challenge.'; }
    else if (status === 409) { this.state = 'conflict'; this.warning = 'The saved draft changed elsewhere. Saving is paused. Download your answers or reload the saved draft.'; }
    else if ([401, 404, 410].includes(status ?? 0)) { this.state = 'expired'; this.warning = 'This saved session is unavailable or expired. Your local answers are kept. Start a fresh session to save them again.'; }
    else if ([400, 413].includes(status ?? 0)) { this.state = 'invalid'; this.warning = 'The server could not accept this draft. Download your answers or start a fresh session after editing.'; }
    else {
      this.state = this.options.online() ? 'retrying' : 'offline';
      if (status === 429) this.warning = 'Server saving is temporarily disabled by a service limit. Your answers are saved on this device. We will retry automatically.';
      else if (status === 503 || azureUnavailable) this.warning = 'Server saving is temporarily unavailable. Your answers are saved on this device. We will retry automatically.';
      this.failures++;
      this.notBefore = this.now() + Math.max(Number.isFinite(retryAfter) ? retryAfter! : 0, Math.min(60000, 1000 * 2 ** Math.min(this.failures - 1, 6)) * (0.75 + Math.random() * 0.5));
    }
  }
  retry() {
    if (this.state === 'verification') { this.state = 'retrying'; this.failures = 0; this.notBefore = 0; this.warning = ''; }
    if (this.state === 'storage' && this.draft) { this.state = 'retrying'; if (!this.persist()) { this.emit(); return; } this.warning = ''; }
    if (this.blocked() || this.checking) return;
    if (this.draft?.revision !== null && this.draft && !this.draft.pending) { this.checking = true; void this.checkRemote(); }
    else void this.flush();
  }
  connectionChanged() { if (this.options.online()) this.retry(); else { if (!this.blocked() && this.draft) this.state = 'offline'; this.emit(); } }
  storageChanged(newValue: string | null) {
    if (newValue === this.raw) return;
    this.generation++; this.abort?.abort(); this.active = false; this.checking = false;
    if (this.timer) clearTimeout(this.timer);
    this.state = 'conflict'; this.warning = 'Another tab changed or cleared this draft. Saving is paused. Download your answers or reload the saved draft.'; this.emit();
  }
  private async checkRemote(replace = false) {
    const generation = this.generation;
    if (!this.draft || this.blocked()) { this.checking = false; return; }
    if (!this.transportReady()) { this.checking = false; return; }
    if (!this.options.online()) { this.checking = false; this.state = 'offline'; this.emit(); return; }
    try {
      const remote = await this.request('GET', this.draft.token) as RemoteDraft;
      if (generation !== this.generation) return;
      if (!validSnapshot(remote) || !validResult(remote)) throw new Error('Invalid saved draft');
      if (!replace && remote.revision !== this.draft.revision) { this.handleError({ status: 409 }); return; }
      if (replace) {
        this.draft = { ...this.draft, ...remote, step: stepsFor(remote.answers).includes(remote.step) ? remote.step : 'context', pending: null, acknowledged: fingerprint(remote), updatedAt: new Date(this.now()).toISOString() };
        this.warning = ''; this.state = 'saved'; this.persist();
      } else this.state = this.draft.acknowledged === fingerprint(this.draft) ? 'saved' : 'saving';
    } catch (error) { if (generation === this.generation && !this.blocked()) this.handleError(error); }
    finally {
      if (generation === this.generation) {
        this.checking = false; this.emit();
        if (!this.blocked() && this.state !== 'saved' && this.options.online()) this.schedule(Math.max(0, this.notBefore - this.now()));
      }
    }
  }
  async reloadSaved() {
    this.invalidate();
    try {
      this.raw = this.options.storage.getItem(STORAGE_KEY);
      if (this.raw) this.draft = parseLocalDraft(this.raw);
      else { this.draft = null; this.state = 'idle'; this.warning = ''; this.emit(); return; }
      this.warning = ''; this.state = 'saving';
      if (this.draft.revision === null) { this.emit(); this.schedule(0); }
      else { this.checking = true; await this.checkRemote(true); }
    } catch { this.state = 'storage'; this.warning = 'The local draft could not be read. Download your answers before clearing it.'; this.emit(); }
  }
  private invalidate() { this.generation++; this.abort?.abort(); this.active = false; this.checking = false; if (this.timer) clearTimeout(this.timer); this.firstQueued = 0; this.notBefore = 0; this.failures = 0; }
  freshSession() {
    const answers = this.draft?.answers ?? emptyAnswers(), step = this.draft?.step ?? 'context';
    this.invalidate();
    this.draft = this.newDraft(answers, step); this.state = 'saving'; this.warning = '';
    try { this.raw = this.options.storage.getItem(STORAGE_KEY); } catch { /* persist reports failure */ }
    if (this.persist()) this.schedule(0); this.emit();
  }
  clearLocal() {
    this.invalidate(); this.draft = null; this.state = 'idle'; this.warning = '';
    try { this.raw = this.options.storage.getItem(STORAGE_KEY); } catch { /* persist reports failure */ }
    this.persist(); this.emit();
  }
}

let browserController: DraftPersistence | undefined;
export function getDraftPersistence(challenge: () => Promise<string>): DraftPersistence {
  if (!browserController) {
    const storage = { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value), removeItem: (key: string) => window.localStorage.removeItem(key) };
    const config = researchProviderConfig({ VITE_RESEARCH_SECURITY_PROVIDER: import.meta.env.VITE_RESEARCH_SECURITY_PROVIDER, VITE_RESEARCH_API_URL: import.meta.env.VITE_RESEARCH_API_URL });
    browserController = new DraftPersistence({ storage, fetch: window.fetch.bind(window), challenge, online: () => navigator.onLine, secureContext: () => window.isSecureContext, apiBase: config.apiBase, securityProvider: config.securityProvider });
    window.addEventListener('online', () => browserController!.connectionChanged());
    window.addEventListener('offline', () => browserController!.connectionChanged());
    window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) browserController!.storageChanged(event.newValue); });
    window.addEventListener('pagehide', () => { void browserController!.flush(true); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void browserController!.flush(true); });
    browserController.hydrate();
  }
  return browserController;
}

export function saveStatus(view: PersistenceView): string {
  if (view.state === 'verification') return 'Verification needed to save';
  if (view.state === 'storage') return 'Not saved on this device';
  if (view.state === 'conflict') return 'Save paused: draft conflict';
  if (view.state === 'expired') return 'Saved session unavailable';
  if (view.state === 'invalid') return 'Server save needs attention';
  if (view.state === 'idle') return 'Responses save as you go';
  if (view.state === 'saved') return 'Saved';
  if (view.state === 'offline') return 'Saved on this device. Offline';
  if (view.state === 'retrying') return 'Saved on this device, retrying';
  return 'Saving';
}
import type { Answers, Step } from './form.js';

export const ANSWER_SCHEMA_VERSION = 5 as const;
export const MAX_REQUEST_BYTES = 65_536;
export type DraftSnapshot = {
  schemaVersion: typeof ANSWER_SCHEMA_VERSION;
  answers: Answers;
  step: Step;
  completed: boolean;
};
export type SaveRequest = DraftSnapshot & { expectedRevision: number; mutationId: string };
export type SaveResult = { revision: number; savedAt: string; expiresAt: string; completed: boolean };
export type RemoteDraft = DraftSnapshot & SaveResult;
export type ApiError = { error: string; message: string; revision?: number };

// API base URL + /v1/draft. All requests use Authorization: Bearer <256-bit token>.
// POST creates a draft at revision 1; expectedRevision must be 0. Repeating the
// same mutation is safe. AWS hosting requires x-amz-content-sha256 on POST/PUT
// for CloudFront OAC. The optional legacy Worker also requires a Turnstile proof.
// PUT compares expectedRevision atomically and increments it once per mutation.
// Repeated mutationId + identical body returns the original SaveResult.
// GET returns RemoteDraft. POST/PUT return SaveResult. Responses are never cached.
// 400/413 invalid input, 401 invalid/missing credential, 404 unknown credential,
// 409 stale revision or mutation reuse with different data, 410 expired draft,
// 429 admission limit (Retry-After), 503 unavailable. Errors use ApiError.
// Drafts expire after 30 days of inactivity. Completed responses expire after
// 365 days. An owner may edit after completion, returning the record to draft.

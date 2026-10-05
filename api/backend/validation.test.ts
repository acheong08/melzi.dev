// Isolated, network-free: bun test ./backend/validation.test.ts
// Imports validation/model only: no handler, database, AWS SDK, or credentials.
import { describe, test, expect } from 'bun:test';
import { ApiFailure, parseMutation, projectedResponse, validateAnswers } from './validation.ts';
import { choices, emptyAnswers, stepsFor, type Answers } from '../../src/lib/research/form.ts';
import { MAX_REQUEST_BYTES, type SaveRequest } from '../../src/lib/research/persistence-contract.ts';

const mutationId = '462468e4-df28-4ad1-bcd3-34cd95e404aa';
function request(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 4, answers: emptyAnswers(), step: 'context', completed: false, expectedRevision: 0, mutationId, ...overrides };
}
function parse(overrides: Record<string, unknown> = {}): SaveRequest { return parseMutation(JSON.stringify(request(overrides))); }
function finalAnswers(overrides: Partial<Answers> = {}): Answers {
  return { ...emptyAnswers(), context: 'startup', stage: 'building', burden: 'time', next: 'none', ...overrides };
}
function expectFailure(callback: () => unknown, status = 400, code?: string) {
  let caught: unknown;
  try { callback(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ApiFailure);
  expect((caught as ApiFailure).status).toBe(status);
  if (code) expect((caught as ApiFailure).code).toBe(code);
}

describe('partial and completed draft validation', () => {
  test('a fully blank answer state is a valid unfinished draft', () => {
    expect(parse()).toEqual(request());
  });
  test('partial means empty answer values, not missing shape fields', () => {
    const result = parse({ answers: { ...emptyAnswers(), context: 'other', contextDetails: 'Still exploring.' }, step: 'stage' });
    expect(result.answers.contextDetails).toBe('Still exploring.');
    expectFailure(() => parse({ answers: { context: 'other' } }), 400, 'invalid_answers');
  });
  test('unfinished drafts may contain an incomplete email while the user types', () => {
    const result = parse({ answers: finalAnswers({ next: 'chat', email: 'person@' }), step: 'contact' });
    expect(result.answers.email).toBe('person@');
    expect(result.completed).toBe(false);
  });
  test('completion accepts required choices and skipped optional questions', () => {
    const result = parse({ answers: finalAnswers(), completed: true, step: 'hate', expectedRevision: 8 });
    expect(result.completed).toBe(true);
    expect(result.answers.problem).toBe('');
    expect(result.answers.stackTools).toEqual([]);
  });
  for (const field of ['context', 'stage', 'burden', 'next'] as const) {
    test(`completion requires ${field}`, () => {
      expectFailure(() => parse({ answers: finalAnswers({ [field]: '' }), completed: true, step: 'hate' }), 400, 'incomplete');
    });
  }
  for (const next of ['try', 'chat', 'updates']) {
    test(`${next} completion requires a valid email`, () => {
      expect(parse({ answers: finalAnswers({ next, email: 'person+research@example.com' }), completed: true, step: 'hate' }).completed).toBe(true);
      for (const email of ['', '   ', 'person', 'person@', '@example.com', 'person@@example.com', 'per son@example.com', 'person@exa mple.com']) {
        expectFailure(() => parse({ answers: finalAnswers({ next, email }), completed: true, step: 'hate' }), 400, 'invalid_email');
      }
    });
  }
  test('no-follow-up completion does not require or retain an email', () => {
    const result = parse({ answers: finalAnswers({ next: 'none', email: 'old@example.com' }), completed: true, step: 'hate' });
    expect(result.answers.email).toBe('');
  });
  test('completed requests must identify the final question', () => {
    expectFailure(() => parse({ answers: finalAnswers(), completed: true, step: 'context' }), 400, 'incomplete');
  });
  test('an unchosen other-context description remains optional on completion', () => {
    expect(parse({ answers: finalAnswers({ context: 'other', contextDetails: '' }), completed: true, step: 'hate' }).completed).toBe(true);
  });
  test('submitted state may return to an unfinished draft in the contract', () => {
    expect(parse({ answers: finalAnswers(), completed: false, step: 'hate', expectedRevision: 4 }).completed).toBe(false);
  });
});

describe('strict shape, schema, UUID, revision, and paths', () => {
  for (const raw of ['', '{', 'null', '[]', 'true', '"text"', '7']) {
    test(`reject invalid/non-object JSON (${JSON.stringify(raw)})`, () => expectFailure(() => parseMutation(raw)));
  }
  test('reject unknown/missing top-level keys, including ownership metadata', () => {
    for (const [key, value] of Object.entries({ owner: 'other', token_hash: 'forged', revision: 99, status: 'submitted', expiresAt: '2099-01-01', updatedAt: '2099-01-01', schema: 4 })) {
      expectFailure(() => parse({ [key]: value }), 400, 'invalid_request');
    }
    for (const key of Object.keys(request())) {
      const value = request() as Record<string, unknown>;
      delete value[key];
      expectFailure(() => parseMutation(JSON.stringify(value)), 400, 'invalid_request');
    }
  });
  test('reject unknown/missing answer fields and prototype keys', () => {
    expectFailure(() => parse({ answers: { ...emptyAnswers(), ownerId: 'forged' } }), 400, 'invalid_answers');
    const missing = { ...emptyAnswers() } as Partial<Answers>;
    delete missing.hate;
    expectFailure(() => parse({ answers: missing }), 400, 'invalid_answers');
    const polluted = JSON.parse(JSON.stringify(emptyAnswers()).replace('{', '{"__proto__":{"admin":true},'));
    expectFailure(() => validateAnswers(polluted), 400, 'invalid_answers');
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });
  test('reject arrays, null, and non-plain answer objects', () => {
    for (const value of [null, [], 'text', 1, new Date(), Object.create(null)]) expectFailure(() => validateAnswers(value), 400, 'invalid_answers');
  });
  test('schema version and completed are not coercible', () => {
    for (const schemaVersion of [3, 5, '4', null, false]) expectFailure(() => parse({ schemaVersion }), 400, 'invalid_request');
    for (const completed of ['false', 0, 1, null]) expectFailure(() => parse({ completed }), 400, 'invalid_request');
  });
  test('accept canonical UUID v4 values with either hex case', () => {
    expect(parse().mutationId).toBe(mutationId);
    expect(parse({ mutationId: mutationId.toUpperCase() }).mutationId).toBe(mutationId.toUpperCase());
  });
  test('reject malformed UUIDs, non-v4 UUIDs, and wrong variants', () => {
    for (const value of ['', 'not-a-uuid', `${mutationId}x`, ` ${mutationId}`, mutationId.replaceAll('-', ''), mutationId.replace('-4ad1-', '-1ad1-'), mutationId.replace('-bcd3-', '-7cd3-'), null, 42]) {
      expectFailure(() => parse({ mutationId: value }), 400, 'invalid_request');
    }
  });
  test('revision is a bounded nonnegative integer, never coerced from strings', () => {
    for (const expectedRevision of [0, 1, 999_999, 1_000_000]) expect(parse({ expectedRevision }).expectedRevision).toBe(expectedRevision);
    for (const expectedRevision of [-1, 0.5, 1_000_001, Number.MAX_SAFE_INTEGER + 1, '0', '1', null, false, NaN, Infinity]) expectFailure(() => parse({ expectedRevision }), 400, 'invalid_request');
  });
  test('unknown or branch-inapplicable step IDs are rejected', () => {
    for (const step of ['not-a-step', 'stack', 'workaround', 'outcome', 'startup', 'contact', 1, null]) expectFailure(() => parse({ step }), 400, 'invalid_step');
  });
  test('all applicable paths from a populated draft are accepted', () => {
    const answers = finalAnswers({ context: 'startup', stage: 'stable', burden: 'slows', problemCategory: 'cost', workaround: 'tried', next: 'chat', email: 'in-progress@' });
    for (const step of stepsFor(answers)) expect(parse({ answers, step }).step).toBe(step);
  });
});

describe('text, choices, tools, and byte limits', () => {
  for (const [field, options] of Object.entries(choices)) {
    test(`${field} only accepts the declared enum values or empty`, () => {
      for (const choice of ['', ...options.map(option => option.value)]) expect(() => validateAnswers({ ...emptyAnswers(), [field]: choice })).not.toThrow();
      for (const invalid of ['not-a-choice', ' STARTUP ', 1, true, null, {}, []]) expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: invalid }), 400, 'invalid_answers');
    });
  }
  for (const field of ['contextDetails', 'stack', 'problem', 'workingWell', 'workaroundDetails', 'hate'] as const) {
    test(`${field} has a 2000 UTF-16-unit bound and rejects wrong types`, () => {
      expect(() => validateAnswers({ ...emptyAnswers(), [field]: 'x'.repeat(2_000) })).not.toThrow();
      expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: 'x'.repeat(2_001) }), 400, 'invalid_answers');
      expect(() => validateAnswers({ ...emptyAnswers(), [field]: '😀'.repeat(1_000) })).not.toThrow();
      expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: '😀'.repeat(1_001) }), 400, 'invalid_answers');
      for (const value of [0, null, false, [], {}]) expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: value }), 400, 'invalid_answers');
    });
  }
  test('email has a 254-unit bound, also while incomplete', () => {
    expect(() => validateAnswers({ ...emptyAnswers(), next: 'chat', email: 'e'.repeat(254) })).not.toThrow();
    expectFailure(() => validateAnswers({ ...emptyAnswers(), next: 'chat', email: 'e'.repeat(255) }), 400, 'invalid_answers');
  });
  test('NUL and lone surrogates are rejected in every text field even if hidden', () => {
    for (const field of Object.keys(emptyAnswers()).filter(key => key !== 'stackTools')) {
      for (const value of ['before\0after', '\ud800', '\udfff', 'x\ud800y']) expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: value }), 400, 'invalid_answers');
    }
  });
  test('JSON-escaped NUL and lone surrogates cannot bypass field validation', () => {
    for (const hate of ['before\0after', '\ud800', '\udfff']) expectFailure(() => parse({ answers: { ...emptyAnswers(), hate } }), 400, 'invalid_answers');
    expect(parse({ answers: { ...emptyAnswers(), hate: 'Unicode: 😀 café 日本語\n\tworks' } }).answers.hate).toContain('😀');
  });
  test('custom stack tools are allowed, normalized, and capped at 32 entries', () => {
    const result = validateAnswers({ ...emptyAnswers(), stage: 'building', stackTools: ['  Bespoke   Tool  ', 'PostgreSQL'] });
    expect(result.stackTools).toEqual(['Bespoke Tool', 'PostgreSQL']);
    const stackTools = Array.from({ length: 32 }, (_, n) => `Custom ${n}`);
    expect(validateAnswers({ ...emptyAnswers(), stage: 'stable', stackTools }).stackTools).toHaveLength(32);
    expectFailure(() => validateAnswers({ ...emptyAnswers(), stackTools: [...stackTools, 'One more'] }), 400, 'invalid_answers');
  });
  test('tool names have 1–80 units and must remain nonempty after normalization', () => {
    expect(() => validateAnswers({ ...emptyAnswers(), stackTools: ['x'.repeat(80)] })).not.toThrow();
    for (const stackTools of [['x'.repeat(81)], [''], [' \n\t '], [null], [42], [{}], 'not-an-array', null, ['\0'], ['\ud800'], ['\udfff']]) expectFailure(() => validateAnswers({ ...emptyAnswers(), stackTools }), 400, 'invalid_answers');
  });
  test('tool duplicates are rejected after case and whitespace normalization', () => {
    for (const stackTools of [['PostgreSQL', 'PostgreSQL'], ['PostgreSQL', 'postgresql'], ['Bespoke Tool', '  bespoke   tool ']]) expectFailure(() => validateAnswers({ ...emptyAnswers(), stackTools }), 400, 'invalid_answers');
  });
  test('raw request ceiling is exactly 65536 UTF-8 bytes, including JSON whitespace', () => {
    const body = JSON.stringify(request({ answers: { ...emptyAnswers(), hate: '日本語'.repeat(500) } }));
    const padded = body + ' '.repeat(MAX_REQUEST_BYTES - Buffer.byteLength(body, 'utf8'));
    expect(Buffer.byteLength(padded, 'utf8')).toBe(MAX_REQUEST_BYTES);
    expect(parseMutation(padded).answers.hate).toBe('日本語'.repeat(500));
    expectFailure(() => parseMutation(padded + ' '), 413, 'too_large');
  });
  test('size ceiling uses encoded bytes, not JS string length', () => {
    const body = JSON.stringify(request());
    const oversize = body + ' '.repeat(MAX_REQUEST_BYTES - Buffer.byteLength(body, 'utf8') - 1) + 'é';
    expect(oversize.length).toBe(MAX_REQUEST_BYTES);
    expect(Buffer.byteLength(oversize, 'utf8')).toBe(MAX_REQUEST_BYTES + 1);
    expectFailure(() => parseMutation(oversize), 413, 'too_large');
  });
  test('oversized malformed JSON is rejected before parsing', () => {
    expectFailure(() => parseMutation('x'.repeat(MAX_REQUEST_BYTES + 1)), 413, 'too_large');
  });
  test('text is retained as text, not evaluated or silently HTML-decoded', () => {
    const hate = '<script>alert(1)</script> &amp; SQL \' OR 1=1 --';
    expect(parse({ answers: { ...emptyAnswers(), hate } }).answers.hate).toBe(hate);
  });
});

describe('server-side branch pruning and final projection', () => {
  const populated = (): Answers => ({ ...emptyAnswers(), context: 'startup', contextDetails: 'hidden context', stage: 'stable', stack: 'custom stack', stackTools: ['PostgreSQL'], burden: 'slows', problemCategory: 'other', problem: 'real pain', workingWell: 'hidden positive', workaround: 'tried', workaroundDetails: 'details', outcome: 'partly', timeSpent: '4-8', role: 'founder', owner: 'me', spend: '50-249', next: 'chat', email: 'person@example.com', hate: 'Nothing else' });
  test('non-other context drops context details; non-team context drops team details', () => {
    expect(validateAnswers(populated()).contextDetails).toBe('');
    const result = validateAnswers({ ...populated(), context: 'other', contextDetails: 'kept' });
    expect(result.contextDetails).toBe('kept');
    expect(result.role).toBe('');
    expect(result.owner).toBe('');
  });
  test('idea stage drops building-specific answers but retains anticipated problem text', () => {
    const result = validateAnswers({ ...populated(), stage: 'idea' });
    for (const field of ['stack', 'timeSpent', 'workingWell', 'problemCategory', 'workaround', 'workaroundDetails', 'outcome', 'spend'] as const) expect(result[field]).toBe('');
    expect(result.stackTools).toEqual([]);
    expect(result.problem).toBe('real pain');
  });
  test('no burden keeps working-well and discards all pain follow-ups', () => {
    const result = validateAnswers({ ...populated(), burden: 'none' });
    expect(result.workingWell).toBe('hidden positive');
    for (const field of ['problem', 'problemCategory', 'workaround', 'workaroundDetails', 'outcome', 'spend'] as const) expect(result[field]).toBe('');
  });
  test('unanswered burden clears problem details', () => {
    const result = validateAnswers({ ...populated(), burden: '' });
    expect(result.problem).toBe('');
    expect(result.problemCategory).toBe('');
    expect(result.workingWell).toBe('');
  });
  test('early burden retains anticipated text but clears experienced-pain fields', () => {
    const result = validateAnswers({ ...populated(), burden: 'early' });
    expect(result.problem).toBe('real pain');
    for (const field of ['problemCategory', 'workaround', 'workaroundDetails', 'outcome', 'spend', 'workingWell'] as const) expect(result[field]).toBe('');
  });
  test('experienced other-category preserves text; cost preserves spend instead', () => {
    expect(validateAnswers(populated()).problem).toBe('real pain');
    expect(validateAnswers(populated()).spend).toBe('');
    const cost = validateAnswers({ ...populated(), problemCategory: 'cost' });
    expect(cost.problem).toBe('');
    expect(cost.spend).toBe('50-249');
    const setup = validateAnswers({ ...populated(), problemCategory: 'setup' });
    expect(setup.problem).toBe('');
    expect(setup.spend).toBe('');
  });
  test('only a tried workaround keeps outcome and explanatory text', () => {
    expect(validateAnswers(populated()).outcome).toBe('partly');
    for (const workaround of ['', 'nothing', 'someone']) {
      const result = validateAnswers({ ...populated(), workaround });
      expect(result.workaroundDetails).toBe('');
      expect(result.outcome).toBe('');
    }
  });
  test('empty or no-follow-up preference removes email', () => {
    for (const next of ['', 'none']) expect(validateAnswers({ ...populated(), next }).email).toBe('');
    expect(validateAnswers(populated()).email).toBe('person@example.com');
  });
  test('validation creates a new canonical state without mutating caller input', () => {
    const source = populated();
    const before = structuredClone(source);
    const result = validateAnswers(source);
    expect(source).toEqual(before);
    expect(result).not.toBe(source);
    expect(result.stackTools).not.toBe(source.stackTools);
  });
  test('projection contains only applicable research fields and no owner/session metadata', () => {
    const answers = validateAnswers({ ...populated(), context: 'other', stage: 'idea', burden: 'early', next: 'none', hate: '  Free text  ' });
    const summary = projectedResponse(answers);
    expect(summary).toMatchObject({ schemaVersion: 4, context: 'other', stage: 'idea', problemEvidence: 'anticipated', problem: 'real pain', nextStep: 'none', anythingYouHate: 'Free text' });
    for (const key of ['email', 'stack', 'stackTools', 'role', 'infrastructureOwner', 'workaroundStatus', 'workaroundOutcome', 'monthlySpendUsd', 'token', 'token_hash', 'mutationId', 'expectedRevision']) expect(key in summary).toBe(false);
  });
});

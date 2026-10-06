// Isolated, network-free: bun test ./backend/validation.test.ts
// Imports validation/model only: no handler, database, AWS SDK, or credentials.
import { describe, test, expect } from 'bun:test';
import { ApiFailure, parseMutation, projectedResponse, validateAnswers } from './validation.ts';
import { choices, emptyAnswers, problemCategoryOptions, stackWhyOptions, stepsFor, type Answers } from '../../src/lib/research/form.ts';
import { MAX_REQUEST_BYTES, type SaveRequest } from '../../src/lib/research/persistence-contract.ts';

const mutationId = '462468e4-df28-4ad1-bcd3-34cd95e404aa';
function request(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 6, answers: emptyAnswers(), step: 'context', completed: false, expectedRevision: 0, mutationId, ...overrides };
}
function parse(overrides: Record<string, unknown> = {}): SaveRequest { return parseMutation(JSON.stringify(request(overrides))); }
function finalAnswers(overrides: Partial<Answers> = {}): Answers {
  return { ...emptyAnswers(), context: 'startup', stage: 'building', burden: 'time', role: 'founder', stackTools: ['AWS'], stackWhy: ['cost'], problemCategory: ['setup'], workaround: 'nothing', owner: 'me', email: 'person@example.com', ...overrides };
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
    const result = parse({ answers: finalAnswers({ email: 'person@' }), step: 'contact' });
    expect(result.answers.email).toBe('person@');
    expect(result.completed).toBe(false);
  });
  test('completion accepts required choices and skipped optional questions', () => {
    const result = parse({ answers: finalAnswers(), completed: true, step: 'hate', expectedRevision: 8 });
    expect(result.completed).toBe(true);
    expect(result.answers.problem).toBe('');
    expect(result.answers.outcome).toBe('');
  });
  for (const field of ['context', 'stage', 'burden', 'role', 'owner', 'problemCategory'] as const) {
    test(`completion requires ${field}`, () => {
      expectFailure(() => parse({ answers: finalAnswers({ [field]: field === 'problemCategory' ? [] : '' }), completed: true, step: 'hate' }), 400, 'incomplete');
    });
  }
  for (const [field, empty] of [['stackTools', []], ['stackWhy', []]] as const) {
    test(`completion requires a ${field} selection`, () => {
      expectFailure(() => parse({ answers: finalAnswers({ [field]: empty }), completed: true, step: 'hate' }), 400, 'incomplete');
    });
  }
  test('completion requires the workaround and its outcome once a fix was tried', () => {
    expectFailure(() => parse({ answers: finalAnswers({ workaround: '' }), completed: true, step: 'hate' }), 400, 'incomplete');
    expectFailure(() => parse({ answers: finalAnswers({ workaround: 'tried', outcome: '' }), completed: true, step: 'hate' }), 400, 'incomplete');
    expect(parse({ answers: finalAnswers({ workaround: 'tried', outcome: 'solved' }), completed: true, step: 'hate' }).completed).toBe(true);
  });
  test('completion requires the anticipated-issues answer instead of the experienced category', () => {
    expect(parse({ answers: { ...finalAnswers(), burden: 'early', anticipateIssues: 'unsure', problemCategory: [] }, completed: true, step: 'hate' }).completed).toBe(true);
    expectFailure(() => parse({ answers: { ...finalAnswers(), burden: 'early', anticipateIssues: '', problemCategory: [] }, completed: true, step: 'hate' }), 400, 'incomplete');
    expect(parse({ answers: { ...finalAnswers(), burden: 'none' }, completed: true, step: 'hate' }).completed).toBe(true);
  });
  test('cost complaints require the spend answer on completion', () => {
    expectFailure(() => parse({ answers: finalAnswers({ problemCategory: ['cost'], spend: '' }), completed: true, step: 'hate' }), 400, 'incomplete');
    expect(parse({ answers: finalAnswers({ problemCategory: ['cost'], spend: '50-249' }), completed: true, step: 'hate' }).completed).toBe(true);
  });
  test('completion always requires a valid email', () => {
    expect(parse({ answers: finalAnswers({ email: 'person+research@example.com' }), completed: true, step: 'hate' }).completed).toBe(true);
    for (const email of ['', '   ', 'person', 'person@', '@example.com', 'person@@example.com', 'per son@example.com', 'person@exa mple.com']) {
      expectFailure(() => parse({ answers: finalAnswers({ email }), completed: true, step: 'hate' }), 400, 'invalid_email');
    }
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
    for (const [key, value] of Object.entries({ owner: 'other', token_hash: 'forged', revision: 99, status: 'submitted', expiresAt: '2099-01-01', updatedAt: '2099-01-01', schema: 5 })) {
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
    for (const schemaVersion of [3, 4, 5, '6', null, false]) expectFailure(() => parse({ schemaVersion }), 400, 'invalid_request');
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
    for (const step of ['not-a-step', 'stack', 'workaround', 'outcome', 'startup', 'role', 'sideProject', 1, null]) expectFailure(() => parse({ step }), 400, 'invalid_step');
  });
  test('all applicable paths from a populated draft are accepted', () => {
    const answers = finalAnswers({ stage: 'stable', burden: 'slows', problemCategory: ['cost'], workaround: 'tried', email: 'in-progress@' });
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
  for (const field of ['contextDetails', 'stack', 'problem', 'workingWell', 'workaroundDetails', 'hate', 'sideProject', 'stackWhyOther'] as const) {
    test(`${field} has a 2000 UTF-16-unit bound and rejects wrong types`, () => {
      expect(() => validateAnswers({ ...emptyAnswers(), [field]: 'x'.repeat(2_000) })).not.toThrow();
      expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: 'x'.repeat(2_001) }), 400, 'invalid_answers');
      expect(() => validateAnswers({ ...emptyAnswers(), [field]: '😀'.repeat(1_000) })).not.toThrow();
      expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: '😀'.repeat(1_001) }), 400, 'invalid_answers');
      for (const value of [0, null, false, [], {}]) expectFailure(() => validateAnswers({ ...emptyAnswers(), [field]: value }), 400, 'invalid_answers');
    });
  }
  test('email has a 254-unit bound, also while incomplete', () => {
    expect(() => validateAnswers({ ...emptyAnswers(), email: 'e'.repeat(254) })).not.toThrow();
    expectFailure(() => validateAnswers({ ...emptyAnswers(), email: 'e'.repeat(255) }), 400, 'invalid_answers');
  });
  test('phone has a 40-unit bound and is always optional', () => {
    expect(() => validateAnswers({ ...emptyAnswers(), phone: '1'.repeat(40) })).not.toThrow();
    expectFailure(() => validateAnswers({ ...emptyAnswers(), phone: '1'.repeat(41) }), 400, 'invalid_answers');
    expect(validateAnswers({ ...emptyAnswers(), phone: '+1 555 000 0000' }).phone).toBe('+1 555 000 0000');
  });
  test('NUL and lone surrogates are rejected in every text field even if hidden', () => {
    for (const field of Object.keys(emptyAnswers()).filter(key => key !== 'stackTools' && key !== 'stackWhy')) {
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
  test('problem categories accept multiple distinct enum values and reject unknown ones', () => {
    expect(validateAnswers({ ...emptyAnswers(), stage: 'building', burden: 'slows', problemCategory: ['cost', ' setup '] }).problemCategory).toEqual(['cost', 'setup']);
    expect(validateAnswers({ ...emptyAnswers(), stage: 'building', burden: 'slows', problemCategory: ['cost', 'setup', 'testing', 'maintenance', 'other'] }).problemCategory).toHaveLength(5);
    for (const problemCategory of [['not-a-category'], ['cost', 'COST'], 'not-an-array', null, [null], [42]]) expectFailure(() => validateAnswers({ ...emptyAnswers(), stage: 'building', burden: 'slows', problemCategory }), 400, 'invalid_answers');
    expect(validateAnswers({ ...emptyAnswers(), problemCategory: ['cost'] }).problemCategory).toEqual([]);
  });
  test('stack reasons are limited to the declared enum, deduplicated, and capped', () => {
    expect(validateAnswers({ ...emptyAnswers(), stage: 'building', stackTools: ['AWS'], stackWhy: ['cost', ' ease '] }).stackWhy).toEqual(['cost', 'ease']);
    expect(validateAnswers({ ...emptyAnswers(), stage: 'building', stackTools: ['AWS'], stackWhy: stackWhyOptions.map(option => option.value) }).stackWhy).toHaveLength(stackWhyOptions.length);
    for (const stackWhy of [['not-a-reason'], ['cost', 'COST'], ['ai', 'AI'], 'not-an-array', null, [null], [42]]) expectFailure(() => validateAnswers({ ...emptyAnswers(), stage: 'building', stackTools: ['AWS'], stackWhy }), 400, 'invalid_answers');
    expect(validateAnswers({ ...emptyAnswers(), stackWhy: ['cost'] }).stackWhy).toEqual([]);
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
  const populated = (): Answers => ({ ...emptyAnswers(), context: 'startup', contextDetails: 'hidden context', sideProject: 'hidden notes', stage: 'stable', stack: 'hidden stack text', stackTools: ['PostgreSQL', 'Other'], stackWhy: ['cost', 'other'], stackWhyOther: 'hidden why', burden: 'slows', problemCategory: ['other'], problem: 'real pain', anticipateIssues: 'yes', workingWell: 'hidden positive', workaround: 'tried', workaroundDetails: 'details', outcome: 'partly', role: 'founder', owner: 'me', spend: '50-249', email: 'person@example.com', phone: '+1 555 000 0000', hate: 'Nothing else' });
  test('non-other context drops context details; non-team context drops team details', () => {
    expect(validateAnswers(populated()).contextDetails).toBe('');
    const result = validateAnswers({ ...populated(), context: 'other', contextDetails: 'kept' });
    expect(result.contextDetails).toBe('kept');
    expect(result.role).toBe('');
    expect(result.owner).toBe('');
  });
  test('side-project notes survive only for side-project and self-hosting contexts', () => {
    expect(validateAnswers(populated()).sideProject).toBe('');
    expect(validateAnswers({ ...populated(), context: 'side-project', sideProject: 'kept' }).sideProject).toBe('kept');
    expect(validateAnswers({ ...populated(), context: 'self-host', sideProject: 'kept' }).sideProject).toBe('kept');
  });
  test('the unlisted-tool text survives only while Other is selected', () => {
    expect(validateAnswers(populated()).stack).toBe('hidden stack text');
    expect(validateAnswers({ ...populated(), stackTools: ['PostgreSQL'] }).stack).toBe('');
  });
  test('idea stage drops building-specific answers but retains anticipated answers', () => {
    const result = validateAnswers({ ...populated(), stage: 'idea' });
    for (const field of ['stack', 'stackWhyOther', 'workingWell', 'workaround', 'workaroundDetails', 'outcome', 'spend'] as const) expect(result[field]).toBe('');
    expect(result.problemCategory).toEqual([]);
    expect(result.stackTools).toEqual([]);expect(result.stackWhy).toEqual([]);
    expect(result.anticipateIssues).toBe('yes');expect(result.problem).toBe('real pain');
  });
  test('no burden keeps working-well and discards all pain follow-ups', () => {
    const result = validateAnswers({ ...populated(), burden: 'none' });
    expect(result.workingWell).toBe('hidden positive');
    for (const field of ['problem', 'anticipateIssues', 'workaround', 'workaroundDetails', 'outcome', 'spend'] as const) expect(result[field]).toBe('');
    expect(result.problemCategory).toEqual([]);
  });
  test('unanswered burden clears problem details', () => {
    const result = validateAnswers({ ...populated(), burden: '' });
    expect(result.problem).toBe('');
    expect(result.problemCategory).toEqual([]);
    expect(result.workingWell).toBe('');
  });
  test('early burden keeps anticipated answers only when issues are expected', () => {
    expect(validateAnswers({ ...populated(), burden: 'early' }).problem).toBe('real pain');
    for (const field of ['workaround', 'workaroundDetails', 'outcome', 'spend', 'workingWell'] as const) expect(validateAnswers({ ...populated(), burden: 'early' })[field]).toBe('');
    expect(validateAnswers({ ...populated(), burden: 'early' }).problemCategory).toEqual([]);
    expect(validateAnswers({ ...populated(), burden: 'early', anticipateIssues: 'no' }).problem).toBe('');
    expect(validateAnswers({ ...populated(), burden: 'early', anticipateIssues: 'unsure' }).problem).toBe('');
  });
  test('experienced other-category preserves text; cost preserves spend instead', () => {
    expect(validateAnswers(populated()).problem).toBe('real pain');
    expect(validateAnswers(populated()).spend).toBe('');
    const cost = validateAnswers({ ...populated(), problemCategory: ['cost'] });
    expect(cost.problem).toBe('');
    expect(cost.spend).toBe('50-249');
    const setup = validateAnswers({ ...populated(), problemCategory: ['setup'] });
    expect(setup.problem).toBe('');
    expect(setup.spend).toBe('');
  });
  test('experienced pain drops the anticipated-issues answer', () => {
    expect(validateAnswers(populated()).anticipateIssues).toBe('');
  });
  test('only a tried workaround keeps outcome and explanatory text', () => {
    expect(validateAnswers(populated()).outcome).toBe('partly');
    for (const workaround of ['', 'nothing', 'someone']) {
      const result = validateAnswers({ ...populated(), workaround });
      expect(result.workaroundDetails).toBe('');
      expect(result.outcome).toBe('');
    }
  });
  test('contact details are retained without a follow-up preference gate', () => {
    expect(validateAnswers(populated()).email).toBe('person@example.com');
    expect(validateAnswers(populated()).phone).toBe('+1 555 000 0000');
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
    const answers = validateAnswers({ ...populated(), context: 'other', stage: 'idea', burden: 'early', hate: '  Free text  ' });
    const summary = projectedResponse(answers);
    expect(summary).toMatchObject({ schemaVersion: 6, context: 'other', stage: 'idea', problemEvidence: 'anticipated', anticipatedIssues: 'yes', anticipatedIssueDetails: 'real pain', email: 'person@example.com', anythingYouHate: 'Free text' });
    for (const key of ['stack', 'stackTools', 'stackWhy', 'role', 'infrastructureOwner', 'workaroundStatus', 'workaroundOutcome', 'monthlySpendUsd', 'nextStep', 'weeklyInfrastructureTime', 'token', 'token_hash', 'mutationId', 'expectedRevision']) expect(key in summary).toBe(false);
  });
});

import { sanitizeValue, passwordProblems, sanitizeMarkup } from '../middleware/security';
import { cleanHtml } from '../utils/html';
import { escapeRegex } from '../utils/escapeRegex';

describe('input sanitiser (SC-02)', () => {
  it('strips mongo operators and prototype pollution keys', () => {
    const out: any = sanitizeValue({ email: { $gt: '' }, 'a.b': 1, nested: { __proto__: { x: 1 }, ok: true }, list: [{ $where: 'x' }] });
    expect(out.email).toEqual({});
    expect(out['a.b']).toBeUndefined();
    expect(out.nested.ok).toBe(true);
    expect(out.list[0]).toEqual({});
  });
});

describe('password policy (SC-05)', () => {
  it('rejects weak passwords', () => {
    expect(passwordProblems('short').length).toBeGreaterThan(0);
    expect(passwordProblems('ChangeMe123!!!').length).toBeGreaterThan(0);
  });
  it('accepts a strong password', () => {
    expect(passwordProblems('Tr0ub4dor&Horse-Staple')).toEqual([]);
  });
});

describe('html sanitiser (SC-06)', () => {
  it('removes scripts, handlers and javascript: links', () => {
    const out = cleanHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">z</a><img src="x" onerror="y()">');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:/i);
    expect(out).toContain('Hi');
  });
});

describe('regex escaping (SC-04)', () => {
  it('escapes metacharacters', () => {
    expect(new RegExp(escapeRegex('(a+)+$')).test('(a+)+$')).toBe(true);
  });
});

describe('markup middleware', () => {
  it('cleans markup in bodies but leaves passwords and plain text alone', () => {
    const req: any = { path: '/tasks', body: { description: '<p>ok</p><script>x</script>', title: 'Plain & simple', password: '<b>Pw1!aaaaaaaa' } };
    sanitizeMarkup(req, {} as any, () => undefined);
    expect(req.body.description).toBe('<p>ok</p>');
    expect(req.body.title).toBe('Plain & simple');
    expect(req.body.password).toBe('<b>Pw1!aaaaaaaa');
  });
});

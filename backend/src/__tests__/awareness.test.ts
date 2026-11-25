import cron from 'node-cron';
import { QUESTION_LIBRARY, PHISH_TEMPLATES } from '../config/awarenessLibrary';
import { QUIZ_TOPICS } from '../models/Awareness';
import { CORE_ROLES } from '../config/roles';
import { RULES } from '../services/isms/automation';
import { REGISTER_MAP } from '../config/isms';
import { ALWAYS_ON, DEFAULT_ROLE_MODULES } from '../config/modules';
import { isInternal, POINTS } from '../services/awareness.service';

describe('awareness question library', () => {
  it('has unique keys, 2–5 options, a valid correct answer and an explanation', () => {
    expect(new Set(QUESTION_LIBRARY.map((q) => q.key)).size).toBe(QUESTION_LIBRARY.length);
    for (const q of QUESTION_LIBRARY) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options.length).toBeLessThanOrEqual(5);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(q.options.length);
      expect(q.explanation.length).toBeGreaterThan(10);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect((QUIZ_TOPICS as readonly string[]).includes(q.topic)).toBe(true);
    }
  });
  it('only targets real internal roles, and every internal role has enough questions', () => {
    for (const q of QUESTION_LIBRARY) for (const r of q.roles) expect((CORE_ROLES as readonly string[]).includes(r)).toBe(true);
    for (const role of CORE_ROLES) {
      const mine = QUESTION_LIBRARY.filter((q) => !q.roles.length || q.roles.includes(role));
      expect(mine.length).toBeGreaterThanOrEqual(20);
    }
  });
  it('role-specific questions exist for finance, hr, engineer, sales, project_manager and leadership', () => {
    for (const role of ['finance', 'hr', 'engineer', 'sales', 'project_manager', 'ceo']) expect(QUESTION_LIBRARY.some((q) => q.roles.includes(role))).toBe(true);
  });
  it('does not always put the right answer first (the app also shuffles per person)', () => {
    expect(new Set(QUESTION_LIBRARY.map((q) => q.correct)).size).toBeGreaterThan(1);
  });
  it('points rise with difficulty', () => { expect(POINTS.easy).toBeLessThan(POINTS.medium); expect(POINTS.medium).toBeLessThan(POINTS.hard); });
});

describe('phishing templates are safe and educational', () => {
  it('each has a link placeholder, red flags, a lesson, and no form or password field', () => {
    expect(new Set(PHISH_TEMPLATES.map((t) => t.key)).size).toBe(PHISH_TEMPLATES.length);
    for (const t of PHISH_TEMPLATES) {
      expect(t.html).toContain('{{link}}');
      expect(t.redFlags.length).toBeGreaterThanOrEqual(2);
      expect(t.lesson.length).toBeGreaterThan(20);
      expect(t.html.toLowerCase()).not.toMatch(/<form|<input|type="password"/);
    }
  });
  it('does not impersonate real brands', () => {
    const text = JSON.stringify(PHISH_TEMPLATES).toLowerCase();
    for (const brand of ['microsoft', 'google', 'dhl', 'fedex', 'paypal', 'gtbank', 'access bank', 'zenith', 'first bank', 'whatsapp', 'amazon']) expect(text).not.toContain(brand);
  });
});

describe('wiring', () => {
  it('registers the three new rules with valid cron expressions', () => {
    for (const k of ['risk_suggest', 'awareness_digest', 'phish_close']) { const r = RULES.find((x) => x.key === k); expect(r).toBeTruthy(); expect(cron.validate(r!.cron)).toBe(true); }
    expect(new Set(RULES.map((r) => r.key)).size).toBe(RULES.length);
  });
  it('offers the awareness measures as metric sources', () => {
    const src = REGISTER_MAP.metric.cols.find((c) => c.key === 'autoSource')!.options!;
    for (const s of ['phish_resilience', 'phish_report_rate', 'awareness_quiz_accuracy', 'awareness_participation']) expect(src).toContain(s);
  });
  it('gives every internal role the awareness module, and keeps portal users out', () => {
    expect(ALWAYS_ON).toContain('awareness');
    for (const role of CORE_ROLES) expect(DEFAULT_ROLE_MODULES[role]).toContain('awareness');
    expect(isInternal('employee')).toBe(true);
    expect(isInternal('client')).toBe(false);
    expect(isInternal('training_customer')).toBe(false);
  });
});

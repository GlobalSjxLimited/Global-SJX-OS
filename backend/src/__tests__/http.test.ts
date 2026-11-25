import request from 'supertest';
import { createApp } from '../app';

// These exercise the HTTP layer only (no database needed): headers, auth gates, validation and fail-closed behaviour.
const app = createApp();

describe('HTTP security surface', () => {
  it('sends hardened headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('never caches API responses', async () => {
    const res = await request(app).get('/api/security/summary');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('requires authentication on the security register and tickets', async () => {
    expect((await request(app).get('/api/security/controls')).status).toBe(401);
    expect((await request(app).get('/api/tickets')).status).toBe(401);
    expect((await request(app).patch('/api/tickets/abc').send({ status: 'closed' })).status).toBe(401);
  });

  it('keeps public contact/consent endpoints strict about input', async () => {
    expect((await request(app).post('/api/tickets/public/contact').send({ name: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/consent').send({ subjectId: '!!' })).status).toBe(400);
  });

  it('disables self-registration by default', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Eve', email: 'eve@example.com', password: 'Str0ng&LongPassword', role: 'super_admin' });
    expect(res.status).toBe(403);
  });

  it('only serves public knowledge JSON, not authenticated routes, without a token', async () => {
    expect((await request(app).get('/api/knowledge')).status).toBe(401);
  });

  it('rejects unknown origins via CORS', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server.js';

describe('HTTP API & Authentication & Permissions', () => {
  let app: any;

  beforeEach(() => {
    const serverInstance = createApp(':memory:');
    app = serverInstance.app;
  });

  it('should authenticate demo accounts and return session and csrf token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.csrfToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('should reject invalid login credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid username or password');
  });

  it('should block unauthenticated access to protected API endpoints', async () => {
    const res = await request(app).get('/api/data/overview');
    expect(res.status).toBe(401);
  });

  it('should enforce CSRF token on state-changing requests', async () => {
    // 1. Login as staff
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'staff', password: 'staff123' });

    const cookie = loginRes.headers['set-cookie'];

    // 2. Attempt agent chat without CSRF header
    const noCsrfRes = await request(app)
      .post('/api/agent/chat')
      .set('Cookie', cookie)
      .send({ message: 'Which clients have overdue invoices?' });

    expect(noCsrfRes.status).toBe(403);
    expect(noCsrfRes.body.error).toContain('CSRF');

    // 3. Send with valid CSRF header
    const validRes = await request(app)
      .post('/api/agent/chat')
      .set('Cookie', cookie)
      .set('x-csrf-token', loginRes.body.csrfToken)
      .send({ message: 'Which clients have overdue invoices?' });

    expect(validRes.status).toBe(200);
    expect(validRes.body.response).toBeDefined();
  });

  it('should only permit admin to reset database', async () => {
    // 1. Staff login
    const staffLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'staff', password: 'staff123' });

    const staffReset = await request(app)
      .post('/api/system/reset-db')
      .set('Cookie', staffLogin.headers['set-cookie'])
      .set('x-csrf-token', staffLogin.body.csrfToken);

    expect(staffReset.status).toBe(403);

    // 2. Admin login
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    const adminReset = await request(app)
      .post('/api/system/reset-db')
      .set('Cookie', adminLogin.headers['set-cookie'])
      .set('x-csrf-token', adminLogin.body.csrfToken);

    expect(adminReset.status).toBe(200);
    expect(adminReset.body.success).toBe(true);
  });
});

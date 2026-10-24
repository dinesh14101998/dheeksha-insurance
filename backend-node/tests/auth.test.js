import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { setPool, closePool } from '../src/config/database.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { createAccessToken } from '../src/utils/jwt.js';
import { validateConfig, resetConfig, getConfig } from '../src/config/env.js';
import { seedInitialAdmin } from '../src/services/auth.service.js';

describe('Admin Authentication Endpoints & Flow (Mocked Database)', () => {
  let server;
  let baseUrl;
  let testAdmin;
  let capturedQueries = [];

  const adminEmail = 'testadmin@dheekshainsurance.com';
  const plainPassword = 'SuperSecretAdminPassword123!';
  const testSecretKey = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%';

  before(async () => {
    process.env.SECRET_KEY = testSecretKey;
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8000';
    process.env.ACCESS_TOKEN_EXPIRE_MINUTES = '120';
    resetConfig();
    getConfig();

    const hashedPassword = await hashPassword(plainPassword);
    testAdmin = {
      id: 'mock-admin-uuid-1234',
      email: adminEmail,
      hashed_password: hashedPassword,
      created_at: new Date(),
    };

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await closePool();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    capturedQueries = [];

    // Mock connection pool implementing parameterized query execution
    const mockPool = {
      async execute(sql, params) {
        capturedQueries.push({ sql, params });
        if (sql.includes('FROM admins WHERE email = ?')) {
          const queryEmail = params[0];
          if (queryEmail === testAdmin.email) {
            return [[testAdmin]];
          }
          return [[]];
        }
        return [[]];
      },
      async query(sql) {
        if (sql.includes('SELECT 1')) {
          return [[{ health_check: 1 }]];
        }
        return [[]];
      },
      async end() {},
    };

    setPool(mockPool);
  });

  test('POST /api/v1/auth/login succeeds with valid credentials (form-urlencoded)', async () => {
    const formData = new URLSearchParams();
    formData.append('username', adminEmail);
    formData.append('password', plainPassword);

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.access_token === 'string');
    assert.equal(body.token_type, 'bearer');

    // Verify response does NOT leak hashed_password or any admin fields
    assert.equal(body.hashed_password, undefined);
    assert.equal(body.password, undefined);

    // Verify parameterized SQL query was used
    assert.ok(capturedQueries.length > 0);
    const query = capturedQueries[0];
    assert.ok(query.sql.includes('WHERE email = ?'));
    assert.equal(query.params[0], adminEmail);
  });

  test('POST /api/v1/auth/login returns 400 for incorrect password', async () => {
    const formData = new URLSearchParams();
    formData.append('username', adminEmail);
    formData.append('password', 'WrongPassword999!');

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.detail, 'Incorrect email or password');
  });

  test('POST /api/v1/auth/login returns 400 for non-existent admin email', async () => {
    const formData = new URLSearchParams();
    formData.append('username', 'nonexistent@example.com');
    formData.append('password', 'AnyPassword123!');

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.detail, 'Incorrect email or password');
  });

  test('POST /api/v1/auth/login returns 422 for missing credentials', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(Array.isArray(body.detail));
    assert.ok(body.detail.length >= 2);
  });

  test('GET /api/v1/auth/me returns 200 with email for valid Bearer token', async () => {
    const token = createAccessToken(adminEmail, { secretKey: testSecretKey });

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, adminEmail);
    assert.equal(body.hashed_password, undefined);
  });

  test('GET /api/v1/auth/me returns 401 with WWW-Authenticate header when token is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`);

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    const body = await res.json();
    assert.equal(body.detail, 'Could not validate credentials');
  });

  test('GET /api/v1/auth/me returns 401 when token is invalid or expired', async () => {
    const expiredToken = createAccessToken(adminEmail, {
      expiresInMinutes: -5,
      secretKey: testSecretKey,
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    const body = await res.json();
    assert.equal(body.detail, 'Could not validate credentials');
  });

  test('Login rate limiting throttles after 5 requests from same client IP', async () => {
    // Send 5 rapid login attempts
    const formData = new URLSearchParams();
    formData.append('username', adminEmail);
    formData.append('password', 'WrongPassword!');

    // First 5 requests should reach authentication (returns 400)
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });
      assert.ok(res.status === 400 || res.status === 429);
    }

    // 6th request must trigger rate limit 429
    const rateLimitedRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    assert.equal(rateLimitedRes.status, 429);
    const body = await rateLimitedRes.json();
    assert.ok(body.error.includes('Rate limit exceeded'));
  });
});

describe('seedInitialAdmin Service Unit Tests (Mocked DB)', () => {
  let originalLog;
  let originalError;
  let capturedLogs = [];
  let capturedErrors = [];

  before(() => {
    originalLog = console.log;
    originalError = console.error;
  });

  after(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  beforeEach(() => {
    capturedLogs = [];
    capturedErrors = [];
    console.log = (...args) => capturedLogs.push(args.join(' '));
    console.error = (...args) => capturedErrors.push(args.join(' '));
  });

  test('Missing both admin credentials follows documented safe behavior (unconfigured)', async () => {
    const result = await seedInitialAdmin({ ADMIN_EMAIL: null, ADMIN_PASSWORD: null });
    assert.deepEqual(result, { seeded: false, reason: 'unconfigured' });
    assert.ok(capturedLogs.some((l) => l.includes('auto-seeding skipped: ADMIN_EMAIL and ADMIN_PASSWORD not configured')));
  });

  test('Only one credential provided causes clear error without revealing secret values', async () => {
    const secretPass = 'ConfidentialAdminPass123!';
    await assert.rejects(
      async () => seedInitialAdmin({ ADMIN_EMAIL: null, ADMIN_PASSWORD: secretPass }),
      (err) => {
        assert.match(err.message, /Incomplete administrator credentials/);
        assert.doesNotMatch(err.message, new RegExp(secretPass));
        return true;
      }
    );

    const secretEmail = 'operator@insurance.local';
    await assert.rejects(
      async () => seedInitialAdmin({ ADMIN_EMAIL: secretEmail, ADMIN_PASSWORD: null }),
      (err) => {
        assert.match(err.message, /Incomplete administrator credentials/);
        assert.doesNotMatch(err.message, new RegExp(secretEmail));
        return true;
      }
    );
  });

  test('Configured administrator is created when absent with UUID and bcrypt hash', async () => {
    const capturedDbCalls = [];
    const mockPool = {
      async execute(sql, params) {
        capturedDbCalls.push({ sql, params });
        if (sql.includes('FROM admins WHERE email = ?')) {
          return [[]]; // Absent
        }
        if (sql.includes('INSERT INTO admins')) {
          return [{ affectedRows: 1 }];
        }
        return [[]];
      },
    };
    setPool(mockPool);

    const newEmail = 'freshadmin@dheekshainsurance.com';
    const plainPass = 'BrandNewSecurePass123!';

    const result = await seedInitialAdmin({ ADMIN_EMAIL: newEmail, ADMIN_PASSWORD: plainPass });

    assert.equal(result.seeded, true);
    assert.equal(result.reason, 'created');
    assert.equal(result.email, newEmail);
    assert.ok(typeof result.id === 'string' && result.id.length >= 32);

    // Verify parameterized SQL was executed
    const insertCall = capturedDbCalls.find((c) => c.sql.includes('INSERT INTO admins'));
    assert.ok(insertCall, 'Expected INSERT INTO admins call');
    assert.equal(insertCall.params[0], result.id);
    assert.equal(insertCall.params[1], newEmail);

    // Verify password is NOT stored in plaintext and is a valid bcrypt hash
    const storedHash = insertCall.params[2];
    assert.notEqual(storedHash, plainPass);
    assert.ok(storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$'));
    const isMatch = await verifyPassword(plainPass, storedHash);
    assert.equal(isMatch, true);

    // Verify credentials and hashes never appear in logs
    for (const log of [...capturedLogs, ...capturedErrors]) {
      assert.doesNotMatch(log, new RegExp(plainPass));
      assert.doesNotMatch(log, new RegExp(storedHash.replace(/\$/g, '\\$')));
    }
  });

  test('Existing administrator is not duplicated and password is never overwritten', async () => {
    const existingId = 'existing-admin-uuid-9999';
    const existingEmail = 'existingadmin@dheekshainsurance.com';
    const originalHash = await hashPassword('OriginalPassword123!');

    const capturedDbCalls = [];
    const mockPool = {
      async execute(sql, params) {
        capturedDbCalls.push({ sql, params });
        if (sql.includes('FROM admins WHERE email = ?')) {
          return [[{ id: existingId, email: existingEmail, hashed_password: originalHash, created_at: new Date() }]];
        }
        return [[]];
      },
    };
    setPool(mockPool);

    // Attempt seeding with a different password
    const result = await seedInitialAdmin({
      ADMIN_EMAIL: existingEmail,
      ADMIN_PASSWORD: 'AttemptedNewPassword456!',
    });

    assert.equal(result.seeded, false);
    assert.equal(result.reason, 'already_exists');
    assert.equal(result.id, existingId);
    assert.equal(result.email, existingEmail);

    // Verify NO INSERT and NO UPDATE queries were executed
    const writeCalls = capturedDbCalls.filter(
      (c) => c.sql.includes('INSERT') || c.sql.includes('UPDATE') || c.sql.includes('DELETE')
    );
    assert.equal(writeCalls.length, 0);

    // Verify existing password was NOT overwritten
    const stillOriginal = await verifyPassword('OriginalPassword123!', originalHash);
    assert.equal(stillOriginal, true);
    const notChanged = await verifyPassword('AttemptedNewPassword456!', originalHash);
    assert.equal(notChanged, false);
  });

  test('Duplicate-email race condition (ER_DUP_ENTRY / 1062) is handled safely', async () => {
    const raceEmail = 'raceadmin@dheekshainsurance.com';
    const raceId = 'race-admin-uuid-5555';
    let queryCount = 0;

    const mockPool = {
      async execute(sql, params) {
        if (sql.includes('FROM admins WHERE email = ?')) {
          queryCount++;
          if (queryCount === 1) {
            return [[]]; // Absent on initial check
          }
          return [[{ id: raceId, email: raceEmail, hashed_password: '$2b$12$dummyhash', created_at: new Date() }]];
        }
        if (sql.includes('INSERT INTO admins')) {
          const err = new Error('Duplicate entry for key email');
          err.code = 'ER_DUP_ENTRY';
          err.errno = 1062;
          throw err;
        }
        return [[]];
      },
    };
    setPool(mockPool);

    const result = await seedInitialAdmin({
      ADMIN_EMAIL: raceEmail,
      ADMIN_PASSWORD: 'RacePassword123!',
    });

    assert.equal(result.seeded, false);
    assert.equal(result.reason, 'already_exists');
    assert.equal(result.id, raceId);
    assert.ok(capturedLogs.some((l) => l.includes('concurrent initialization handled')));
  });

  test('Database errors fail safely without leaking secrets in logs', async () => {
    const mockPool = {
      async execute() {
        const err = new Error('Database server disconnected unexpectedly');
        err.code = 'ECONNRESET';
        throw err;
      },
    };
    setPool(mockPool);

    const secretPassword = 'MySecretPassword123!';
    await assert.rejects(
      async () => seedInitialAdmin({ ADMIN_EMAIL: 'dbfail@example.com', ADMIN_PASSWORD: secretPassword }),
      (err) => {
        assert.equal(err.code, 'ECONNRESET');
        return true;
      }
    );

    // Verify secret password was not printed to console
    for (const log of [...capturedLogs, ...capturedErrors]) {
      assert.doesNotMatch(log, new RegExp(secretPassword));
    }
  });
});

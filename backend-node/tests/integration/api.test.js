import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import app from '../../src/app.js';
import { initPool, closePool, query } from '../../src/config/database.js';
import { assertSafeIntegrationEnvironment } from '../../src/config/databaseGuard.js';
import { createAccessToken } from '../../src/utils/jwt.js';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';
import { resetEnquiryRateLimit, resetLoginRateLimit } from '../../src/middlewares/rateLimiter.middleware.js';
import { installEmailSuppression, isEmailSuppressionActive } from '../helpers/emailSuppression.js';
import { createTestEntityTracker } from '../helpers/testTracker.js';
import { waitForPendingNotifications, setTransporter } from '../../src/services/email.service.js';
import { seedInitialAdmin } from '../../src/services/auth.service.js';
import { initializeDatabase } from '../../src/scripts/initDb.js';

describe('Real MariaDB HTTP API Integration Tests', () => {
  let server;
  let baseUrl;
  let emailSuppression;
  let adminTracker;
  let enquiryTracker;
  let testAdmin;
  let adminToken;
  let skipAll = false;

  const isOptedIn =
    process.env.RUN_DB_INTEGRATION_TESTS === 'true' || process.env.RUN_DB_INTEGRATION_TESTS === '1';

  before(async () => {
    if (!isOptedIn) {
      skipAll = true;
      return;
    }

    // 1. Install email suppression first
    emailSuppression = installEmailSuppression();

    // 2. Assert fail-closed integration environment guards
    assertSafeIntegrationEnvironment(process.env, {
      isEmailSuppressed: isEmailSuppressionActive(),
    });

    // 3. Initialize real connection pool to isolated test database
    initPool(process.env.TEST_DATABASE_URL);

    // 4. Initialize entity trackers
    adminTracker = createTestEntityTracker();
    enquiryTracker = createTestEntityTracker();

    // 5. Start real HTTP test server on an ephemeral port on 127.0.0.1
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 6. Provision an isolated, tracked test administrator
    const adminId = crypto.randomUUID();
    const adminEmail = `test_admin_${Date.now()}@dheekshatest.local`;
    const adminPassword = 'IntegrationTestPass123!';
    const hashedPassword = await hashPassword(adminPassword);

    await query(
      'INSERT INTO admins (id, email, hashed_password, created_at) VALUES (?, ?, ?, NOW());',
      [adminId, adminEmail, hashedPassword]
    );

    adminTracker.trackAdmin(adminId);

    testAdmin = {
      id: adminId,
      email: adminEmail,
      password: adminPassword,
    };

    adminToken = createAccessToken(adminEmail);
  });

  after(async () => {
    if (skipAll) return;

    // 1. Scoped cleanup of tracked enquiries
    if (enquiryTracker) {
      const enquiryCleanup = enquiryTracker.buildEnquiryCleanupQuery();
      if (enquiryCleanup) {
        try {
          await query(enquiryCleanup.sql, enquiryCleanup.params);
        } catch {
          // ignore cleanup error
        }
      }
      enquiryTracker.clear();
    }

    // 2. Scoped cleanup of tracked test administrator
    if (adminTracker) {
      const adminCleanup = adminTracker.buildAdminCleanupQuery();
      if (adminCleanup) {
        try {
          await query(adminCleanup.sql, adminCleanup.params);
        } catch {
          // ignore cleanup error
        }
      }
      adminTracker.clear();
    }

    // 3. Close HTTP server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }

    // 4. Close database pool
    await closePool();

    // 5. Restore email suppression
    if (emailSuppression) {
      emailSuppression.restore();
    }
  });

  beforeEach(() => {
    if (skipAll) return;
    resetEnquiryRateLimit('127.0.0.1');
    resetLoginRateLimit('127.0.0.1');
  });

  afterEach(async () => {
    if (skipAll) return;

    // Scoped cleanup of any enquiries created in the preceding test
    if (enquiryTracker) {
      const enquiryCleanup = enquiryTracker.buildEnquiryCleanupQuery();
      if (enquiryCleanup) {
        try {
          await query(enquiryCleanup.sql, enquiryCleanup.params);
        } catch {
          // ignore cleanup error
        }
      }
      enquiryTracker.clear();
    }
    resetEnquiryRateLimit('127.0.0.1');
    resetLoginRateLimit('127.0.0.1');
  });

  // =========================================================================
  // A. HEALTH AND ROUTING
  // =========================================================================

  test('A1: GET /api/health returns 200 and confirms database connectivity', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.equal(body.message, 'Dheeksha Insurance API (Node.js) is running.');
    assert.equal(body.database, 'connected');
    assert.equal(body.version, '1.0.0');
  });

  test('A2: GET /api/v1/unknown-route returns 404 with standard detail message', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/nonexistent-route-for-testing`);
    assert.equal(res.status, 404);

    const body = await res.json();
    assert.equal(body.detail, 'Not Found');
  });

  test('A3: Centralized error handler does not expose stack trace in production mode', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      // Send malformed URL-encoded body or hit an unhandled path to test error handler
      const res = await fetch(`${baseUrl}/api/v1/nonexistent-route`);
      const body = await res.json();
      assert.equal(body.stack, undefined, 'Stack trace must not be present in production responses');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  // =========================================================================
  // B. AUTHENTICATION
  // =========================================================================

  test('B1: POST /api/v1/auth/login with valid form-urlencoded credentials returns access token', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const params = new URLSearchParams({
      username: testAdmin.email,
      password: testAdmin.password,
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.access_token === 'string' && body.access_token.length > 20);
    assert.equal(body.token_type, 'bearer');
  });

  test('B2: POST /api/v1/auth/login with valid JSON credentials returns access token', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testAdmin.email,
        password: testAdmin.password,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.access_token === 'string');
    assert.equal(body.token_type, 'bearer');
  });

  test('B3: POST /api/v1/auth/login rejects incorrect password with HTTP 400', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testAdmin.email,
        password: 'CompletelyWrongPassword123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.detail, 'Incorrect email or password');
  });

  test('B4: POST /api/v1/auth/login rejects unknown admin accounts with HTTP 400', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'nonexistent_admin_12345@dheekshatest.local',
        password: 'AnyPassword123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.detail, 'Incorrect email or password');
  });

  test('B5: POST /api/v1/auth/login with missing fields returns HTTP 422', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testAdmin.email,
        // password omitted
      }),
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(Array.isArray(body.detail));
    assert.ok(body.detail.some((d) => d.loc.includes('password')));
  });

  test('B6: GET /api/v1/auth/me returns admin profile when presented with valid Bearer token', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, testAdmin.email);
  });

  test('B7: Protected endpoint rejects request without Authorization header with HTTP 401', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
    });

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    const body = await res.json();
    assert.equal(body.detail, 'Could not validate credentials');
  });

  test('B8: Protected endpoint rejects malformed or invalid token with HTTP 401', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: 'Bearer this.is.an.invalid.token' },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.detail, 'Could not validate credentials');
  });

  // =========================================================================
  // C. PUBLIC ENQUIRY CREATION & REAL DATABASE PERSISTENCE
  // =========================================================================

  test('C1: POST /api/v1/enquiries creates and persists enquiry with status NEW in MariaDB', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const payload = {
      full_name: 'Annamalai Chettiar',
      mobile_number: '9840112233',
      whatsapp_number: '9840112233',
      vehicle_type: 'private-car',
      vehicle_registration_number: 'TN 01 AB 4321',
      requirement: 'renewal',
      message: 'Need policy renewal quote before end of month.',
    };

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();

    // Verify response structure
    assert.ok(typeof body.id === 'string' && body.id.length === 36);
    enquiryTracker.trackEnquiry(body.id);

    assert.equal(body.full_name, payload.full_name);
    assert.equal(body.mobile_number, payload.mobile_number);
    assert.equal(body.whatsapp_number, payload.whatsapp_number);
    assert.equal(body.vehicle_type, payload.vehicle_type);
    assert.equal(body.vehicle_registration_number, payload.vehicle_registration_number);
    assert.equal(body.requirement, payload.requirement);
    assert.equal(body.message, payload.message);
    assert.equal(body.status, 'NEW');
    assert.deepEqual(body.notes, []);
    assert.ok(new Date(body.created_at).getTime() > 0);
    assert.ok(new Date(body.updated_at).getTime() > 0);

    // Verify REAL database persistence by querying MariaDB directly
    const rows = await query('SELECT * FROM enquiries WHERE id = ?;', [body.id]);
    assert.equal(rows.length, 1);
    const dbRow = rows[0];
    assert.equal(dbRow.id, body.id);
    assert.equal(dbRow.full_name, payload.full_name);
    assert.equal(dbRow.mobile_number, payload.mobile_number);
    assert.equal(dbRow.whatsapp_number, payload.whatsapp_number);
    assert.equal(dbRow.vehicle_type, payload.vehicle_type);
    assert.equal(dbRow.vehicle_registration_number, payload.vehicle_registration_number);
    assert.equal(dbRow.requirement, payload.requirement);
    assert.equal(dbRow.message, payload.message);
    assert.equal(dbRow.status, 'NEW');
  });

  test('C2: POST /api/v1/enquiries correctly handles omitted optional fields', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const payload = {
      full_name: 'Priya Rajendran',
      mobile_number: '9123456789',
      vehicle_type: 'two-wheeler',
      requirement: 'new-insurance',
      // whatsapp_number, vehicle_registration_number, message omitted
    };

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    enquiryTracker.trackEnquiry(body.id);

    assert.equal(body.whatsapp_number, null);
    assert.equal(body.vehicle_registration_number, null);
    assert.equal(body.message, null);

    // Verify MariaDB stores NULLs
    const rows = await query('SELECT whatsapp_number, vehicle_registration_number, message FROM enquiries WHERE id = ?;', [body.id]);
    assert.equal(rows[0].whatsapp_number, null);
    assert.equal(rows[0].vehicle_registration_number, null);
    assert.equal(rows[0].message, null);
  });

  test('C3: POST /api/v1/enquiries persists Tamil Unicode customer name and message without corruption', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const payload = {
      full_name: 'முத்துக்குமார் சுப்பிரமணியன்',
      mobile_number: '9841234567',
      vehicle_type: 'commercial',
      requirement: 'new-insurance',
      message: 'வணக்கம், புதிய வணிக வாகனத்திற்கான முழு காப்பீடு தேவைப்படுகிறது.',
    };

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    enquiryTracker.trackEnquiry(body.id);

    assert.equal(body.full_name, payload.full_name);
    assert.equal(body.message, payload.message);

    // Verify stored text in MariaDB matches Unicode string identically
    const rows = await query('SELECT full_name, message FROM enquiries WHERE id = ?;', [body.id]);
    assert.equal(rows[0].full_name, payload.full_name);
    assert.equal(rows[0].message, payload.message);
  });

  test('C4: POST /api/v1/enquiries rejects invalid payloads with HTTP 422', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const invalidCases = [
      {
        name: 'Missing full_name',
        data: { mobile_number: '9876543210', vehicle_type: 'two-wheeler', requirement: 'claim' },
      },
      {
        name: 'Invalid mobile_number (less than 10 digits)',
        data: { full_name: 'Test', mobile_number: '12345', vehicle_type: 'two-wheeler', requirement: 'claim' },
      },
      {
        name: 'Invalid vehicle_type (unknown enum)',
        data: { full_name: 'Test', mobile_number: '9876543210', vehicle_type: 'submarine', requirement: 'claim' },
      },
      {
        name: 'Invalid requirement (unknown enum)',
        data: { full_name: 'Test', mobile_number: '9876543210', vehicle_type: 'two-wheeler', requirement: 'warp-drive' },
      },
      {
        name: 'full_name too short',
        data: { full_name: 'A', mobile_number: '9876543210', vehicle_type: 'two-wheeler', requirement: 'claim' },
      },
    ];

    for (const c of invalidCases) {
      const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.data),
      });

      assert.equal(res.status, 422, `Expected 422 for case: ${c.name}`);
      const body = await res.json();
      assert.ok(Array.isArray(body.detail));
    }
  });

  test('C5: Public enquiry creation rate limit enforces max 5 requests per minute', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    resetEnquiryRateLimit('127.0.0.1');

    const validPayload = {
      full_name: 'Rate Limit Test User',
      mobile_number: '9876543210',
      vehicle_type: 'two-wheeler',
      requirement: 'policy',
    };

    // First 5 requests must succeed
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validPayload),
      });
      assert.equal(res.status, 201, `Request ${i + 1} should succeed`);
      const body = await res.json();
      enquiryTracker.trackEnquiry(body.id);
    }

    // 6th request within the 1-minute window must return 429
    const limitedRes = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    assert.equal(limitedRes.status, 429);
    const limitedBody = await limitedRes.json();
    assert.ok(limitedBody.error.includes('Rate limit exceeded'));

    // Reset rate limit key so subsequent tests proceed normally
    resetEnquiryRateLimit('127.0.0.1');
  });

  // =========================================================================
  // D. PROTECTED ENQUIRY LISTING, RETRIEVAL, SEARCH & PAGINATION
  // =========================================================================

  test('D1: GET /api/v1/enquiries lists enquiries with status filtering, search, and pagination', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const id3 = crypto.randomUUID();

    enquiryTracker.trackEnquiry(id1);
    enquiryTracker.trackEnquiry(id2);
    enquiryTracker.trackEnquiry(id3);

    const now = Date.now();
    const t1 = new Date(now - 30000);
    const t2 = new Date(now - 20000);
    const t3 = new Date(now - 10000);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [id1, 'Alpha Customer', '9111111111', 'two-wheeler', 'new-insurance', 'NEW', t1, t1]
    );

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [id2, 'Beta Customer', '9222222222', 'private-car', 'renewal', 'CONTACTED', t2, t2]
    );

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [id3, 'Gamma Customer', '9333333333', 'commercial', 'claim', 'NEW', t3, t3]
    );

    // 1. List enquiries matching test customer prefix
    const listRes = await fetch(`${baseUrl}/api/v1/enquiries?search=Customer`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody));
    assert.equal(listBody.length, 3);

    // 2. Filter by status=CONTACTED
    const filteredRes = await fetch(`${baseUrl}/api/v1/enquiries?status=CONTACTED`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(filteredRes.status, 200);
    const filteredBody = await filteredRes.json();
    assert.equal(filteredBody.length, 1);
    assert.equal(filteredBody[0].id, id2);
    assert.equal(filteredBody[0].status, 'CONTACTED');

    // 3. Search by name keyword
    const searchRes = await fetch(`${baseUrl}/api/v1/enquiries?search=Beta`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.equal(searchBody.length, 1);
    assert.equal(searchBody[0].id, id2);

    // 4. Sorting: oldest first for test customer enquiries
    const oldestRes = await fetch(`${baseUrl}/api/v1/enquiries?search=Customer&sort_by=oldest`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(oldestRes.status, 200);
    const oldestBody = await oldestRes.json();
    assert.equal(oldestBody[0].id, id1);
    assert.equal(oldestBody[2].id, id3);

    // 5. Sorting: newest first for test customer enquiries
    const newestRes = await fetch(`${baseUrl}/api/v1/enquiries?search=Customer&sort_by=newest`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(newestRes.status, 200);
    const newestBody = await newestRes.json();
    assert.equal(newestBody[0].id, id3);
    assert.equal(newestBody[2].id, id1);

    // 6. Pagination: limit=2, skip=1
    const pagedRes = await fetch(`${baseUrl}/api/v1/enquiries?search=Customer&sort_by=oldest&limit=2&skip=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(pagedRes.status, 200);
    const pagedBody = await pagedRes.json();
    assert.equal(pagedBody.length, 2);
    assert.equal(pagedBody[0].id, id2);
    assert.equal(pagedBody[1].id, id3);
  });

  test('D2: GET /api/v1/enquiries/:id retrieves a single enquiry with notes', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const id = crypto.randomUUID();
    enquiryTracker.trackEnquiry(id);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [id, 'Specific Customer', '9444444444', 'heavy', 'other', 'NEW']
    );

    const res = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.equal(body.full_name, 'Specific Customer');
    assert.deepEqual(body.notes, []);
  });

  test('D3: GET /api/v1/enquiries/:id returns 404 for nonexistent UUID', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const nonExistentId = crypto.randomUUID();
    const res = await fetch(`${baseUrl}/api/v1/enquiries/${nonExistentId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.detail, 'Enquiry not found');
  });

  // =========================================================================
  // E. STATUS UPDATES AND NOTES
  // =========================================================================

  test('E1: PATCH /api/v1/enquiries/:id updates status and appends notes in MariaDB', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const id = crypto.randomUUID();
    enquiryTracker.trackEnquiry(id);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [id, 'Update Target Customer', '9555555555', 'two-wheeler', 'policy', 'NEW']
    );

    // 1. Update status to CONTACTED
    const statusRes = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'CONTACTED' }),
    });

    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.status, 'CONTACTED');

    // Verify in MariaDB
    const rowsStatus = await query('SELECT status FROM enquiries WHERE id = ?;', [id]);
    assert.equal(rowsStatus[0].status, 'CONTACTED');

    // 2. Append note to enquiry
    const noteRes = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ new_note: 'Spoke with customer; policy document sent via WhatsApp.' }),
    });

    assert.equal(noteRes.status, 200);
    const noteBody = await noteRes.json();
    assert.equal(noteBody.notes.length, 1);
    assert.equal(noteBody.notes[0].text, 'Spoke with customer; policy document sent via WhatsApp.');

    // Verify in MariaDB enquiry_notes table
    const noteRows = await query('SELECT * FROM enquiry_notes WHERE enquiry_id = ?;', [id]);
    assert.equal(noteRows.length, 1);
    assert.equal(noteRows[0].text, 'Spoke with customer; policy document sent via WhatsApp.');

    // 3. Update status and note simultaneously
    const bothRes = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        status: 'COMPLETED',
        new_note: 'Payment received and policy issued.',
      }),
    });

    assert.equal(bothRes.status, 200);
    const bothBody = await bothRes.json();
    assert.equal(bothBody.status, 'COMPLETED');
    assert.equal(bothBody.notes.length, 2);
  });

  test('E2: PATCH /api/v1/enquiries/:id rejects empty update body with HTTP 400', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const id = crypto.randomUUID();
    enquiryTracker.trackEnquiry(id);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [id, 'Empty Update Customer', '9666666666', 'two-wheeler', 'policy', 'NEW']
    );

    const res = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.detail, 'No data provided to update');
  });

  test('E3: PATCH /api/v1/enquiries/:id rejects invalid status enum with HTTP 422', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const id = crypto.randomUUID();
    enquiryTracker.trackEnquiry(id);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [id, 'Invalid Status Customer', '9777777777', 'two-wheeler', 'policy', 'NEW']
    );

    const res = await fetch(`${baseUrl}/api/v1/enquiries/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ status: 'INVALID_CUSTOM_STATUS' }),
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(Array.isArray(body.detail));
  });

  // =========================================================================
  // F. DELETION AND FOREIGN-KEY CASCADE BEHAVIOR
  // =========================================================================

  test('F1: DELETE /api/v1/enquiries/:id deletes enquiry and cascade-deletes notes in MariaDB', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const enquiryId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    enquiryTracker.trackEnquiry(enquiryId);

    // 1. Insert enquiry directly into MariaDB
    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [enquiryId, 'Cascade Delete Target', '9888888888', 'private-car', 'claim', 'NEW']
    );

    // 2. Insert associated note directly into MariaDB
    await query(
      `INSERT INTO enquiry_notes (id, enquiry_id, text, created_at)
       VALUES (?, ?, ?, NOW());`,
      [noteId, enquiryId, 'Pre-delete note text']
    );

    // Verify both exist before deletion
    const rowsBefore = await query('SELECT id FROM enquiries WHERE id = ?;', [enquiryId]);
    const notesBefore = await query('SELECT id FROM enquiry_notes WHERE enquiry_id = ?;', [enquiryId]);
    assert.equal(rowsBefore.length, 1);
    assert.equal(notesBefore.length, 1);

    // 3. Delete enquiry via API endpoint
    const deleteRes = await fetch(`${baseUrl}/api/v1/enquiries/${enquiryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(deleteRes.status, 204);

    // 4. Verify enquiry is absent from enquiries table
    const rowsAfter = await query('SELECT id FROM enquiries WHERE id = ?;', [enquiryId]);
    assert.equal(rowsAfter.length, 0);

    // 5. Verify associated notes are automatically removed by foreign-key cascade constraint
    const notesAfter = await query('SELECT id FROM enquiry_notes WHERE enquiry_id = ?;', [enquiryId]);
    assert.equal(notesAfter.length, 0, 'Associated notes must be cascade deleted');
  });

  test('F2: DELETE /api/v1/enquiries/:id returns 404 when deleting nonexistent enquiry', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const nonExistentId = crypto.randomUUID();
    const res = await fetch(`${baseUrl}/api/v1/enquiries/${nonExistentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.detail, 'Enquiry not found');
  });

  // =========================================================================
  // G. EMAIL NOTIFICATIONS
  // =========================================================================

  test('G1: Public enquiry submission dispatches notification via mock transporter', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const initialSentCount = emailSuppression.getSentEmails().length;

    const payload = {
      full_name: 'Notification Test User',
      mobile_number: '9999900000',
      vehicle_type: 'two-wheeler',
      requirement: 'renewal',
      message: 'Testing email notification capture.',
    };

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    enquiryTracker.trackEnquiry(body.id);

    // Wait for in-process background notification to complete
    await waitForPendingNotifications();

    const sentEmails = emailSuppression.getSentEmails();
    assert.equal(sentEmails.length, initialSentCount + 1);

    const latestEmail = sentEmails[sentEmails.length - 1];
    assert.equal(latestEmail.to, 'neelkanthbpvi@gmail.com');
    assert.ok(latestEmail.subject.includes('New Customer Enquiry'));
    assert.ok(latestEmail.text.includes(payload.full_name));
    assert.ok(latestEmail.text.includes(payload.mobile_number));
  });

  test('G2: Email delivery failure does not roll back or undo persisted enquiry', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    // Temporarily inject a failing mock transporter
    setTransporter({
      async sendMail() {
        throw new Error('ECONNREFUSED: SMTP Server Unavailable');
      },
    });

    try {
      const payload = {
        full_name: 'Resilient Persistence Customer',
        mobile_number: '9999911111',
        vehicle_type: 'private-car',
        requirement: 'claim',
      };

      const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      enquiryTracker.trackEnquiry(body.id);

      await waitForPendingNotifications();

      // Verify the record is still safely persisted in MariaDB despite email delivery failure
      const rows = await query('SELECT * FROM enquiries WHERE id = ?;', [body.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].full_name, payload.full_name);
    } finally {
      // Reinstall safe suppression transporter
      emailSuppression = installEmailSuppression();
    }
  });

  // =========================================================================
  // H. SECURITY AND RESILIENCE
  // =========================================================================

  test('H1: SQL injection payloads in customer input are treated strictly as string literals', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const injectionPayload = {
      full_name: "Robert'); DROP TABLE enquiries; --",
      mobile_number: '9999922222',
      vehicle_type: 'two-wheeler',
      requirement: 'other',
      message: "' OR '1'='1'; DELETE FROM admins; --",
    };

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(injectionPayload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    enquiryTracker.trackEnquiry(body.id);

    // Verify stored text matches the exact literal payload string
    const rows = await query('SELECT full_name, message FROM enquiries WHERE id = ?;', [body.id]);
    assert.equal(rows[0].full_name, injectionPayload.full_name);
    assert.equal(rows[0].message, injectionPayload.message);

    // Verify database tables still exist
    const tables = await query("SHOW TABLES LIKE 'enquiries';");
    assert.equal(tables.length, 1);
  });

  test('H2: Search wildcard characters are safely escaped and do not cause broad matching', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const testId = crypto.randomUUID();
    enquiryTracker.trackEnquiry(testId);

    await query(
      `INSERT INTO enquiries (id, full_name, mobile_number, vehicle_type, requirement, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW());`,
      [testId, 'Normal Name Without Percent', '9999933333', 'two-wheeler', 'policy', 'NEW']
    );

    // Search for '%' wildcard: should only match records containing literal '%'
    const res = await fetch(`${baseUrl}/api/v1/enquiries?search=%25`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 0, 'Search for % should not return non-matching record');
  });

  test('H3: Malformed JSON request body returns HTTP 422 with FastAPI-compatible detail', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"full_name": "Incomplete JSON...',
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.deepEqual(body.detail, [{ loc: ['body'], msg: 'JSON decode error' }]);
  });

  test('H4: Protected enquiry endpoints strictly require authentication', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const testUuid = crypto.randomUUID();

    const endpoints = [
      { method: 'GET', url: `${baseUrl}/api/v1/enquiries` },
      { method: 'GET', url: `${baseUrl}/api/v1/enquiries/${testUuid}` },
      { method: 'PATCH', url: `${baseUrl}/api/v1/enquiries/${testUuid}`, body: JSON.stringify({ status: 'NEW' }) },
      { method: 'DELETE', url: `${baseUrl}/api/v1/enquiries/${testUuid}` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : {},
        body: ep.body || undefined,
      });

      assert.equal(res.status, 401, `Endpoint ${ep.method} ${ep.url} should reject without auth`);
      const body = await res.json();
      assert.equal(body.detail, 'Could not validate credentials');
    }
  });

  // =========================================================================
  // I. INITIAL ADMINISTRATOR SEEDING & IDEMPOTENCY (LIVE MARIADB)
  // =========================================================================

  test('I1: seedInitialAdmin creates absent administrator with UUID and bcrypt hash in isolated test DB', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const uniqueSeedEmail = `test_seed_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@dheekshatest.local`;
    const seedPassword = 'IntegrationSeedPassword123!';

    const result = await seedInitialAdmin({
      ADMIN_EMAIL: uniqueSeedEmail,
      ADMIN_PASSWORD: seedPassword,
    });

    assert.equal(result.seeded, true);
    assert.equal(result.reason, 'created');
    assert.equal(result.email, uniqueSeedEmail);
    assert.ok(result.id, 'Expected generated UUID id');

    // Track for scoped cleanup in after() hook
    adminTracker.trackAdmin(result.id);

    // Verify row directly in MariaDB test schema
    const rows = await query('SELECT id, email, hashed_password, created_at FROM admins WHERE id = ?;', [result.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, uniqueSeedEmail);

    // Password must be hashed with bcrypt, never plaintext
    assert.notEqual(rows[0].hashed_password, seedPassword);
    assert.ok(rows[0].hashed_password.startsWith('$2a$') || rows[0].hashed_password.startsWith('$2b$'));

    const isMatch = await verifyPassword(seedPassword, rows[0].hashed_password);
    assert.equal(isMatch, true);
  });

  test('I2: seedInitialAdmin is idempotent and strictly preserves existing administrator password in real MariaDB', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const uniqueSeedEmail = `test_seed_idem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@dheekshatest.local`;
    const originalPassword = 'OriginalSecretPassword123!';

    // First run creates the administrator
    const firstResult = await seedInitialAdmin({
      ADMIN_EMAIL: uniqueSeedEmail,
      ADMIN_PASSWORD: originalPassword,
    });
    assert.equal(firstResult.seeded, true);
    adminTracker.trackAdmin(firstResult.id);

    // Capture original row state
    const [originalRow] = await query('SELECT id, email, hashed_password FROM admins WHERE id = ?;', [firstResult.id]);

    // Second run with a different password must not overwrite
    const secondResult = await seedInitialAdmin({
      ADMIN_EMAIL: uniqueSeedEmail,
      ADMIN_PASSWORD: 'AttemptedOverwritingPassword999!',
    });

    assert.equal(secondResult.seeded, false);
    assert.equal(secondResult.reason, 'already_exists');
    assert.equal(secondResult.id, firstResult.id);
    assert.equal(secondResult.email, uniqueSeedEmail);

    // Re-query database to verify password was NOT overwritten
    const [rowAfterSecondRun] = await query('SELECT id, email, hashed_password FROM admins WHERE id = ?;', [firstResult.id]);
    assert.equal(rowAfterSecondRun.hashed_password, originalRow.hashed_password, 'Hash must not change');

    // Verify original password still authenticates and new password fails
    assert.equal(await verifyPassword(originalPassword, rowAfterSecondRun.hashed_password), true);
    assert.equal(await verifyPassword('AttemptedOverwritingPassword999!', rowAfterSecondRun.hashed_password), false);
  });

  test('I3: Seeded administrator can authenticate via HTTP POST /api/v1/auth/login and access /api/v1/auth/me', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    const uniqueSeedEmail = `test_seed_login_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@dheekshatest.local`;
    const validPassword = 'LiveSeedLoginPassword123!';

    const seedResult = await seedInitialAdmin({
      ADMIN_EMAIL: uniqueSeedEmail,
      ADMIN_PASSWORD: validPassword,
    });
    adminTracker.trackAdmin(seedResult.id);

    // 1. Authenticate with seeded credentials
    const formData = new URLSearchParams();
    formData.append('username', uniqueSeedEmail);
    formData.append('password', validPassword);

    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.ok(loginBody.access_token);
    assert.equal(loginBody.token_type, 'bearer');

    // 2. Access protected /api/v1/auth/me
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.access_token}` },
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.email, uniqueSeedEmail);
    assert.equal(meBody.hashed_password, undefined);
    assert.equal(meBody.password, undefined);
  });

  test('I4: initializeDatabase against live isolated test DB detects existing tables and safely stops without altering schema', async (t) => {
    if (skipAll) {
      t.skip('Opt-in absent');
      return;
    }

    // Capture row count of admins before check
    const [adminCountBefore] = await query('SELECT COUNT(*) AS total FROM admins;');

    const initResult = await initializeDatabase({
      confirm: true,
      isTest: true,
      databaseUrl: process.env.TEST_DATABASE_URL,
    });

    assert.equal(initResult.initialized, false);
    assert.equal(initResult.reason, 'already_initialized');
    assert.ok(Array.isArray(initResult.tables));
    assert.ok(initResult.tables.includes('admins'));
    assert.ok(initResult.tables.includes('enquiries'));
    assert.ok(initResult.tables.includes('enquiry_notes'));

    // Verify row count remained completely unchanged
    const [adminCountAfter] = await query('SELECT COUNT(*) AS total FROM admins;');
    assert.equal(adminCountAfter.total, adminCountBefore.total);
  });
});

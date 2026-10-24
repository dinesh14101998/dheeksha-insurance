import assert from 'node:assert/strict';
import { getConfig } from '../config/env.js';
import { initPool, query, closePool } from '../config/database.js';

const FRONTEND_BASE = 'http://localhost:5173';
const BACKEND_BASE = 'http://localhost:8000';
const API_BASE = `${BACKEND_BASE}/api/v1`;

async function runApplicationVerification() {
  console.log('====================================================');
  console.log('DHEEKSHA INSURANCE: FULL APPLICATION VERIFICATION');
  console.log('====================================================\n');

  const config = getConfig();

  // Safety Pre-flight: Database target verification
  console.log('[SAFETY] Checking database target...');
  const dbUrl = config.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!dbUrl || !dbUrl.includes('dheeksha_insurance_test')) {
    throw new Error('CRITICAL SAFETY ERROR: Target must strictly be dheeksha_insurance_test.');
  }
  if (dbUrl.includes('dheeksha_insurance') && !dbUrl.includes('dheeksha_insurance_test')) {
    throw new Error('CRITICAL SAFETY ERROR: Refusing to run against production database.');
  }
  console.log('[SAFETY] Verified isolated test database:', 'dheeksha_insurance_test');

  // Initialize DB pool
  initPool(dbUrl);

  // STEP 1 & 2: Health & Connectivity Checks
  console.log('\n--- STEP 1 & 2: Infrastructure Health Checks ---');
  const healthRes = await fetch(`${BACKEND_BASE}/api/health`);
  assert.equal(healthRes.status, 200, 'Backend /api/health must return 200');
  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'success');
  assert.equal(healthJson.database, 'connected');
  console.log('[PASS] Backend health endpoint: 200 OK (MariaDB connected)');

  // Verify frontend pages serve 200 OK
  const frontendPages = [
    '/',
    '/services',
    '/vehicles',
    '/about',
    '/claim-assistance',
    '/contact',
    '/get-in-touch',
    '/admin/login',
    '/admin/dashboard',
    '/admin/enquiries',
  ];

  for (const page of frontendPages) {
    const res = await fetch(`${FRONTEND_BASE}${page}`);
    assert.equal(res.status, 200, `Frontend page ${page} must return 200 OK`);
  }
  console.log(`[PASS] Frontend Vite server: All ${frontendPages.length} routes load successfully (200 OK)`);

  // STEP 3: Verify Public Website & Enquiry Submission
  console.log('\n--- STEP 3: Public Website Enquiry Validation & Submission ---');

  // 3a. Validation error testing on missing required fields
  const invalidPayload1 = {};
  const invRes1 = await fetch(`${API_BASE}/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(invalidPayload1),
  });
  assert.equal(invRes1.status, 422, 'Empty payload must return 422 Unprocessable Entity');
  const invData1 = await invRes1.json();
  assert(Array.isArray(invData1.detail), 'Validation error must contain detail array');
  console.log('[PASS] Empty submission rejected with HTTP 422 validation errors');

  // 3b. Short name validation error
  const invRes2 = await fetch(`${API_BASE}/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'A',
      mobile_number: '9876543210',
      vehicle_type: 'two-wheeler',
      requirement: 'renewal',
    }),
  });
  assert.equal(invRes2.status, 422, 'Short name must return 422');
  console.log('[PASS] Short customer name (< 2 chars) rejected with HTTP 422');

  // 3c. Invalid mobile number validation error
  const invRes3 = await fetch(`${API_BASE}/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      full_name: 'Kavitha R',
      mobile_number: '12345',
      vehicle_type: 'two-wheeler',
      requirement: 'renewal',
    }),
  });
  assert.equal(invRes3.status, 422, 'Invalid mobile number must return 422');
  console.log('[PASS] Invalid mobile number (not 10 digits) rejected with HTTP 422');

  // 3d. Valid synthetic customer enquiry submission with Unicode/Tamil text
  const syntheticEnquiry = {
    full_name: 'Kavitha R (கவிதா)',
    mobile_number: '9876543210',
    whatsapp_number: '9876543210',
    vehicle_type: 'two-wheeler',
    vehicle_registration_number: 'TN 49 AB 1234',
    requirement: 'renewal',
    message: 'வணக்கம், காப்பீடு புதுப்பித்தல் விவரங்கள் தேவை (Renewal quote requested)',
  };

  const createRes = await fetch(`${API_BASE}/enquiries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(syntheticEnquiry),
  });
  assert.equal(createRes.status, 201, 'Valid enquiry submission must return HTTP 201 Created');
  const createdEnquiry = await createRes.json();
  assert(createdEnquiry.id, 'Created enquiry must have an ID');
  assert.equal(createdEnquiry.full_name, syntheticEnquiry.full_name);
  assert.equal(createdEnquiry.status, 'NEW');
  assert.equal(createdEnquiry.message, syntheticEnquiry.message);
  console.log(`[PASS] Valid enquiry submitted successfully (HTTP 201 Created, ID: ${createdEnquiry.id})`);

  // 3e. Verify MariaDB direct persistence and Tamil text integrity
  const dbRows = await query(
    'SELECT id, full_name, mobile_number, whatsapp_number, vehicle_type, vehicle_registration_number, requirement, message, status, created_at FROM enquiries WHERE id = ?',
    [createdEnquiry.id]
  );
  assert.equal(dbRows.length, 1, 'Enquiry must be found in MariaDB');
  const dbEnquiry = dbRows[0];
  assert.equal(dbEnquiry.full_name, 'Kavitha R (கவிதா)', 'Tamil full_name must be stored intact');
  assert.equal(dbEnquiry.message, syntheticEnquiry.message, 'Tamil message must be stored intact');
  assert.equal(dbEnquiry.status, 'NEW');
  console.log('[PASS] MariaDB persistence verified: Tamil/Unicode characters stored intact without corruption');

  // STEP 4: Admin Dashboard & Authentication Verification
  console.log('\n--- STEP 4: Admin Authentication & Dashboard Operations ---');

  // 4a. Protected routes reject unauthenticated access
  const unauthRes = await fetch(`${API_BASE}/enquiries`);
  assert.equal(unauthRes.status, 401, 'Unauthenticated GET /enquiries must return 401 Unauthorized');
  const unauthMe = await fetch(`${API_BASE}/auth/me`);
  assert.equal(unauthMe.status, 401, 'Unauthenticated GET /auth/me must return 401 Unauthorized');
  console.log('[PASS] Protected endpoints (/enquiries, /auth/me) strictly reject unauthenticated requests (HTTP 401)');

  // 4b. Invalid credentials rejected
  const badLoginParams = new URLSearchParams();
  badLoginParams.append('username', config.ADMIN_EMAIL || 'admin@deekshainsurance.com');
  badLoginParams.append('password', 'wrong_password_123');
  const badLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: badLoginParams.toString(),
  });
  assert.equal(badLoginRes.status, 400, 'Invalid login credentials must return HTTP 400');
  console.log('[PASS] Invalid administrator credentials rejected with HTTP 400');

  // 4c. Successful admin login with OAuth2 form data
  const goodLoginParams = new URLSearchParams();
  goodLoginParams.append('username', config.ADMIN_EMAIL || 'admin@deekshainsurance.com');
  goodLoginParams.append('password', config.ADMIN_PASSWORD);
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: goodLoginParams.toString(),
  });
  assert.equal(loginRes.status, 200, 'Valid admin login must return HTTP 200');
  const loginData = await loginRes.json();
  assert(loginData.access_token, 'Login response must provide access_token');
  assert.equal(loginData.token_type, 'bearer');
  const adminToken = loginData.access_token;
  console.log('[PASS] Administrator login successful: Bearer JWT access_token issued');

  // 4d. Verify /auth/me profile
  const meRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(meRes.status, 200, 'GET /auth/me must return 200');
  const meData = await meRes.json();
  assert.equal(meData.email, config.ADMIN_EMAIL || 'admin@deekshainsurance.com');
  console.log(`[PASS] GET /auth/me returns authenticated admin profile: ${meData.email}`);

  // 4e. Enquiry list retrieval
  const listRes = await fetch(`${API_BASE}/enquiries`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(listRes.status, 200, 'GET /enquiries must return 200');
  const enquiriesList = await listRes.json();
  assert(Array.isArray(enquiriesList), 'Enquiry list must be an array');
  const foundTestItem = enquiriesList.find((e) => e.id === createdEnquiry.id);
  assert(foundTestItem, 'Created synthetic enquiry must be in the enquiry list');
  console.log(`[PASS] GET /enquiries list returned ${enquiriesList.length} record(s); synthetic enquiry present`);

  // 4f. Search and filtering verification
  // Search by customer name
  const searchRes = await fetch(`${API_BASE}/enquiries?search=Kavitha`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const searchResults = await searchRes.json();
  assert(searchResults.some((e) => e.id === createdEnquiry.id), 'Search by name must find test enquiry');
  console.log('[PASS] Enquiry search by name ("Kavitha") matched synthetic enquiry');

  // Search by nonexistent name
  const emptySearchRes = await fetch(`${API_BASE}/enquiries?search=NonExistentZzzz999`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const emptySearchResults = await emptySearchRes.json();
  assert.equal(emptySearchResults.length, 0, 'Nonexistent search must return empty array');
  console.log('[PASS] Enquiry search for nonexistent term returned empty results as expected');

  // Filter by status NEW
  const statusRes = await fetch(`${API_BASE}/enquiries?status=NEW`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const statusResults = await statusRes.json();
  assert(statusResults.some((e) => e.id === createdEnquiry.id), 'Status filter NEW must include test enquiry');
  console.log('[PASS] Enquiry status filtering (?status=NEW) correctly filtered records');

  // 4g. Enquiry detail view
  const detailRes = await fetch(`${API_BASE}/enquiries/${createdEnquiry.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(detailRes.status, 200, 'GET /enquiries/:id must return 200');
  const detailData = await detailRes.json();
  assert.equal(detailData.id, createdEnquiry.id);
  assert(Array.isArray(detailData.notes), 'Enquiry notes must be an array');
  assert.equal(detailData.notes.length, 0, 'Initial enquiry should have 0 notes');
  console.log('[PASS] GET /enquiries/:id returned detailed enquiry record');

  // 4h. Status update & note persistence
  const patchRes = await fetch(`${API_BASE}/enquiries/${createdEnquiry.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      status: 'CONTACTED',
      new_note: 'Called customer on phone; renewal quote shared via WhatsApp.',
    }),
  });
  assert.equal(patchRes.status, 200, 'PATCH /enquiries/:id must return 200');
  const patchData = await patchRes.json();
  assert.equal(patchData.status, 'CONTACTED');
  assert.equal(patchData.notes.length, 1);
  assert.equal(patchData.notes[0].text, 'Called customer on phone; renewal quote shared via WhatsApp.');
  console.log('[PASS] PATCH /enquiries/:id successfully updated status to CONTACTED and added note');

  // Verify in MariaDB directly
  const updatedDbRows = await query(
    'SELECT status FROM enquiries WHERE id = ?',
    [createdEnquiry.id]
  );
  assert.equal(updatedDbRows[0].status, 'CONTACTED');
  const noteRows = await query(
    'SELECT text FROM enquiry_notes WHERE enquiry_id = ?',
    [createdEnquiry.id]
  );
  assert.equal(noteRows.length, 1);
  assert.equal(noteRows[0].text, 'Called customer on phone; renewal quote shared via WhatsApp.');
  console.log('[PASS] MariaDB persistence verified: status updated and note persisted in enquiry_notes table');

  // 4i. Scoped Deletion and Cascade Behavior
  // Confirm deletion removes ONLY our synthetic enquiry and its notes
  const delRes = await fetch(`${API_BASE}/enquiries/${createdEnquiry.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(delRes.status, 204, 'DELETE /enquiries/:id must return 204 No Content');

  // Verify enquiry is gone from MariaDB
  const postDelRows = await query(
    'SELECT id FROM enquiries WHERE id = ?',
    [createdEnquiry.id]
  );
  assert.equal(postDelRows.length, 0, 'Deleted enquiry must no longer exist in enquiries table');

  // Verify notes were cascade-deleted
  const postDelNotes = await query(
    'SELECT id FROM enquiry_notes WHERE enquiry_id = ?',
    [createdEnquiry.id]
  );
  assert.equal(postDelNotes.length, 0, 'Associated notes must be cascade-deleted from enquiry_notes table');
  console.log('[PASS] DELETE /enquiries/:id verified: synthetic enquiry and associated notes cascade-deleted');

  // Verify 404 for nonexistent enquiry deletion
  const del404Res = await fetch(`${API_BASE}/enquiries/${createdEnquiry.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(del404Res.status, 404, 'Deleting already-deleted enquiry must return 404 Not Found');
  console.log('[PASS] Deleting nonexistent enquiry returns HTTP 404 Not Found');

  // Close DB pool
  await closePool();

  console.log('\n====================================================');
  console.log('ALL APPLICATION VERIFICATION CHECKS PASSED (100%)');
  console.log('====================================================');
}

runApplicationVerification().catch(async (err) => {
  console.error('\n[VERIFICATION FAILED]', err);
  try {
    await closePool();
  } catch {}
  process.exit(1);
});

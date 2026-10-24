import crypto from 'node:crypto';
import { getPool } from '../config/database.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { getConfig } from '../config/env.js';

/**
 * Finds an administrator by email using a parameterized SQL query.
 *
 * @param {string} email
 * @returns {Promise<{ id: string, email: string, hashed_password: string, created_at: Date } | null>}
 */
export async function findAdminByEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const pool = getPool();
  if (!pool) {
    throw new Error('Database pool has not been initialized.');
  }

  const [rows] = await pool.execute(
    'SELECT id, email, hashed_password, created_at FROM admins WHERE email = ? LIMIT 1;',
    [email.trim().toLowerCase()]
  );

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Authenticates an administrator by verifying credentials.
 * Returns safe administrator profile (excluding hashed_password).
 * Never leaks whether the email address exists or not.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ id: string, email: string }>} Safe admin object
 * @throws {Error} Throws with generic message "Incorrect email or password" on failure
 */
export async function authenticateAdmin(email, password) {
  if (!email || !password) {
    const error = new Error('Incorrect email or password');
    error.statusCode = 400;
    throw error;
  }

  const admin = await findAdminByEmail(email);
  if (!admin) {
    const error = new Error('Incorrect email or password');
    error.statusCode = 400;
    throw error;
  }

  const passwordValid = await verifyPassword(password, admin.hashed_password);
  if (!passwordValid) {
    const error = new Error('Incorrect email or password');
    error.statusCode = 400;
    throw error;
  }

  // Return only safe fields - NEVER expose hashed_password
  return {
    id: admin.id,
    email: admin.email,
  };
}

/**
 * Safely seeds the initial administrator account during application bootstrap.
 *
 * Startup Policy:
 * 1. If neither ADMIN_EMAIL nor ADMIN_PASSWORD is provided, seeding is skipped safely.
 * 2. If only one credential is provided, an error is thrown without leaking secret values.
 * 3. If credentials are provided, validates syntax (valid email and >= 8 character password).
 * 4. Queries using parameterized SQL. If administrator already exists, account and password
 *    are strictly preserved without modification.
 * 5. If absent, inserts a new administrator record with a UUID identifier and bcrypt hash.
 * 6. Handles concurrent startup races (ER_DUP_ENTRY / 1062) safely.
 * 7. Never logs credentials or password hashes.
 *
 * @param {Object} [configOverride] - Optional configuration override (defaults to getConfig())
 * @returns {Promise<{ seeded: boolean, reason: 'unconfigured' | 'already_exists' | 'created', id?: string, email?: string }>}
 */
export async function seedInitialAdmin(configOverride = null) {
  const config = configOverride || getConfig();

  const rawEmail = config.ADMIN_EMAIL ? String(config.ADMIN_EMAIL).trim() : '';
  const rawPassword = config.ADMIN_PASSWORD ? String(config.ADMIN_PASSWORD).trim() : '';

  const hasEmail = Boolean(rawEmail);
  const hasPassword = Boolean(rawPassword);

  // Policy 1: If neither credential is configured, follow documented safe startup policy
  if (!hasEmail && !hasPassword) {
    console.log('Initial administrator auto-seeding skipped: ADMIN_EMAIL and ADMIN_PASSWORD not configured.');
    return {
      seeded: false,
      reason: 'unconfigured',
    };
  }

  // Policy 2: Fail startup if only one credential is provided
  if (hasEmail !== hasPassword) {
    throw new Error(
      'Incomplete administrator credentials: both ADMIN_EMAIL and ADMIN_PASSWORD must be provided if either is configured.'
    );
  }

  // Policy 3: Validate credentials according to security requirements
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(rawEmail)) {
    throw new Error('Invalid ADMIN_EMAIL: must be a valid email address.');
  }

  if (rawPassword.length < 8) {
    throw new Error('Invalid ADMIN_PASSWORD: password must be at least 8 characters long.');
  }

  const pool = getPool();
  if (!pool) {
    throw new Error('Database pool has not been initialized.');
  }

  const normalizedEmail = rawEmail.toLowerCase();

  // Policy 4: Check if administrator already exists using parameterized SQL query
  const existingAdmin = await findAdminByEmail(normalizedEmail);
  if (existingAdmin) {
    console.log('Initial administrator account verified.');
    return {
      seeded: false,
      reason: 'already_exists',
      id: existingAdmin.id,
      email: existingAdmin.email,
    };
  }

  // Policy 5: Hash password and insert UUID-based administrator record
  const adminId = crypto.randomUUID();
  const hashedPassword = await hashPassword(rawPassword);

  try {
    await pool.execute(
      'INSERT INTO admins (id, email, hashed_password, created_at) VALUES (?, ?, ?, NOW());',
      [adminId, normalizedEmail, hashedPassword]
    );

    console.log('Initial administrator account verified.');
    return {
      seeded: true,
      reason: 'created',
      id: adminId,
      email: normalizedEmail,
    };
  } catch (err) {
    // Policy 6: Handle concurrent startup race condition safely
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      console.log('Initial administrator account verified (concurrent initialization handled).');
      const duplicateAdmin = await findAdminByEmail(normalizedEmail);
      return {
        seeded: false,
        reason: 'already_exists',
        id: duplicateAdmin ? duplicateAdmin.id : adminId,
        email: normalizedEmail,
      };
    }

    // Policy 7: Never log credentials or password hashes
    console.error('Error during initial administrator seeding:', err.code || err.name || 'UNKNOWN');
    throw err;
  }
}

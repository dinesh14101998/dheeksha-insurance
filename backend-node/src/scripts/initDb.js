import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import {
  ALLOWED_LOCAL_HOSTS,
  FORBIDDEN_ADMIN_USERS,
  EXACT_TEST_DATABASE_NAME,
  sanitizeDatabaseUrl,
} from '../config/databaseGuard.js';

// Load environment variables if not in production
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

export const FORBIDDEN_TARGET_DATABASES = Object.freeze([
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
  'dheeksha_insurance', // Production database is strictly forbidden
  'bitforum',
  'foodhunter',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_FILE_PATH = path.resolve(__dirname, '../config/schema.sql');

/**
 * Validates the database URL before any connection or initialization attempt.
 * Enforces strict fail-closed safeguards.
 *
 * @param {string} urlStr - Target connection URL
 * @param {Object} [options={}] - Validation options
 * @param {boolean} [options.isTest=false] - When true, enforces exact test database name
 * @returns {{ host: string, port: number, database: string, user: string, sanitizedUrl: string }}
 */
export function validateInitTarget(urlStr, options = {}) {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) {
    throw new Error('INIT GUARD ERROR: Database URL is required and must not be empty.');
  }

  const trimmed = urlStr.trim();
  const validScheme =
    trimmed.startsWith('mysql://') ||
    trimmed.startsWith('mysql2://') ||
    trimmed.startsWith('mariadb://');

  if (!validScheme) {
    throw new Error(
      'INIT GUARD ERROR: Invalid database URL scheme. Expected mysql://, mysql2://, or mariadb://.'
    );
  }

  let parsed;
  try {
    const parseable = trimmed.startsWith('mariadb://')
      ? trimmed.replace(/^mariadb:\/\//, 'mysql://')
      : trimmed;
    parsed = new URL(parseable);
  } catch {
    throw new Error('INIT GUARD ERROR: Malformed database connection URL.');
  }

  // 1. Host validation (must be local for safety)
  const hostname = (parsed.hostname || '').toLowerCase().trim();
  if (!hostname || !ALLOWED_LOCAL_HOSTS.includes(hostname)) {
    throw new Error(
      `INIT GUARD ERROR: Remote host "${hostname || 'unknown'}" rejected. Database initialization is strictly restricted to local hosts (${ALLOWED_LOCAL_HOSTS.join(', ')}).`
    );
  }

  // 2. Database name validation
  const dbName = parsed.pathname.replace(/^\//, '').trim();
  if (!dbName) {
    throw new Error('INIT GUARD ERROR: Target database name is missing from connection URL.');
  }

  if (dbName === 'dheeksha_insurance' || dbName.toLowerCase().includes('prod')) {
    throw new Error(
      `CRITICAL INIT GUARD ERROR: Schema initialization against production database "${dbName}" is strictly forbidden.`
    );
  }

  if (FORBIDDEN_TARGET_DATABASES.includes(dbName.toLowerCase())) {
    throw new Error(
      `INIT GUARD ERROR: Target database "${dbName}" is a forbidden system or unrelated database.`
    );
  }

  if (options.isTest && dbName !== EXACT_TEST_DATABASE_NAME) {
    throw new Error(
      `INIT GUARD ERROR: Test initialization must target "${EXACT_TEST_DATABASE_NAME}". Found: "${dbName}".`
    );
  }

  // 3. User validation (never allow root or administrative accounts)
  const username = decodeURIComponent(parsed.username || '').toLowerCase().trim();
  if (!username) {
    throw new Error('INIT GUARD ERROR: Connection URL must specify a dedicated database user.');
  }

  if (FORBIDDEN_ADMIN_USERS.includes(username)) {
    throw new Error(
      `INIT GUARD ERROR: Schema initialization as administrative user "${username}" is forbidden. Use a dedicated application account.`
    );
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 3306;

  return {
    host: hostname,
    port,
    database: dbName,
    user: username,
    sanitizedUrl: sanitizeDatabaseUrl(trimmed),
  };
}

/**
 * Reads and parses the standalone schema SQL file into individual statements.
 *
 * @param {string} [filePath=SCHEMA_FILE_PATH]
 * @returns {Array<string>} Array of executable SQL statements
 */
export function loadSchemaStatements(filePath = SCHEMA_FILE_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Schema file not found at: ${filePath}`);
  }

  const rawSql = fs.readFileSync(filePath, 'utf8');

  // Split by semicolon, clean comments and empty statements
  return rawSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      // Filter out comments-only blocks or empty strings
      const cleaned = s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join(' ')
        .trim();
      return cleaned.length > 0;
    });
}

/**
 * Safely initializes database tables if and only if the target database is empty.
 * Never overwrites, drops, truncates, or modifies an existing schema.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.confirm=false] - Explicit confirmation flag required
 * @param {string} [options.databaseUrl] - Custom database URL override
 * @param {boolean} [options.isTest] - Flag indicating test mode
 * @param {Object} [options.customPool] - Injected mock pool for offline unit tests
 * @returns {Promise<{ initialized: boolean, reason: string, tables?: Array<string>, tablesCreated?: Array<string> }>}
 */
export async function initializeDatabase(options = {}) {
  // 1. Explicit confirmation check
  const isConfirmed =
    options.confirm === true ||
    process.argv.includes('--confirm') ||
    process.env.CONFIRM_DB_INIT === 'true' ||
    process.env.CONFIRM_DB_INIT === '1';

  if (!isConfirmed) {
    const errorMsg =
      'INIT CONFIRMATION REQUIRED: Database initialization requires explicit confirmation.\n' +
      'To execute, re-run with the "--confirm" flag or set environment variable CONFIRM_DB_INIT=true.\n' +
      'Example: npm run db:init -- --confirm';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Resolve target connection URL
  const isTestMode =
    options.isTest !== undefined
      ? options.isTest
      : process.env.NODE_ENV === 'test' || process.argv.includes('--test');

  let targetUrl = options.databaseUrl;

  if (!targetUrl) {
    if (isTestMode) {
      targetUrl = process.env.TEST_DATABASE_URL ? String(process.env.TEST_DATABASE_URL).trim() : null;
      if (!targetUrl) {
        throw new Error(
          'INIT GUARD ERROR: TEST_DATABASE_URL is not set. Test database initialization will never fall back to DATABASE_URL.'
        );
      }
    } else {
      targetUrl = process.env.DATABASE_URL ? String(process.env.DATABASE_URL).trim() : null;
      if (!targetUrl) {
        throw new Error(
          'INIT GUARD ERROR: DATABASE_URL is not set. Valid target configuration required.'
        );
      }
    }
  }

  // 3. Pre-flight validation against guards
  const validatedTarget = validateInitTarget(targetUrl, { isTest: isTestMode });
  console.log(`[DB:INIT] Target: ${validatedTarget.sanitizedUrl} (Database: ${validatedTarget.database})`);

  // 4. Connect to database
  const pool = options.customPool || mysql.createPool({
    uri: targetUrl,
    charset: 'utf8mb4',
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 2,
    connectTimeout: 5000,
  });

  try {
    // 5. Inspect existing tables in target database
    const [existingRows] = await pool.query('SHOW TABLES;');
    const existingTableNames = existingRows.map((r) => Object.values(r)[0]);

    if (existingTableNames.length > 0) {
      console.log(
        `[DB:INIT] Database "${validatedTarget.database}" already contains ${existingTableNames.length} table(s): [${existingTableNames.join(', ')}].`
      );
      console.log('[DB:INIT] Schema initialization is not applicable. No changes made to preserve existing schema.');
      return {
        initialized: false,
        reason: 'already_initialized',
        tables: existingTableNames,
      };
    }

    // 6. Target is empty: Load and execute standalone schema statements
    console.log(`[DB:INIT] Database "${validatedTarget.database}" is empty. Applying schema definition...`);
    const statements = loadSchemaStatements(options.schemaFilePath);

    const tablesCreated = [];
    for (const stmt of statements) {
      await pool.query(stmt);
      const match = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/i);
      if (match) {
        tablesCreated.push(match[1]);
        console.log(`[DB:INIT] Successfully created table: "${match[1]}"`);
      }
    }

    console.log(`[DB:INIT] Database schema initialization completed successfully. Created: [${tablesCreated.join(', ')}].`);
    return {
      initialized: true,
      reason: 'created',
      tablesCreated,
    };
  } catch (err) {
    if (err.code === 'ER_TABLEACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR' || err.errno === 1142 || err.errno === 1044) {
      console.error(
        '[DB:INIT] Privilege error: The configured database account lacks CREATE TABLE privileges.\n' +
        'Safe manual provisioning by a database administrator is required.'
      );
    } else {
      console.error('[DB:INIT] Error during schema initialization:', err.code || err.name || 'UNKNOWN');
    }
    throw err;
  } finally {
    if (!options.customPool) {
      await pool.end().catch(() => {});
    }
  }
}

// Direct CLI execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializeDatabase()
    .then((result) => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[DB:INIT] Aborted: ${err.message}`);
      process.exit(1);
    });
}

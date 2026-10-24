import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateInitTarget,
  loadSchemaStatements,
  initializeDatabase,
  FORBIDDEN_TARGET_DATABASES,
} from '../src/scripts/initDb.js';
import {
  EXACT_TEST_DATABASE_NAME,
  ALLOWED_LOCAL_HOSTS,
  validateTestDatabaseTarget,
} from '../src/config/databaseGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_FILE_PATH = path.resolve(__dirname, '../src/config/schema.sql');

describe('Database Schema Definition and Standalone Initialization Verification', () => {
  let originalEnv;
  let originalLog;
  let originalError;
  let capturedLogs = [];
  let capturedErrors = [];

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalLog = console.log;
    originalError = console.error;
    capturedLogs = [];
    capturedErrors = [];
    console.log = (...args) => capturedLogs.push(args.join(' '));
    console.error = (...args) => capturedErrors.push(args.join(' '));
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalLog;
    console.error = originalError;
  });

  // =========================================================================
  // 1. SCHEMA FILE STRUCTURE AND PARITY
  // =========================================================================

  test('Schema file exists and contains all required tables, columns, indexes, and constraints', () => {
    assert.ok(fs.existsSync(SCHEMA_FILE_PATH), 'schema.sql must exist');
    const sqlContent = fs.readFileSync(SCHEMA_FILE_PATH, 'utf8');

    // 1. Engine, encoding, and collation
    assert.match(sqlContent, /ENGINE=InnoDB/i);
    assert.match(sqlContent, /DEFAULT CHARSET=utf8mb4/i);
    assert.match(sqlContent, /COLLATE=utf8mb4_unicode_ci/i);

    // 2. Table: admins
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS `admins`/i);
    assert.match(sqlContent, /`id`\s+VARCHAR\(36\)\s+NOT NULL/i);
    assert.match(sqlContent, /`email`\s+VARCHAR\(255\)\s+NOT NULL/i);
    assert.match(sqlContent, /`hashed_password`\s+VARCHAR\(255\)\s+NOT NULL/i);
    assert.match(sqlContent, /`created_at`\s+DATETIME\s+NOT NULL/i);
    assert.match(sqlContent, /UNIQUE KEY `ix_admins_email` \(`email`\)/i);

    // 3. Table: enquiries
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS `enquiries`/i);
    assert.match(sqlContent, /`full_name`\s+VARCHAR\(100\)\s+NOT NULL/i);
    assert.match(sqlContent, /`mobile_number`\s+VARCHAR\(20\)\s+NOT NULL/i);
    assert.match(sqlContent, /`whatsapp_number`\s+VARCHAR\(20\)\s+DEFAULT NULL/i);
    assert.match(sqlContent, /`vehicle_type`\s+VARCHAR\(30\)\s+NOT NULL/i);
    assert.match(sqlContent, /`vehicle_registration_number`\s+VARCHAR\(50\)\s+DEFAULT NULL/i);
    assert.match(sqlContent, /`requirement`\s+VARCHAR\(30\)\s+NOT NULL/i);
    assert.match(sqlContent, /`message`\s+TEXT\s+DEFAULT NULL/i);
    assert.match(sqlContent, /`status`\s+VARCHAR\(20\)\s+NOT NULL/i);
    assert.match(sqlContent, /KEY `ix_enquiries_created_at` \(`created_at`\)/i);
    assert.match(sqlContent, /KEY `ix_enquiries_mobile_number` \(`mobile_number`\)/i);
    assert.match(sqlContent, /KEY `ix_enquiries_status` \(`status`\)/i);

    // 4. Table: enquiry_notes
    assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS `enquiry_notes`/i);
    assert.match(sqlContent, /`enquiry_id`\s+VARCHAR\(36\)\s+NOT NULL/i);
    assert.match(sqlContent, /`text`\s+TEXT\s+NOT NULL/i);
    assert.match(sqlContent, /KEY `ix_enquiry_notes_enquiry_id` \(`enquiry_id`\)/i);
    assert.match(
      sqlContent,
      /CONSTRAINT `fk_enquiry_notes_enquiry_id` FOREIGN KEY \(`enquiry_id`\) REFERENCES `enquiries` \(`id`\) ON DELETE CASCADE/i
    );

    // 5. No Alembic version table requirement
    assert.doesNotMatch(sqlContent, /alembic_version/i);
  });

  test('loadSchemaStatements parses clean executable SQL statements', () => {
    const statements = loadSchemaStatements(SCHEMA_FILE_PATH);
    assert.equal(statements.length, 3);
    assert.ok(statements[0].includes('CREATE TABLE IF NOT EXISTS `admins`'));
    assert.ok(statements[1].includes('CREATE TABLE IF NOT EXISTS `enquiries`'));
    assert.ok(statements[2].includes('CREATE TABLE IF NOT EXISTS `enquiry_notes`'));
  });

  // =========================================================================
  // 2. EXPLICIT CONFIRMATION REQUIREMENT
  // =========================================================================

  test('initializeDatabase rejects without explicit confirmation flag', async () => {
    await assert.rejects(
      async () => initializeDatabase({ confirm: false }),
      (err) => {
        assert.match(err.message, /INIT CONFIRMATION REQUIRED/);
        return true;
      }
    );
  });

  // =========================================================================
  // 3. TARGET DATABASE REJECTION SCENARIOS
  // =========================================================================

  test('validateInitTarget strictly rejects production database dheeksha_insurance', () => {
    const prodUrls = [
      'mysql://dheeksha_app:pass@127.0.0.1:3306/dheeksha_insurance',
      'mysql://dheeksha_app:pass@localhost:3306/dheeksha_insurance',
      'mariadb://dheeksha_app:pass@127.0.0.1:3306/dheeksha_insurance_prod',
      'mysql://dheeksha_app:pass@127.0.0.1:3306/prod_dheeksha',
    ];

    for (const url of prodUrls) {
      assert.throws(
        () => validateInitTarget(url),
        (err) => {
          assert.match(err.message, /production database/i);
          return true;
        }
      );
    }
  });

  test('validateInitTarget strictly rejects system and unrelated databases (bitforum, foodhunter)', () => {
    for (const forbiddenDb of FORBIDDEN_TARGET_DATABASES) {
      const url = `mysql://dheeksha_app:pass@127.0.0.1:3306/${forbiddenDb}`;
      assert.throws(
        () => validateInitTarget(url),
        (err) => {
          assert.match(err.message, /forbidden system or unrelated database|production database/i);
          return true;
        }
      );
    }
  });

  test('validateInitTarget rejects unexpected remote hosts', () => {
    const remoteUrls = [
      'mysql://dheeksha_app:pass@db.example.com:3306/dheeksha_insurance_test',
      'mysql://dheeksha_app:pass@192.168.1.100:3306/dheeksha_insurance_test',
      'mysql://dheeksha_app:pass@10.0.0.5:3306/dheeksha_insurance_test',
    ];

    for (const url of remoteUrls) {
      assert.throws(
        () => validateInitTarget(url),
        (err) => {
          assert.match(err.message, /Remote host.*rejected/i);
          return true;
        }
      );
    }
  });

  test('validateInitTarget rejects administrative users (root, admin, sa)', () => {
    const adminUsers = ['root', 'admin', 'administrator', 'sa', 'sysadmin', 'master'];
    for (const user of adminUsers) {
      const url = `mysql://${user}:secret@127.0.0.1:3306/dheeksha_insurance_test`;
      assert.throws(
        () => validateInitTarget(url),
        (err) => {
          assert.match(err.message, /administrative user.*forbidden/i);
          return true;
        }
      );
    }
  });

  test('validateInitTarget rejects missing or empty database configuration', () => {
    assert.throws(() => validateInitTarget(''), /Database URL is required/);
    assert.throws(() => validateInitTarget(null), /Database URL is required/);
    assert.throws(() => validateInitTarget('postgres://user:pass@127.0.0.1/db'), /Invalid database URL scheme/);
    assert.throws(() => validateInitTarget('mysql://user:pass@127.0.0.1:3306/'), /Target database name is missing/);
  });

  test('In test mode, initializeDatabase never falls back from TEST_DATABASE_URL to DATABASE_URL', async () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = 'mysql://dheeksha_test_user:pass@127.0.0.1:3306/dheeksha_insurance_test';

    await assert.rejects(
      async () => initializeDatabase({ confirm: true, isTest: true }),
      (err) => {
        assert.match(err.message, /TEST_DATABASE_URL is not set.*never fall back to DATABASE_URL/);
        return true;
      }
    );
  });

  // =========================================================================
  // 4. EXISTING DATABASE NON-DESTRUCTIVE SAFE STOP
  // =========================================================================

  test('initializeDatabase stops safely without modifying when target database already contains tables', async () => {
    const executedQueries = [];
    const mockPool = {
      async query(sql) {
        executedQueries.push(sql);
        if (sql.includes('SHOW TABLES')) {
          return [[{ Tables_in_db: 'admins' }, { Tables_in_db: 'enquiries' }, { Tables_in_db: 'enquiry_notes' }]];
        }
        return [[]];
      },
    };

    const result = await initializeDatabase({
      confirm: true,
      databaseUrl: 'mysql://dheeksha_test_user:pass@127.0.0.1:3306/dheeksha_insurance_test',
      customPool: mockPool,
    });

    assert.equal(result.initialized, false);
    assert.equal(result.reason, 'already_initialized');
    assert.deepEqual(result.tables, ['admins', 'enquiries', 'enquiry_notes']);

    // Ensure NO DDL statements were executed
    const ddlQueries = executedQueries.filter((q) =>
      /CREATE|DROP|ALTER|TRUNCATE/i.test(q)
    );
    assert.equal(ddlQueries.length, 0, 'No DDL statements should be executed on an existing schema');
  });

  // =========================================================================
  // 5. FRESH DATABASE INITIALIZATION EXECUTION
  // =========================================================================

  test('initializeDatabase executes CREATE TABLE statements sequentially on an empty database', async () => {
    const executedQueries = [];
    const mockPool = {
      async query(sql) {
        executedQueries.push(sql);
        if (sql.includes('SHOW TABLES')) {
          return [[]]; // Database is completely fresh/empty
        }
        return [{ affectedRows: 0 }];
      },
    };

    const result = await initializeDatabase({
      confirm: true,
      databaseUrl: 'mysql://dheeksha_test_user:pass@127.0.0.1:3306/dheeksha_insurance_test',
      customPool: mockPool,
    });

    assert.equal(result.initialized, true);
    assert.equal(result.reason, 'created');
    assert.deepEqual(result.tablesCreated, ['admins', 'enquiries', 'enquiry_notes']);

    // Verify 3 CREATE TABLE statements were executed
    const createQueries = executedQueries.filter((q) => q.includes('CREATE TABLE'));
    assert.equal(createQueries.length, 3);
  });

  // =========================================================================
  // 6. SERVER BOOTSTRAP INDEPENDENCE (NORMAL STARTUP DOES NOT RUN DDL)
  // =========================================================================

  test('Normal server bootstrap code does not import or execute DDL schema initialization', () => {
    const serverCode = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');
    assert.doesNotMatch(serverCode, /initDb|schema\.sql|CREATE TABLE|ALTER TABLE|DROP TABLE/i);
    assert.match(serverCode, /checkDatabaseHealth/);
    assert.match(serverCode, /seedInitialAdmin/);
  });

  // =========================================================================
  // 7. DATABASE SAFETY GUARD INTEGRITY
  // =========================================================================

  test('Existing databaseGuard.js remains active, unmodified, and enforces fail-closed safeguards', () => {
    assert.equal(EXACT_TEST_DATABASE_NAME, 'dheeksha_insurance_test');
    assert.deepEqual(ALLOWED_LOCAL_HOSTS, ['localhost', '127.0.0.1', '::1', '[::1]']);

    // Production target is rejected
    assert.throws(
      () =>
        validateTestDatabaseTarget({
          RUN_DB_INTEGRATION_TESTS: 'true',
          TEST_DATABASE_URL: 'mysql://dheeksha_test_user:pass@127.0.0.1:3306/dheeksha_insurance',
        }),
      /strictly forbidden/
    );
  });
});

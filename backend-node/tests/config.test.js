import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config/env.js';

describe('Environment Configuration Validation', () => {
  const validBaseEnv = {
    NODE_ENV: 'test',
    PORT: '8000',
    SECRET_KEY: 'a'.repeat(32),
    ACCESS_TOKEN_EXPIRE_MINUTES: '120',
    FRONTEND_URL: 'http://localhost:5173',
  };

  test('Valid configuration passes validation', () => {
    const config = validateConfig(validBaseEnv);
    assert.equal(config.NODE_ENV, 'test');
    assert.equal(config.PORT, 8000);
    assert.equal(config.SECRET_KEY, 'a'.repeat(32));
    assert.equal(config.ACCESS_TOKEN_EXPIRE_MINUTES, 120);
    assert.deepEqual(config.frontendOrigins, ['http://localhost:5173']);
  });

  test('Missing SECRET_KEY throws validation error without leaking secrets', () => {
    const env = { ...validBaseEnv };
    delete env.SECRET_KEY;

    assert.throws(
      () => validateConfig(env),
      (err) => {
        assert.match(err.message, /SECRET_KEY must be a cryptographically secure string with at least 32 characters/);
        return true;
      }
    );
  });

  test('SECRET_KEY shorter than 32 characters is rejected', () => {
    const env = { ...validBaseEnv, SECRET_KEY: 'short-secret' };

    assert.throws(
      () => validateConfig(env),
      (err) => {
        assert.match(err.message, /SECRET_KEY must be a cryptographically secure string with at least 32 characters/);
        // Ensure secret value is never in the error message
        assert.doesNotMatch(err.message, /short-secret/);
        return true;
      }
    );
  });

  test('Valid SECRET_KEY >= 32 characters is accepted', () => {
    const longSecret = 'super-secret-key-that-is-at-least-32-chars-long';
    const config = validateConfig({ ...validBaseEnv, SECRET_KEY: longSecret });
    assert.equal(config.SECRET_KEY, longSecret);
  });

  test('Invalid PORT values are rejected', () => {
    const invalidPorts = ['0', '-1', '65536', 'abc', '80.5', ''];
    for (const port of invalidPorts) {
      assert.throws(
        () => validateConfig({ ...validBaseEnv, PORT: port }),
        /Invalid PORT/,
        `Expected rejection for PORT: "${port}"`
      );
    }
  });

  test('Valid PORT values are parsed as numbers', () => {
    const config = validateConfig({ ...validBaseEnv, PORT: '3000' });
    assert.equal(config.PORT, 3000);
  });

  test('ACCESS_TOKEN_EXPIRE_MINUTES defaults to 120 and accepts valid overrides', () => {
    const envWithoutExpiry = { ...validBaseEnv };
    delete envWithoutExpiry.ACCESS_TOKEN_EXPIRE_MINUTES;
    const defaultConfig = validateConfig(envWithoutExpiry);
    assert.equal(defaultConfig.ACCESS_TOKEN_EXPIRE_MINUTES, 120);

    const overrideConfig = validateConfig({ ...validBaseEnv, ACCESS_TOKEN_EXPIRE_MINUTES: '60' });
    assert.equal(overrideConfig.ACCESS_TOKEN_EXPIRE_MINUTES, 60);

    assert.throws(
      () => validateConfig({ ...validBaseEnv, ACCESS_TOKEN_EXPIRE_MINUTES: '0' }),
      /Invalid ACCESS_TOKEN_EXPIRE_MINUTES/
    );
    assert.throws(
      () => validateConfig({ ...validBaseEnv, ACCESS_TOKEN_EXPIRE_MINUTES: '-10' }),
      /Invalid ACCESS_TOKEN_EXPIRE_MINUTES/
    );
  });

  test('NODE_ENV supports development, test, and production', () => {
    for (const envMode of ['development', 'test', 'production']) {
      const config = validateConfig({ ...validBaseEnv, NODE_ENV: envMode });
      assert.equal(config.NODE_ENV, envMode);
    }

    assert.throws(
      () => validateConfig({ ...validBaseEnv, NODE_ENV: 'staging' }),
      /Invalid NODE_ENV/
    );
  });

  test('FRONTEND_URL parses single origin and multi-origins correctly', () => {
    const singleConfig = validateConfig({
      ...validBaseEnv,
      FRONTEND_URL: 'https://dheekshainsurance.com',
    });
    assert.deepEqual(singleConfig.frontendOrigins, ['https://dheekshainsurance.com']);

    const multiConfig = validateConfig({
      ...validBaseEnv,
      FRONTEND_URL: 'https://dheekshainsurance.com, https://www.dheekshainsurance.com , http://localhost:5173',
    });
    assert.deepEqual(multiConfig.frontendOrigins, [
      'https://dheekshainsurance.com',
      'https://www.dheekshainsurance.com',
      'http://localhost:5173',
    ]);
  });

  test('FRONTEND_URL rejects origins with paths, query params, or hash fragments', () => {
    assert.throws(
      () => validateConfig({ ...validBaseEnv, FRONTEND_URL: 'https://dheekshainsurance.com/api' }),
      /must not contain a path/
    );
    assert.throws(
      () => validateConfig({ ...validBaseEnv, FRONTEND_URL: 'https://dheekshainsurance.com?lang=ta' }),
      /must not contain query parameters/
    );
    assert.throws(
      () => validateConfig({ ...validBaseEnv, FRONTEND_URL: 'https://dheekshainsurance.com#section' }),
      /must not contain a hash fragment/
    );
    assert.throws(
      () => validateConfig({ ...validBaseEnv, FRONTEND_URL: 'ftp://dheekshainsurance.com' }),
      /Only http: and https: are allowed/
    );
  });

  test('DATABASE_URL is required when requireDb is true', () => {
    const envWithoutDb = { ...validBaseEnv };
    delete envWithoutDb.DATABASE_URL;

    // Allowed when requireDb is false
    const configNoDb = validateConfig(envWithoutDb, { requireDb: false });
    assert.equal(configNoDb.DATABASE_URL, null);

    // Rejected when requireDb is true
    assert.throws(
      () => validateConfig(envWithoutDb, { requireDb: true }),
      /DATABASE_URL is required when database connectivity is enabled/
    );
  });

  test('DATABASE_URL rejects invalid URI schemes', () => {
    assert.throws(
      () => validateConfig({ ...validBaseEnv, DATABASE_URL: 'postgres://user:pass@localhost/db' }),
      /Invalid DATABASE_URL scheme/
    );
  });

  test('Missing both ADMIN_EMAIL and ADMIN_PASSWORD produces null credentials safely', () => {
    const config = validateConfig(validBaseEnv);
    assert.equal(config.ADMIN_EMAIL, null);
    assert.equal(config.ADMIN_PASSWORD, null);
    assert.equal(config.isInitialAdminConfigured, false);
  });

  test('Providing only ADMIN_EMAIL throws configuration error without leaking values', () => {
    const testEmail = 'admin@dheekshainsurance.com';
    assert.throws(
      () => validateConfig({ ...validBaseEnv, ADMIN_EMAIL: testEmail }),
      (err) => {
        assert.match(err.message, /Incomplete administrator credentials: both ADMIN_EMAIL and ADMIN_PASSWORD must be provided/);
        assert.doesNotMatch(err.message, new RegExp(testEmail));
        return true;
      }
    );
  });

  test('Providing only ADMIN_PASSWORD throws configuration error without leaking secret values', () => {
    const testSecretPass = 'SecretAdminPassword123!';
    assert.throws(
      () => validateConfig({ ...validBaseEnv, ADMIN_PASSWORD: testSecretPass }),
      (err) => {
        assert.match(err.message, /Incomplete administrator credentials: both ADMIN_EMAIL and ADMIN_PASSWORD must be provided/);
        assert.doesNotMatch(err.message, new RegExp(testSecretPass));
        return true;
      }
    );
  });

  test('Providing both valid ADMIN_EMAIL and ADMIN_PASSWORD normalizes email and sets isInitialAdminConfigured', () => {
    const config = validateConfig({
      ...validBaseEnv,
      ADMIN_EMAIL: '  Admin.Test@DheekshaInsurance.com  ',
      ADMIN_PASSWORD: 'ValidAdminPassword123!',
    });
    assert.equal(config.ADMIN_EMAIL, 'admin.test@dheekshainsurance.com');
    assert.equal(config.ADMIN_PASSWORD, 'ValidAdminPassword123!');
    assert.equal(config.isInitialAdminConfigured, true);
  });

  test('Invalid ADMIN_EMAIL syntax throws clear error without leaking sensitive values', () => {
    assert.throws(
      () =>
        validateConfig({
          ...validBaseEnv,
          ADMIN_EMAIL: 'not-an-email',
          ADMIN_PASSWORD: 'ValidAdminPassword123!',
        }),
      (err) => {
        assert.match(err.message, /Invalid ADMIN_EMAIL: must be a valid email address/);
        return true;
      }
    );
  });

  test('ADMIN_PASSWORD shorter than 8 characters is rejected without leaking password', () => {
    const shortSecret = 'short';
    assert.throws(
      () =>
        validateConfig({
          ...validBaseEnv,
          ADMIN_EMAIL: 'admin@dheekshainsurance.com',
          ADMIN_PASSWORD: shortSecret,
        }),
      (err) => {
        assert.match(err.message, /Invalid ADMIN_PASSWORD: password must be at least 8 characters long/);
        assert.doesNotMatch(err.message, new RegExp(shortSecret));
        return true;
      }
    );
  });
});

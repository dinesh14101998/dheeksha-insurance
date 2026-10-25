import dotenv from 'dotenv';

// Load .env only in non-production environments if not already loaded
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const VALID_ENVIRONMENTS = new Set(['development', 'test', 'production']);

/**
 * Parses and normalizes the TRUST_PROXY environment variable.
 * Default: false (safe default; direct connection, does not trust unverified forwarded headers).
 *
 * Supported values:
 * - false / 0: Do not trust proxies (direct connections).
 * - true: Trust all proxies (use with caution).
 * - integer >= 0 (e.g. 1): Trust n upstream proxy hops (e.g., 1 for Nginx on localhost).
 * - string / subnet list (e.g. 'loopback', '127.0.0.1, ::1'): Trust specific proxy IP(s).
 *
 * @param {string | undefined | null} rawValue
 * @returns {boolean | number | string}
 */
export function parseTrustProxy(rawValue) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return false;
  }

  const trimmed = String(rawValue).trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'false' || lower === '0') {
    return false;
  }

  if (lower === 'true') {
    return true;
  }

  // Integer hop count (e.g. 1, 2)
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // IP, subnet identifier, or comma-separated list (e.g. "loopback", "127.0.0.1", "127.0.0.1, ::1")
  if (/^[a-zA-Z0-9.,:\s/-]+$/.test(trimmed)) {
    return trimmed;
  }

  throw new Error(
    `Invalid TRUST_PROXY: "${trimmed}". Must be a boolean ("true"/"false"), positive integer hop count (e.g. "1"), or IP/subnet identifier (e.g. "loopback").`
  );
}

/**
 * Validates and normalizes environment configuration.
 * Never logs or returns secret values in error messages.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @param {Object} [options={}]
 * @param {boolean} [options.requireDb=false] - When true, enforces presence of DATABASE_URL
 * @returns {Object} Normalized, validated configuration object
 */
export function validateConfig(env = process.env, options = {}) {
  const { requireDb = false } = options;

  // 1. NODE_ENV validation
  const nodeEnv = (env.NODE_ENV || 'development').trim().toLowerCase();
  if (!VALID_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV: "${nodeEnv}". Allowed values: development, test, production.`
    );
  }

  // 2. PORT validation (1 - 65535)
  const rawPort = env.PORT !== undefined ? String(env.PORT).trim() : '8000';
  if (!rawPort) {
    throw new Error('Invalid PORT: "". Must be a valid integer between 1 and 65535.');
  }
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535 || String(port) !== rawPort) {
    throw new Error(`Invalid PORT: "${rawPort}". Must be a valid integer between 1 and 65535.`);
  }

  // 3. HOST
  const host = env.HOST || '0.0.0.0';

  // 4. SECRET_KEY validation (minimum 32 characters, no value printed on failure)
  const rawSecret = env.SECRET_KEY;
  if (!rawSecret || typeof rawSecret !== 'string' || rawSecret.trim().length < 32) {
    throw new Error('SECRET_KEY must be a cryptographically secure string with at least 32 characters.');
  }
  const secretKey = rawSecret.trim();

  // 5. ACCESS_TOKEN_EXPIRE_MINUTES validation (positive integer, default: 120)
  const rawExpiry = env.ACCESS_TOKEN_EXPIRE_MINUTES || '120';
  const tokenExpireMinutes = parseInt(rawExpiry, 10);
  if (isNaN(tokenExpireMinutes) || tokenExpireMinutes <= 0 || String(tokenExpireMinutes) !== String(rawExpiry).trim()) {
    throw new Error(
      `Invalid ACCESS_TOKEN_EXPIRE_MINUTES: "${rawExpiry}". Must be a positive integer.`
    );
  }

  // 6. DATABASE_URL validation (required only when requireDb is true)
  let databaseUrl = null;
  const rawDbUrl = env.DATABASE_URL;
  if (rawDbUrl && typeof rawDbUrl === 'string' && rawDbUrl.trim()) {
    const trimmedDbUrl = rawDbUrl.trim();
    if (
      !trimmedDbUrl.startsWith('mysql://') &&
      !trimmedDbUrl.startsWith('mysql2://') &&
      !trimmedDbUrl.startsWith('mariadb://')
    ) {
      throw new Error(
        'Invalid DATABASE_URL scheme. Expected mysql://, mysql2://, or mariadb:// connection URL.'
      );
    }
    databaseUrl = trimmedDbUrl;
  } else if (requireDb) {
    throw new Error('DATABASE_URL is required when database connectivity is enabled.');
  }

  // 7. FRONTEND_URL parsing & origin validation
  const rawFrontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const rawOrigins = rawFrontendUrl.split(',').map((o) => o.trim()).filter(Boolean);

  if (rawOrigins.length === 0) {
    throw new Error('FRONTEND_URL must contain at least one valid origin.');
  }

  const frontendOrigins = [];
  for (const originStr of rawOrigins) {
    let parsedUrl;
    try {
      parsedUrl = new URL(originStr);
    } catch {
      throw new Error(`Invalid FRONTEND_URL origin: "${originStr}". Must be a valid URL.`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `Invalid protocol in FRONTEND_URL origin "${originStr}". Only http: and https: are allowed.`
      );
    }

    if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
      throw new Error(
        `Invalid FRONTEND_URL origin "${originStr}". Origins must not contain a path.`
      );
    }

    if (parsedUrl.search) {
      throw new Error(
        `Invalid FRONTEND_URL origin "${originStr}". Origins must not contain query parameters.`
      );
    }

    if (parsedUrl.hash) {
      throw new Error(
        `Invalid FRONTEND_URL origin "${originStr}". Origins must not contain a hash fragment.`
      );
    }

    frontendOrigins.push(parsedUrl.origin);
  }

  // 8. Administrative credentials (ADMIN_EMAIL, ADMIN_PASSWORD)
  const rawAdminEmail = env.ADMIN_EMAIL !== undefined ? String(env.ADMIN_EMAIL).trim() : '';
  const rawAdminPassword = env.ADMIN_PASSWORD !== undefined ? String(env.ADMIN_PASSWORD).trim() : '';

  const hasAdminEmail = Boolean(rawAdminEmail);
  const hasAdminPassword = Boolean(rawAdminPassword);

  let adminEmail = null;
  let adminPassword = null;

  if (hasAdminEmail !== hasAdminPassword) {
    throw new Error(
      'Incomplete administrator credentials: both ADMIN_EMAIL and ADMIN_PASSWORD must be provided if either is configured.'
    );
  }

  if (hasAdminEmail && hasAdminPassword) {
    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(rawAdminEmail)) {
      throw new Error('Invalid ADMIN_EMAIL: must be a valid email address.');
    }

    // Validate password security requirements (at least 8 characters)
    if (rawAdminPassword.length < 8) {
      throw new Error('Invalid ADMIN_PASSWORD: password must be at least 8 characters long.');
    }

    adminEmail = rawAdminEmail.toLowerCase();
    adminPassword = rawAdminPassword;
  }

  // 9. Reverse Proxy Trust Configuration (TRUST_PROXY)
  // Default: false (direct connections, never trust arbitrary client-supplied X-Forwarded-For)
  // Production behind single reverse proxy (e.g. Nginx on localhost): 1 (or 'loopback')
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    HOST: host,
    SECRET_KEY: secretKey,
    ACCESS_TOKEN_EXPIRE_MINUTES: tokenExpireMinutes,
    DATABASE_URL: databaseUrl,
    FRONTEND_URL: rawFrontendUrl,
    frontendOrigins,
    TRUST_PROXY: trustProxy,
    // Administrative credentials and status
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    isInitialAdminConfigured: Boolean(adminEmail && adminPassword),
    // SMTP & Email Notification configuration
    SMTP_HOST: env.SMTP_HOST ? env.SMTP_HOST.trim() : 'smtp.gmail.com',
    SMTP_PORT: (() => {
      const rawPort = env.SMTP_PORT !== undefined ? String(env.SMTP_PORT).trim() : '587';
      const parsed = parseInt(rawPort, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== rawPort) {
        throw new Error(`Invalid SMTP_PORT: "${rawPort}". Must be a valid port integer between 1 and 65535.`);
      }
      return parsed;
    })(),
    SMTP_SECURE: env.SMTP_SECURE === 'true' || env.SMTP_SECURE === '1',
    SMTP_USER: env.SMTP_USER?.trim() || env.SMTP_EMAIL?.trim() || null,
    SMTP_PASSWORD: env.SMTP_PASSWORD?.trim() || env.SMTP_APP_PASSWORD?.trim() || null,
    NOTIFICATION_EMAIL: env.NOTIFICATION_EMAIL?.trim() || env.ENQUIRY_NOTIFICATION_EMAIL?.trim() || 'neelkanthbpvi@gmail.com',
    // Backwards compatibility aliases
    SMTP_EMAIL: env.SMTP_USER?.trim() || env.SMTP_EMAIL?.trim() || null,
    SMTP_APP_PASSWORD: env.SMTP_PASSWORD?.trim() || env.SMTP_APP_PASSWORD?.trim() || null,
    ENQUIRY_NOTIFICATION_EMAIL: env.NOTIFICATION_EMAIL?.trim() || env.ENQUIRY_NOTIFICATION_EMAIL?.trim() || 'neelkanthbpvi@gmail.com',
    // Helper indicating if email notifications are fully configured
    isEmailConfigured: Boolean((env.SMTP_USER?.trim() || env.SMTP_EMAIL?.trim()) && (env.SMTP_PASSWORD?.trim() || env.SMTP_APP_PASSWORD?.trim())),
  };
}

let cachedConfig = null;

/**
 * Returns cached configuration or initializes from process.env.
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function getConfig(options = {}) {
  if (!cachedConfig) {
    cachedConfig = validateConfig(process.env, options);
  }
  return cachedConfig;
}

/**
 * Resets cached configuration (primarily for testing).
 */
export function resetConfig() {
  cachedConfig = null;
}

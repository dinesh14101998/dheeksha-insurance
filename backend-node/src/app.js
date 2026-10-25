import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { checkDatabaseHealth } from './config/database.js';
import { getConfig } from './config/env.js';
import apiRouter from './routes/index.js';

const app = express();

// Disable X-Powered-By header for security hardening
app.disable('x-powered-by');

// Configure Reverse Proxy Trust
// In local/direct development, defaults to false (ignoring unverified X-Forwarded-* headers).
// Behind a single reverse proxy (e.g., Nginx on localhost or Docker network), set TRUST_PROXY=1 or loopback.
let trustProxySetting = false;
try {
  const config = getConfig();
  if (config?.TRUST_PROXY !== undefined) {
    trustProxySetting = config.TRUST_PROXY;
  }
} catch {
  // In test harness without full config, fallback safely to false
}
app.set('trust proxy', trustProxySetting);

// HTTP Security Headers via Helmet
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    // Disable CSP on API backend: API endpoints return JSON, not HTML/scripts.
    // The frontend SPA web server / Nginx enforces the client Content-Security-Policy.
    contentSecurityPolicy: false,

    // Allow cross-origin consumers (React frontend on localhost:5173 or production domain)
    // to read API responses according to the configured CORS policy.
    crossOriginResourcePolicy: { policy: 'cross-origin' },

    // Enable HSTS (Strict-Transport-Security) only in production environments.
    // Avoids enforcing HTTPS during local HTTP development or in automated test suites.
    hsts: isProduction
      ? {
          maxAge: 31536000, // 1 year
          includeSubDomains: true,
          preload: false,
        }
      : false,
  })
);

// CORS configuration supporting multi-origin allowlist
app.use((req, res, next) => {
  let allowedOrigins = ['http://localhost:5173'];
  try {
    const config = getConfig();
    if (config?.frontendOrigins?.length > 0) {
      allowedOrigins = config.frontendOrigins;
    }
  } catch {
    // In test harness without full config, fallback safely
  }

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })(req, res, next);
});

// JSON body parsing with reasonable size limit (100kb)
app.use(express.json({ limit: '100kb' }));

// URL-encoded body parsing with reasonable size limit (100kb) - required for OAuth2 form login
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Catch malformed JSON body parse errors and return FastAPI-compatible HTTP 422
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(422).json({
      detail: [{ loc: ['body'], msg: 'JSON decode error' }],
    });
  }
  next(err);
});

// Health Check Endpoint verifying database connectivity
app.get('/api/health', async (req, res, next) => {
  try {
    const dbHealth = await checkDatabaseHealth();

    if (!dbHealth.connected) {
      return res.status(503).json({
        status: 'error',
        message: 'Database is unavailable.',
        database: 'disconnected',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Dheeksha Insurance API (Node.js) is running.',
      database: 'connected',
      version: '1.0.0',
    });
  } catch (err) {
    next(err);
  }
});

// Mount business routes under /api/v1
app.use('/api/v1', apiRouter);

// Centralized 404 Handler for Unmatched Routes
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    detail: 'Not Found',
  });
};
app.use(notFoundHandler);

// Centralized Error Handler (Does not leak stack traces in production)
export const errorHandler = (err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const statusCode = err.status || err.statusCode || 500;

  res.status(statusCode).json({
    detail: isProduction && statusCode === 500
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error',
    ...(isProduction ? {} : { stack: err.stack }),
  });
};
app.use(errorHandler);

export default app;

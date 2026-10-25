import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import app from '../src/app.js';
import { parseTrustProxy } from '../src/config/env.js';

describe('HTTP Security Headers and Proxy Trust Hardening Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // =========================================================================
  // 1. HTTP Security Headers (Helmet)
  // =========================================================================
  test('Helmet sets standard security headers on API responses', async () => {
    const res = await fetch(`${baseUrl}/api/v1`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('x-download-options'), 'noopen');
    assert.equal(res.headers.get('x-dns-prefetch-control'), 'off');
    assert.equal(res.headers.get('x-permitted-cross-domain-policies'), 'none');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  test('X-Powered-By header is suppressed on all responses', async () => {
    const res = await fetch(`${baseUrl}/api/v1`);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('HSTS (Strict-Transport-Security) is disabled in non-production environments', async () => {
    const res = await fetch(`${baseUrl}/api/v1`);
    assert.equal(res.headers.get('strict-transport-security'), null);
  });

  test('HSTS is correctly enabled when configured in production environment', async () => {
    // Spin up an isolated Express instance configured with production HSTS
    const prodApp = express();
    prodApp.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false,
        },
      })
    );
    prodApp.get('/test-hsts', (req, res) => res.json({ ok: true }));

    const prodServer = http.createServer(prodApp);
    await new Promise((resolve) => prodServer.listen(0, '127.0.0.1', resolve));
    const port = prodServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/test-hsts`);
      const hstsHeader = res.headers.get('strict-transport-security');
      assert.ok(hstsHeader, 'Strict-Transport-Security header must be present in production');
      assert.match(hstsHeader, /max-age=31536000/);
      assert.match(hstsHeader, /includeSubDomains/);
    } finally {
      await new Promise((resolve) => prodServer.close(resolve));
    }
  });

  // =========================================================================
  // 2. CORS Compatibility with Helmet
  // =========================================================================
  test('CORS headers coexist cleanly with Helmet security headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1`, {
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  test('OPTIONS preflight requests return CORS headers alongside security headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/enquiries`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });

    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.ok(res.headers.get('access-control-allow-methods'));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  // =========================================================================
  // 3. Proxy Trust Configuration and IP Resolution
  // =========================================================================
  test('Default app instance has trust proxy configured from environment (default: false)', () => {
    assert.equal(app.get('trust proxy'), false);
  });

  test('When trust proxy is false, spoofed X-Forwarded-For is ignored', async () => {
    const directApp = express();
    directApp.set('trust proxy', false);
    directApp.get('/probe', (req, res) => res.json({ ip: req.ip, ips: req.ips }));

    const directServer = http.createServer(directApp);
    await new Promise((resolve) => directServer.listen(0, '127.0.0.1', resolve));
    const port = directServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/probe`, {
        headers: {
          'X-Forwarded-For': '203.0.113.195',
        },
      });

      const data = await res.json();
      assert.notEqual(data.ip, '203.0.113.195');
      assert.ok(data.ip === '127.0.0.1' || data.ip === '::ffff:127.0.0.1' || data.ip === '::1');
      assert.deepEqual(data.ips, []);
    } finally {
      await new Promise((resolve) => directServer.close(resolve));
    }
  });

  test('When trust proxy is 1 (hop count), client IP is correctly resolved from X-Forwarded-For', async () => {
    const proxyApp = express();
    proxyApp.set('trust proxy', 1);
    proxyApp.get('/probe', (req, res) => res.json({ ip: req.ip, ips: req.ips }));

    const proxyServer = http.createServer(proxyApp);
    await new Promise((resolve) => proxyServer.listen(0, '127.0.0.1', resolve));
    const port = proxyServer.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/probe`, {
        headers: {
          'X-Forwarded-For': '203.0.113.195',
        },
      });

      const data = await res.json();
      assert.equal(data.ip, '203.0.113.195');
      assert.deepEqual(data.ips, ['203.0.113.195']);
    } finally {
      await new Promise((resolve) => proxyServer.close(resolve));
    }
  });

  // =========================================================================
  // 4. parseTrustProxy Helper Tests
  // =========================================================================
  test('parseTrustProxy parses all supported configurations correctly', () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy(null), false);
    assert.equal(parseTrustProxy(''), false);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('0'), false);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('2'), 2);
    assert.equal(parseTrustProxy('loopback'), 'loopback');
    assert.equal(parseTrustProxy('127.0.0.1'), '127.0.0.1');
    assert.equal(parseTrustProxy('127.0.0.1, ::1'), '127.0.0.1, ::1');
  });

  test('parseTrustProxy throws error on invalid configurations', () => {
    assert.throws(
      () => parseTrustProxy('invalid!@#$%^&*()'),
      /Invalid TRUST_PROXY/
    );
  });
});

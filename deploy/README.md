# Dheeksha Insurance — Deployment & Operations Guide

This directory contains production deployment resources, server configuration templates, security hardening standards, and verification checklists for the Dheeksha Insurance web application.

---

## Directory Overview

```text
deploy/
├── README.md                                    # This deployment and operations guide
├── OPERATIONS.md                                # Permissions, database least-privilege, and backup architecture
├── STAGING_CHECKLIST.md                         # 17-point staging verification runbook
├── nginx/
│   └── dheeksha-insurance.conf.example         # Production Nginx reverse proxy and static server template
├── systemd/
│   └── dheeksha-backend.service.example        # Hardened Linux systemd service unit template
└── logrotate/
    └── dheeksha-nginx.logrotate.example        # Optional Nginx log rotation template
```

---

## 1. Frontend Build Process

The frontend is a single-page application (SPA) built with React 19, Vite, Tailwind CSS v4, and React Router v7.

### Build Instructions

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies (ensure clean install via lockfile):
   ```bash
   npm ci
   ```

3. Set the required build-time environment variable(s) and compile the production bundle:
   ```bash
   # Option A: Same-origin API reverse proxy (Recommended with Nginx template)
   VITE_API_BASE_URL="/api/v1" npm run build

   # Option B: Dedicated API domain
   VITE_API_BASE_URL="https://api.yourdomain.com/api/v1" npm run build
   ```

4. The compiled production bundle will be generated in `frontend/dist/`.

---

## 2. Environment Variables & Security Considerations

### Build-Time vs. Runtime Variables

Vite statically bakes all variables prefixed with `VITE_` into JavaScript and CSS bundles during `npm run build`:

* **`VITE_API_BASE_URL`**: Specifies the base URL prefix for API requests made by the browser (e.g. `/api/v1` or `https://api.yourdomain.com/api/v1`).

### CRITICAL: Why `VITE_*` Variables Must Never Contain Secrets

1. **Client-Side Exposure**: Any variable prefixed with `VITE_` is compiled directly into plaintext client-side JavaScript assets.
2. **Publicly Inspectable**: Anyone opening the browser DevTools, viewing page source, or reading downloaded `.js` bundles can view these values.
3. **Strict Prohibition**: Never place database credentials, JWT secrets, SMTP passwords, private API keys, or encryption keys in frontend environment files (`.env` or `.env.production`). Backend secrets belong exclusively in `backend-node/.env` on the server.

---

## 3. Why SPA Fallback is Required

React Router handles client-side routing within the browser (e.g., `/services`, `/vehicles`, `/claim-process`, `/admin/login`, `/admin/dashboard`).

* **The Problem**: When a user navigates to `/admin/dashboard` in the browser and refreshes the page (or clicks a direct link), the browser sends an HTTP GET request to the Nginx server for `/admin/dashboard`. Since no physical directory or file named `admin/dashboard` exists on the server filesystem, Nginx returns a `404 Not Found` error by default.
* **The Solution**: The Nginx directive:
  ```nginx
  location / {
      try_files $uri $uri/ /index.html;
  }
  ```
  instructs Nginx to check if a physical file or directory matches `$uri`. If none exists, Nginx serves `index.html` with an HTTP 200 status, allowing React Router to initialize and mount the correct client-side route.

---

## 4. Reviewing and Customizing the Nginx Template

An example Nginx configuration template is provided at:
[`deploy/nginx/dheeksha-insurance.conf.example`](./nginx/dheeksha-insurance.conf.example)

Before deploying this configuration:

1. **Verify Placeholders**: Replace all values enclosed in `<ANGLE_BRACKETS>`:
   * `<DOMAIN_NAME>`: Fully qualified domain name (e.g., `dheekshainsurance.com`).
   * `<PATH_TO_SSL_CERTIFICATE>`: Path to SSL certificate full chain (e.g., `/etc/letsencrypt/live/dheekshainsurance.com/fullchain.pem`).
   * `<PATH_TO_SSL_CERTIFICATE_KEY>`: Path to SSL private key (e.g., `/etc/letsencrypt/live/dheekshainsurance.com/privkey.pem`).
   * `<PATH_TO_FRONTEND_DIST>`: Absolute path to the built frontend directory (e.g., `/var/www/dheeksha-insurance/frontend/dist`).
   * `<ACME_WEBROOT_PATH>`: Webroot for Let's Encrypt renewal challenges (e.g., `/var/www/certbot`).

2. **Proxy Trust Alignment with Express**:
   * The Node.js Express backend in `backend-node/` respects the `TRUST_PROXY` environment variable (configured via `backend-node/.env`).
   * When Nginx acts as the primary reverse proxy on the same server, set:
     ```env
     TRUST_PROXY="1"
     ```
     in `backend-node/.env`.
   * In `dheeksha-insurance.conf.example`, Nginx sets:
     ```nginx
     proxy_set_header X-Forwarded-For $remote_addr;
     proxy_set_header X-Forwarded-Proto $scheme;
     ```
     This ensures Express correctly identifies client IP addresses for rate limiting on `/api/v1/auth/login` and `/api/v1/enquiries`.

3. **Content Security Policy (CSP)**:
   * The provided CSP is configured to support Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) and Unsplash images (`images.unsplash.com`).
   * `index.html` includes an inline script to prevent Flash of Unstyled Content (FOUC) when reading theme/language preferences from `localStorage`. Therefore, `script-src` includes `'unsafe-inline'`. For stricter environments, calculate and use the SHA-256 hash of that inline script.

4. **Testing Nginx Configuration**:
   Before reloading Nginx, always validate the syntax:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 5. Reviewing and Installing the systemd Service

An example systemd service unit template is provided at:
[`deploy/systemd/dheeksha-backend.service.example`](./systemd/dheeksha-backend.service.example)

### Key Architectural & Hardening Considerations:
1. **Dedicated User**: Runs under an unprivileged user (`User=<SERVICE_USER>`), never as `root`.
2. **Environment File**: Loads production secrets via `EnvironmentFile=<SECRETS_PATH>/backend.env` (restricted to `chmod 0640`).
3. **Graceful Shutdown**: Sends `SIGTERM` with `TimeoutStopSec=15s`, allowing Node.js to drain connections and cleanly close the MariaDB connection pool.
4. **Filesystem Sandbox**: Mounts the system read-only (`ProtectSystem=strict`, `ReadOnlyPaths=<APP_DIR>/backend-node`) with an isolated `/tmp` (`PrivateTmp=true`).
5. **Node.js JIT Compatibility**: `MemoryDenyWriteExecute` is intentionally omitted because the V8 engine requires writable and executable memory pages for JIT compilation.

---

## 6. Operations & Staging Runbooks

For in-depth operational procedures, consult:
* **[Production Operations & Security Guide](./OPERATIONS.md)**: Details filesystem permissions, database least-privilege, backup isolation, and `systemd-journald` log retention.
* **[Staging Verification Checklist](./STAGING_CHECKLIST.md)**: A complete 17-point pre-flight checklist covering health checks, authentication, enquiry processing, CORS, rate limiting, and recovery verification using synthetic test data.

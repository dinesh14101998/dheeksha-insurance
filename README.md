# Dheeksha Insurance

## Project Overview
Dheeksha Insurance is a modern, full-stack web application designed for a local insurance agency in Peravurani, Thanjavur. It provides an intuitive interface for clients to request quotes for vehicle insurance, policy renewals, and claim assistance (supporting both English and Tamil). It also features a secure admin dashboard to manage, track, and update enquiries efficiently.

---

## Architecture & Technology Stack

The application is built on a streamlined, two-tier architecture:

* **Frontend**:
  * React 19 (Single Page Application)
  * Vite
  * Tailwind CSS v4
  * React Router v7
  * Lucide React Icons
* **Backend**:
  * Node.js (v18+)
  * Express.js
  * MariaDB (with connection pooling via `mysql2`)
  * JWT Authentication (`jsonwebtoken`)
  * Bcrypt Password Hashing (`bcryptjs`, 12 salt rounds)
  * Email Notification Service (`nodemailer`)
* **Database**:
  * MariaDB 10.5+ / MySQL 8.0+
  * `InnoDB` storage engine
  * Full Unicode & Tamil support via `utf8mb4` character set and `utf8mb4_unicode_ci` collation

---

## Project Structure

```text
dheeksha-insurance/
├── frontend/          # React + Vite + Tailwind CSS single page application
│   ├── src/           # UI components, pages, routing, and i18n
│   ├── public/        # Static assets
│   ├── package.json   # Frontend dependencies and build scripts
│   └── .env.example   # Frontend configuration template
└── backend-node/      # Node.js + Express API backend
    ├── src/           # Controllers, routes, services, middleware, and config
    │   ├── config/    # Environment configuration, database pool, and schema.sql
    │   ├── scripts/   # initDb.js, verifyApplication.js, verifySmtp.js
    │   └── server.js  # Server bootstrap, admin auto-seeding, and lifecycle
    ├── tests/         # Unit and integration test suites
    ├── package.json   # Backend dependencies and test scripts
    └── .env.example   # Backend configuration template
```

---

## Environment Configuration

Configuration is managed via environment variables. Copy `.env.example` to `.env` in both `frontend/` and `backend-node/`.

### Frontend (`frontend/.env`)
* `VITE_API_BASE_URL`: Base URL for the Express API (e.g., `http://localhost:8000/api/v1`).

### Backend (`backend-node/.env`)
* `NODE_ENV`: Runtime environment (`development`, `test`, or `production`).
* `PORT`: Server port (default: `8000`).
* `HOST`: Server bind address (default: `0.0.0.0`).
* `DATABASE_URL`: Connection string for MariaDB (e.g., `mysql://user:pass@127.0.0.1:3306/dheeksha_insurance`).
* `TEST_DATABASE_URL`: Dedicated connection string strictly targeting `dheeksha_insurance_test` for integration testing.
* `RUN_DB_INTEGRATION_TESTS`: Set to `true` to opt into live MariaDB integration tests.
* `SECRET_KEY`: Cryptographically secure secret string (minimum 32 characters) for signing JWT access tokens.
* `ACCESS_TOKEN_EXPIRE_MINUTES`: JWT validity duration in minutes (default: `120`).
* `FRONTEND_URL`: Allowed origins for CORS (e.g., `http://localhost:5173`).
* `ADMIN_EMAIL`: Initial administrator account email address.
* `ADMIN_PASSWORD`: Initial administrator account password (minimum 8 characters).
* `SMTP_HOST`: SMTP relay server host (e.g., `smtp.gmail.com`).
* `SMTP_PORT`: SMTP port (`587` for STARTTLS, `465` for SSL).
* `SMTP_SECURE`: Set to `false` for port 587 (STARTTLS), `true` for 465.
* `SMTP_USER`: SMTP authentication username (e.g., Gmail address).
* `SMTP_PASSWORD`: SMTP authentication password or App Password.
* `NOTIFICATION_EMAIL`: Business recipient email address for enquiry alerts.
* `SUPPRESS_EMAIL`: Safety flag; set to `true` to suppress outbound SMTP emails during local UI development.

> **Safety Notice**: Never commit `.env` files or expose credentials. Real credentials, app passwords, and secrets are strictly ignored by `.gitignore`.

---

## Getting Started Locally

### 1. Database Setup & Initialization
1. Ensure MariaDB is running locally on `127.0.0.1:3306`.
2. Configure `DATABASE_URL` in `backend-node/.env`.
3. To initialize tables on a clean, empty database, execute the standalone schema initialization script:
   ```bash
   cd backend-node
   npm run db:init -- --confirm
   ```
   * The DDL schema is defined in `backend-node/src/config/schema.sql`.
   * The script inspects existing tables first and will safely exit without altering anything if tables already exist.
   * Target guards strictly block initialization against production databases (`dheeksha_insurance`) or system/unrelated databases (`bitforum`, `foodhunter`).

### 2. Backend Startup
1. Install dependencies:
   ```bash
   cd backend-node
   npm install
   ```
2. Start the development server:
   ```bash
   npm start
   ```
   * On startup, the backend verifies database connectivity and automatically seeds the configured `ADMIN_EMAIL` if absent (passwords are hashed with bcrypt; existing accounts are never overwritten).

### 3. Frontend Startup
1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Start the Vite dev server:
   ```bash
   npm run dev
   ```
   * Access the public website at `http://localhost:5173`.
   * Access the admin dashboard at `http://localhost:5173/admin/login`.

---

## Testing & Verification

The Node.js backend includes comprehensive offline unit tests, live integration tests, and full-application verification.

### Run All Backend Unit Tests (Offline)
```bash
cd backend-node
npm test
```
* Runs 133 unit tests across 12 test suites verifying validation, rate limiting, JWT tokens, bcrypt compatibility, schema definitions, and timezone handling.

### Run Live Database Integration Tests
```bash
cd backend-node
npm run test:integration
```
* Opts into live database testing against `dheeksha_insurance_test`.
* Enforces fail-closed safety guards and active mock email suppression.
* Verifies real MariaDB CRUD, status changes, enquiry notes cascade deletion, SQL injection protection, and rate limiting.

### Run Full Application Verification
```bash
cd backend-node
npm run verify:app
```
* Executes an automated end-to-end verification check against the running frontend and backend.
* Verifies health endpoints, route availability, enquiry validation, MariaDB persistence with Tamil/Unicode text, admin login, search/filtering, note persistence, and cascade deletion.

### Controlled Real SMTP Delivery Verification
```bash
cd backend-node
npm run test:smtp -- --execute-real-smtp
```
* Standalone script for explicitly authorized SMTP delivery testing.
* Inserts a synthetic test enquiry in `dheeksha_insurance_test`, tests SMTP handshake with the upstream relay, and sends one test alert.

---

## Frontend Production Build

To compile the frontend single-page application for production:
```bash
cd frontend
npm run build
```
The optimized static bundle is output to `frontend/dist/` and can be served via Nginx, Caddy, Vercel, or Netlify with SPA fallback routing to `index.html`.

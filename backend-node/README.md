# Dheeksha Insurance — Node.js / Express Backend

A robust, production-ready Node.js and Express backend for Dheeksha Insurance. Migrated from FastAPI with complete API contract parity, strict input validation, rate limiting, and email notification support.

---

## 1. Architecture Overview

- **Runtime**: Node.js $\ge 18$ (ESM modules)
- **Framework**: Express 5
- **Database**: MariaDB / MySQL with connection pooling and transactional support (`mysql2/promise`)
- **Authentication**: OAuth2 Password grant flow with HS256 JWT tokens (`jsonwebtoken`, `bcryptjs`)
- **Rate Limiting**: IP-based rate limiting on public and authentication endpoints (`express-rate-limit`)
- **Email Notifications**: Asynchronous background notifications using Nodemailer with Gmail SMTP (`nodemailer`)
- **Timezone & UTC Integrity**: Explicit UTC handling (`timezone: 'Z'`) in the MariaDB connection pool and deterministic ISO 8601 UTC serialization
- **Testing**: Built-in Node.js test runner (`node:test`, `node:assert/strict`)

---

## 2. Environment Variables

All configuration is validated at runtime on application startup via `src/config/env.js`.

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | string | `development` | Environment mode (`development`, `production`, `test`). |
| `PORT` | number | `8000` | Port on which the HTTP server listens. |
| `HOST` | string | `0.0.0.0` | Bind host address. |
| `SECRET_KEY` | string | *Required* | Cryptographically secure secret key ($\ge 32$ characters) for signing JWTs. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | number | `120` | Access token lifespan in minutes. |
| `DATABASE_URL` | string | `null` | Connection URL for MariaDB/MySQL (`mysql://user:pass@host:3306/db`). |
| `FRONTEND_URL` | string | `http://localhost:5173` | Comma-separated list of allowed CORS origins. |
| `SMTP_HOST` | string | `smtp.gmail.com` | SMTP server hostname. |
| `SMTP_PORT` | number | `587` | SMTP server port (587 for STARTTLS). |
| `SMTP_SECURE` | boolean | `false` | Set `false` for port 587 (STARTTLS), `true` for 465 (SSL). |
| `SMTP_USER` | string | `null` | Gmail address used for authenticating with SMTP. |
| `SMTP_PASSWORD` | string | `null` | 16-character Google App Password (not account password). |
| `NOTIFICATION_EMAIL` | string | `neelkanthbpvi@gmail.com` | Business email recipient for enquiry alerts. |

---

## 3. Email Notification Configuration (Gmail SMTP)

The backend sends email notifications to the business owner whenever a customer submits an enquiry through the website.

### 3.1 Gmail App Password Setup

To use Gmail for automated notifications, you must generate a Google App Password:

1. Log into your Google Account for the business address.
2. Navigate to **Google Account Settings** $\rightarrow$ **Security**.
3. Under *How you sign in to Google*, ensure **2-Step Verification** is turned ON.
4. Search for or navigate to **App passwords** (or go to `https://myaccount.google.com/apppasswords`).
5. Enter an app name, e.g. `Dheeksha Insurance Website`, and click **Create**.
6. Google will generate a 16-character password (e.g. `abcd efgh ijkl mnop`).
7. Copy this password and paste it into your local `.env` file as `SMTP_PASSWORD`:
   ```env
   SMTP_HOST="smtp.gmail.com"
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER="your-business-email@gmail.com"
   SMTP_PASSWORD="abcdefghijklmnop"
   NOTIFICATION_EMAIL="neelkanthbpvi@gmail.com"
   ```
8. **Security Note**: Never commit or share this App Password. It should only exist in your private, gitignored `.env` file on the deployment host.

### 3.2 Disabling Email Notifications for Local Development

If you are developing locally or running offline tests without an active internet connection or Gmail credentials:

- Leave `SMTP_USER` and `SMTP_PASSWORD` empty or omit them from your `.env` file.
- The server will start normally and log:
  ```
  [EMAIL] Email notifications disabled: SMTP_USER or SMTP_PASSWORD not configured.
  ```
- Enquiry creation endpoints will continue to work normally and will log a safe notice without attempting network connections.

---

## 4. Background Notification Dispatch Architecture

### 4.1 Post-Insert Dispatch Pattern

The enquiry creation flow guarantees that customer enquiries are always recorded first:

1. **Validation**: The incoming request payload is validated against strict schema rules.
2. **Persistence**: The enquiry is saved to MariaDB within the database connection pool.
3. **Response**: The customer receives an immediate `HTTP 201 Created` response with the complete enquiry object.
4. **Asynchronous Dispatch**: The email notification task is dispatched non-blockingly in the background.

### 4.2 Why Email Failure Does Not Roll Back Enquiries

Customer enquiries represent vital business leads. If an email service experiences temporary downtime, rate limits, or network connectivity issues:
- The customer enquiry is **never deleted or rolled back**.
- The customer is not presented with an error.
- The administrator can always view, manage, and respond to the enquiry in the Admin Dashboard.
- A safe error code is logged on the server for troubleshooting without leaking credentials or customer data.

### 4.3 Limitations of In-Process Dispatch

The background dispatch operates asynchronously inside the Node.js process event loop:
- **Pros**: Zero external dependencies (no Redis or message broker required), low resource usage, immediate response times.
- **Trade-off**: In the event of a sudden, ungraceful server termination or power loss precisely during the millisecond window between database write and email delivery, in-flight notifications could be lost.
- For high-volume enterprise architectures requiring guaranteed delivery, an external persistent queue (such as BullMQ with Redis or AWS SQS) could be layered in without altering the endpoint contracts.

---

## 5. Security Hardening

- **HTML Injection Prevention**: Dynamic customer input (names, messages, registration numbers) is strictly escaped via `escapeHtml()` before insertion into HTML templates.
- **Plain-Text Alternative**: All emails include a clean plain-text MIME alternative for maximum accessibility and compatibility.
- **Data Privacy**: Customer mobile numbers, WhatsApp numbers, and message contents are not logged in plain text.
- **Credential Protection**: Transporter passwords and secrets are never printed in logs, errors, or API responses.
- **Rate Limiting**: Public enquiry submissions are throttled to 5 requests per minute per client IP.

---

## 6. Running the Automated Tests

The test suite is strictly split between **offline unit tests** and **live database integration tests**.

### 6.1 Offline Unit Tests (Default)

All standard unit tests use isolated mocks and fixtures. **No real emails are sent and no live databases are contacted.**

```bash
cd backend-node
npm test
```

To run a specific unit test suite:
```bash
node --test tests/email.test.js
node --test tests/enquiries.test.js
node --test tests/auth.test.js
node --test tests/timezone.test.js
node --test tests/integrationSafety.test.js
```

### 6.2 Live MariaDB Integration Tests

Live integration tests run via a dedicated test harness with strict fail-closed safety guards:

```bash
cd backend-node
npm run test:integration
```

#### Pre-flight Safety Guarantees & Constraints:
1. **Explicit Opt-In Required**: Live integration tests require `RUN_DB_INTEGRATION_TESTS=true`. If omitted, the harness automatically skips live tests without errors.
2. **Dedicated Test Database URL**: Must be explicitly supplied via `TEST_DATABASE_URL`. The harness **never** falls back to `DATABASE_URL`.
3. **Exact Database Name**: The target database name must be strictly `dheeksha_insurance_test`. Connections to the production database `dheeksha_insurance` or system databases (`mysql`, `sys`, etc.) are unconditionally rejected.
4. **Local-Only Hostname**: Host must be `localhost`, `127.0.0.1`, or `::1`. Remote hosts are strictly prohibited.
5. **Dedicated Least-Privilege Test User**: Cannot run as `root` or an administrative user (`admin`, `administrator`, `sa`). Must use a dedicated test user (e.g. `dheeksha_test_user`).
6. **Mandatory Email Suppression**: Email delivery must be suppressed via mock transporter before integration tests execute.
7. **Schema Provisioning Prerequisite**: The test runner never executes migrations or creates tables automatically. The test schema must be pre-provisioned using the standalone Node.js database initialization script (`npm run db:init -- --confirm`), which executes `backend-node/src/config/schema.sql` (maintaining exact table and column definition parity with historical Alembic revision `78b1008ece61`).
8. **Narrowly-Scoped Cleanup**: Cleanup only deletes test-created records by exact recorded UUIDs (`DELETE FROM enquiries WHERE id IN (?)`). Destructive commands (`TRUNCATE`, `DROP TABLE`, unconstrained `DELETE`) are strictly forbidden.

### 6.3 Standalone Database Schema Initialization

The Node.js backend includes standalone schema provisioning via `backend-node/src/config/schema.sql` and `src/scripts/initDb.js`, completely eliminating any runtime dependency on Python or Alembic.

To initialize a fresh, empty database schema:

```bash
cd backend-node
npm run db:init -- --confirm
```

#### Initialization Safeguards & Constraints:
1. **Explicit Confirmation Required**: Requires the `--confirm` CLI flag (or `CONFIRM_DB_INIT=true` environment variable) to prevent accidental execution.
2. **Fail-Closed Target Protection**: Refuses execution against the production database `dheeksha_insurance`, any database containing `prod`, or system/unrelated databases (`mysql`, `information_schema`, `performance_schema`, `sys`, `bitforum`, `foodhunter`).
3. **Administrative User Rejection**: Prohibits running under administrative accounts (`root`, `admin`, `administrator`, `sa`). A dedicated application user is required.
4. **Non-Destructive Table Check**: Inspects the target database before applying DDL. If tables (`admins`, `enquiries`) already exist, the script safely aborts without dropping, truncating, or altering existing data.
5. **Local-Only Hostname**: Restricts execution strictly to local hostnames (`localhost`, `127.0.0.1`, `::1`).

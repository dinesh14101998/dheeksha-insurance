# Dheeksha Insurance — Staging Verification Checklist & Runbook

This checklist provides a structured, repeatable runbook to verify a new staging deployment of Dheeksha Insurance prior to production cutover.

> **CRITICAL TESTING RULE**:
> - All tests must utilize synthetic test data.
> - Never send real emails to customer or business addresses during staging verification.
> - Ensure `SUPPRESS_EMAIL="true"` or a safe local mail trap (e.g. Mailpit / MailHog) is active before testing enquiry forms.

---

## Pre-Flight Verification Matrix

| Step | Verification Area | Target Endpoint / Action | Expected Result | Pass / Fail |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Environment Validation** | Check `/etc/dheeksha-insurance/backend.env` permissions | File exists, owned by `root:dheeksha`, permissions `0640`. No secrets committed in git. | [ ] |
| **2** | **Backend Service Startup** | `sudo systemctl status dheeksha-backend` | Active: `active (running)`. Process running under unprivileged user `dheeksha`. | [ ] |
| **3** | **API Health Probe** | `curl -f -s http://127.0.0.1:8000/api/health` | Returns HTTP `200` with JSON `{ "status": "success", "database": "connected" }`. | [ ] |
| **4** | **MariaDB Connectivity** | Inspect `journalctl -u dheeksha-backend -n 30` | Startup log indicates `Successfully connected to MariaDB.` Pool initialized with UTF8mb4. | [ ] |
| **5** | **Admin Authentication** | `POST /api/v1/auth/login` with configured admin credentials | Returns HTTP `200` with bearer `access_token` and token type `bearer`. | [ ] |
| **6** | **Enquiry Submission** | `POST /api/v1/enquiries` with synthetic payload | Returns HTTP `201` with generated UUID `id` and status `NEW`. | [ ] |
| **7** | **Payload Validation Guard** | `POST /api/v1/enquiries` with invalid phone/vehicle type | Returns HTTP `422` with structured validation errors; database remains unaltered. | [ ] |
| **8** | **Enquiry Listing & Filtering** | `GET /api/v1/enquiries?limit=10` with admin bearer token | Returns HTTP `200` with paginated synthetic enquiries array and total count. | [ ] |
| **9** | **Enquiry Status Workflow** | `PATCH /api/v1/enquiries/{id}` updating status to `CONTACTED` | Returns HTTP `200` with updated status and valid ISO 8601 UTC timestamp. | [ ] |
| **10** | **Email Behavior & Safety** | Submit synthetic enquiry under `SUPPRESS_EMAIL=true` | Service logs `[EMAIL] Suppressed email notification for enquiry ID: ...` without sending real email. | [ ] |
| **11** | **CORS & Origin Control** | `curl -H "Origin: https://malicious-site.com" -I https://<STAGING_DOMAIN>/api/health` | Disallowed origin does not receive `Access-Control-Allow-Origin: *`. | [ ] |
| **12** | **Proxy-Aware Rate Limiting** | Send 6 rapid invalid login requests from single IP | Returns HTTP `429 Too Many Requests`. Confirms Nginx forwards true client IP to Express. | [ ] |
| **13** | **SPA Route Navigation** | Direct browser access to `/services`, `/vehicles`, `/admin/dashboard` | Nginx `try_files` serves `index.html` (HTTP 200); React Router mounts page without 404. | [ ] |
| **14** | **Browser Console Cleanliness** | Open Browser DevTools on `/`, `/services`, `/contact` | Zero unhandled React render errors, zero network 404s, clean Error Boundary state. | [ ] |
| **15** | **Security Headers & CSP** | `curl -I https://<STAGING_DOMAIN>/` | Headers present: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and valid CSP. | [ ] |
| **16** | **Service Recovery** | `sudo systemctl restart dheeksha-backend` | Service terminates cleanly via `SIGTERM`, restarts within 5s, reconnects to MariaDB. | [ ] |
| **17** | **Backup & Restore Probe** | Test `mariadb-dump` and restore into synthetic test schema | Dump completes cleanly; row count matches live staging database. | [ ] |

---

## Detailed Verification Procedures

### Procedure 1: Environment & Secrets Verification
```bash
# Verify permissions
ls -ld /etc/dheeksha-insurance
ls -l /etc/dheeksha-insurance/backend.env
# Ensure file is readable by dheeksha user and not world-readable (0640)
```

### Procedure 2: Health Check & Systemd Status
```bash
sudo systemctl status dheeksha-backend --no-pager
curl -i http://127.0.0.1:8000/api/health
```

### Procedure 3: Synthetic Enquiry Test Flow
```bash
# Submit synthetic enquiry
curl -i -X POST https://<STAGING_DOMAIN>/api/v1/enquiries \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "Synthetic Test User",
    "phone": "9876543210",
    "whatsapp_number": "9876543210",
    "email": "synthetic-test@example.com",
    "vehicle_type": "Two Wheeler",
    "service_type": "Comprehensive",
    "registration_number": "TN-49-AB-1234",
    "notes": "Automated staging verification probe"
  }'

# Expected response: HTTP 201 Created with JSON body containing generated UUID id
```

### Procedure 4: Rate Limiting Verification
```bash
# Execute rapid requests to trigger rate limit (threshold: 5 attempts per 15 minutes)
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<STAGING_DOMAIN>/api/v1/auth/login \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=invalid@test.com&password=wrongpassword"
done
# Expected: Requests 1-5 return 401 Unauthorized; Request 6 returns 429 Too Many Requests
```

### Procedure 5: Security Headers & CSP Verification
```bash
curl -I https://<STAGING_DOMAIN>/
# Verify presence of:
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN
# Content-Security-Policy: default-src 'self' ...
```

### Procedure 6: SPA Fallback Verification
```bash
# Test direct GET on React Router route
curl -s -o /dev/null -w "%{http_code}\n" https://<STAGING_DOMAIN>/services
curl -s -o /dev/null -w "%{http_code}\n" https://<STAGING_DOMAIN>/admin/dashboard
# Expected: HTTP 200 (not 404)
```

### Procedure 7: Backup & Restore Verification
```bash
# 1. Take snapshot dump of staging database
mariadb-dump --single-transaction --quick dheeksha_insurance > /tmp/staging_backup_test.sql

# 2. Verify file size is non-zero
ls -lh /tmp/staging_backup_test.sql

# 3. Test restoration into isolated temporary database
mariadb -e "CREATE DATABASE IF NOT EXISTS dheeksha_restore_test;"
mariadb dheeksha_restore_test < /tmp/staging_backup_test.sql
mariadb -e "SELECT count(*) FROM dheeksha_restore_test.enquiries;"
mariadb -e "DROP DATABASE dheeksha_restore_test;"
rm -f /tmp/staging_backup_test.sql
```

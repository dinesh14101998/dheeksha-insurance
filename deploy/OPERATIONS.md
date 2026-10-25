# Dheeksha Insurance — Production Operations & Security Guide

This document defines security standards, user permissions, secrets management, database access policies, backup architecture, and logging strategies for production and staging environments.

---

## 1. Linux Service User & Filesystem Permissions

### Principle of Least Privilege
The application must **never run as `root`**.
Running as root exposes the entire operating system to compromise if an unhandled dependency vulnerability or remote code execution flaw occurs.

### Recommended System User Setup
Create an unprivileged system service user and group with no login shell and a locked password:
```bash
sudo useradd -r -s /usr/sbin/nologin -d /var/www/dheeksha-insurance -M dheeksha
```

### Directory Permission Model

| Directory / File | Ownership | Recommended Permissions | Purpose & Rationale |
| :--- | :--- | :--- | :--- |
| `/var/www/dheeksha-insurance` | `root:dheeksha` | `0750` (`rwxr-x---`) | Application root directory; readable and traversable by the service user. |
| `/var/www/dheeksha-insurance/backend-node` | `root:dheeksha` | `0750` (dirs), `0640` (files) | Backend source code and `node_modules`. Read-only at runtime. |
| `/var/www/dheeksha-insurance/frontend/dist` | `root:www-data` | `0755` (dirs), `0644` (files) | Built frontend static assets served directly by Nginx. |
| `/etc/dheeksha-insurance` | `root:dheeksha` | `0750` (`rwxr-x---`) | Protected configuration directory for production secrets. |
| `/etc/dheeksha-insurance/backend.env` | `root:dheeksha` | `0640` (`rw-r-----`) | Production environment file loaded via systemd `EnvironmentFile=`. Only root and the `dheeksha` user can read. |

### Writable Directory Policy
* **Zero Writable Paths at Runtime**: The Dheeksha Insurance backend does not accept file uploads or write local log files.
* Under the systemd unit (`ProtectSystem=strict` and `ReadOnlyPaths=/var/www/dheeksha-insurance/backend-node`), the application source tree is strictly mounted read-only.
* Temporary scratch needs are isolated through `PrivateTmp=true`, ensuring isolated ephemeral storage in `/tmp`.

---

## 2. Secrets Management & Environment Isolation

1. **Storage Location**:
   * Store production environment secrets outside the Git working tree in `/etc/dheeksha-insurance/backend.env`.
   * Enforce strict file permissions:
     ```bash
     sudo chown root:dheeksha /etc/dheeksha-insurance/backend.env
     sudo chmod 0640 /etc/dheeksha-insurance/backend.env
     ```
2. **Secret Content Prohibitions**:
   * Never commit `.env` files, database passwords, JWT secrets, or SMTP credentials to Git.
   * `backend-node/src/config/env.js` intentionally disables `dotenv.config()` in `NODE_ENV=production`. Secrets are passed cleanly through systemd process environment variables.
3. **Secret Generation**:
   * Generate `SECRET_KEY` using high-entropy cryptographic randomness:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

---

## 3. Database Security & Least Privilege

### Why MariaDB Must Not Be Exposed Publicly
* MariaDB must bind strictly to the loopback interface (`127.0.0.1`) or a local Unix socket (`/var/run/mysqld/mysqld.sock`).
* In `/etc/mysql/mariadb.conf.d/50-server.cnf`:
  ```ini
  [mysqld]
  bind-address = 127.0.0.1
  ```
* Enforce host firewall rules (`ufw` or `nftables`) blocking external access to port `3306`.
* Exposing the database port to the public internet enables credential brute-forcing, network sniffing, and direct vulnerability exploitation.

### Application Database User Privileges
The application service user must **never possess schema-administration (DDL) privileges**:
* **Prohibited Privileges**: `DROP`, `ALTER`, `CREATE`, `INDEX`, `GRANT OPTION`, `SUPER`, `FILE`, `PROCESS`.
* **Permitted Privileges**: Strictly Data Manipulation Language (DML) for the application schema:
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON dheeksha_insurance.* TO 'dheeksha_app'@'127.0.0.1' IDENTIFIED BY '<STRONG_PASSWORD>';
  FLUSH PRIVILEGES;
  ```
* Schema migrations (`backend-node/src/config/schema.sql`) and initial table setup (`npm run db:init`) must be run by an administrator or provisioning pipeline using administrative credentials, completely separated from runtime API execution.

---

## 4. Backup Architecture & Storage Segregation

1. **Dedicated Backup User**:
   * Database backups must not use the application database credentials.
   * Create a dedicated backup user with minimal read-only export privileges:
     ```sql
     GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON dheeksha_insurance.* TO 'dheeksha_backup'@'127.0.0.1' IDENTIFIED BY '<BACKUP_PASSWORD>';
     ```
2. **Storage Isolation**:
   * Backups must be stored outside the web root (e.g. `/var/backups/dheeksha-insurance/`).
   * The application service user (`dheeksha`) must **not have read or write access** to backup directories.
   * Ownership of the backup directory should be restricted to root or a dedicated `backup` user (`chmod 0700`).
3. **Automated Backup Strategy**:
   * Use `mariadb-dump` (or `mysqldump`) with transaction consistency:
     ```bash
     mariadb-dump --single-transaction --quick --routines dheeksha_insurance | gzip > /var/backups/dheeksha-insurance/dheeksha_$(date +\%F_\%H\%M\%S).sql.gz
     ```
   * Ship encrypted backups to an off-site object storage bucket (e.g. AWS S3, Cloudflare R2) with versioning and object lock retention policies.

---

## 5. Logging Strategy & Journald Retention

### Node.js Backend Logging
* The application writes operational logs directly to `stdout` and `stderr` as structured streams.
* Under systemd (`deploy/systemd/dheeksha-backend.service.example`), `systemd-journald` captures, timestamps, and indexes all output automatically.
* **No `logrotate` configuration is needed for Node.js**, preventing competing log rotation systems or unmonitored disk usage.

### Journald Retention Policy
Configure retention in `/etc/systemd/journald.conf`:
```ini
[Journal]
Storage=persistent
Compress=yes
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=1month
```
Apply settings with `sudo systemctl restart systemd-journald`.

### Log Querying Commands
* Tail live service logs:
  ```bash
  journalctl -u dheeksha-backend -f
  ```
* View recent error logs:
  ```bash
  journalctl -u dheeksha-backend -p err --since "2 hours ago"
  ```
* Export logs for audit analysis:
  ```bash
  journalctl -u dheeksha-backend --since yesterday > /tmp/backend-audit.log
  ```

### Nginx Logging
* Nginx writes HTTP access and error logs to `/var/log/nginx/`.
* Standard Linux distributions provide `/etc/logrotate.d/nginx` by default.
* If dedicated per-site logs are configured, use [`deploy/logrotate/dheeksha-nginx.logrotate.example`](./logrotate/dheeksha-nginx.logrotate.example) to ensure safe 14-day rotation and `kill -USR1` log reopening.

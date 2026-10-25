import { getConfig } from './config/env.js';
import { initPool, closePool, checkDatabaseHealth } from './config/database.js';
import { seedInitialAdmin } from './services/auth.service.js';
import app from './app.js';

async function bootstrap() {
  // 1. Validate environment configuration before starting the application
  const config = getConfig();

  // 2. Establish application database connection
  if (config.DATABASE_URL) {
    initPool(config.DATABASE_URL);

    // 3. Verify database connectivity
    const health = await checkDatabaseHealth();
    if (!health.connected) {
      console.error('Failed to connect to MariaDB during startup: database unreachable.');
      await closePool();
      process.exit(1);
    }
    console.log('Successfully connected to MariaDB.');

    // 4. Initialize the configured initial administrator according to documented policy
    try {
      await seedInitialAdmin(config);
    } catch (seedErr) {
      console.error('Initial administrator initialization failed:', seedErr.message);
      await closePool();
      process.exit(1);
    }
  } else {
    console.warn('DATABASE_URL not set: running without database connection.');
  }

  // Check email notification configuration status on startup
  if (config.isEmailConfigured) {
    console.log(`Email notifications enabled. Recipient: ${config.NOTIFICATION_EMAIL}`);
  } else {
    console.warn('Email notifications disabled: SMTP_USER or SMTP_PASSWORD not configured.');
  }

  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Dheeksha Insurance Node.js backend listening on http://${config.HOST}:${config.PORT}`);
    console.log(`Environment: ${config.NODE_ENV}`);
    console.log(`Proxy Trust: ${config.TRUST_PROXY !== false ? config.TRUST_PROXY : 'disabled (direct connections)'}`);
  });

  // Graceful Shutdown Handling
  const handleShutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(async (err) => {
      if (err) {
        console.error('Error closing HTTP server:', err);
      }
      try {
        await closePool();
        console.log('Database pool disposed cleanly.');
      } catch (poolErr) {
        console.error('Error disposing database pool:', poolErr);
      }
      process.exit(err ? 1 : 0);
    });

    // Force termination if graceful shutdown exceeds 10 seconds
    setTimeout(() => {
      console.error('Forced shutdown due to timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});

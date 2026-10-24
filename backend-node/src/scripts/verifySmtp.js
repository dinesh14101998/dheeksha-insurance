import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfig } from '../config/env.js';
import { getTransporter, buildEnquiryEmail } from '../services/email.service.js';
import { initPool, query, closePool } from '../config/database.js';

/**
 * Executes a controlled, real SMTP delivery test.
 * Must only be invoked after explicit operator approval.
 *
 * @param {Object} [options={}]
 * @returns {Promise<{ success: boolean, enquiryId: string, recipient: string, accepted: Array<string>, messageId: string }>}
 */
export async function runControlledSmtpTest(options = {}) {
  const config = getConfig();

  if (!config.isEmailConfigured) {
    throw new Error('SMTP credentials are not configured in environment.');
  }

  // Enforce safety: must target only the isolated test database
  const dbUrl = config.DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!dbUrl || !dbUrl.includes('dheeksha_insurance_test')) {
    throw new Error(
      'CRITICAL SAFETY ERROR: Real SMTP delivery test must strictly target dheeksha_insurance_test.'
    );
  }

  const transporter = getTransporter({ ignoreSuppression: true });
  if (!transporter) {
    throw new Error('Could not create Nodemailer transporter.');
  }

  // 1. Verify SMTP connection & authentication
  console.log('[SMTP:TEST] Verifying SMTP server connectivity and authentication...');
  await transporter.verify();
  console.log('[SMTP:TEST] SMTP server connectivity and credentials verified successfully.');

  // 2. Provision synthetic test enquiry in test database
  initPool(dbUrl);
  const testId = crypto.randomUUID();
  const testEnquiry = {
    id: testId,
    full_name: 'Dheeksha SMTP Verification Test',
    mobile_number: '9999999999',
    whatsapp_number: '9999999999',
    vehicle_type: 'two-wheeler',
    vehicle_registration_number: 'TN 49 TEST 0001',
    requirement: 'new-insurance',
    message: 'Controlled verification of real SMTP email delivery for Node.js backend.',
    status: 'NEW',
    created_at: new Date(),
    updated_at: new Date(),
  };

  await query(
    `INSERT INTO enquiries (id, full_name, mobile_number, whatsapp_number, vehicle_type, vehicle_registration_number, requirement, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      testEnquiry.id,
      testEnquiry.full_name,
      testEnquiry.mobile_number,
      testEnquiry.whatsapp_number,
      testEnquiry.vehicle_type,
      testEnquiry.vehicle_registration_number,
      testEnquiry.requirement,
      testEnquiry.message,
      testEnquiry.status,
      testEnquiry.created_at,
      testEnquiry.updated_at,
    ]
  );
  console.log(`[SMTP:TEST] Synthetic test enquiry persisted in isolated test database (ID: ${testId}).`);

  // 3. Build email and send via real transporter
  const mailOptions = buildEnquiryEmail(testEnquiry);
  console.log(`[SMTP:TEST] Dispatching notification to recipient: ${mailOptions.to}`);
  const info = await transporter.sendMail(mailOptions);

  console.log(`[SMTP:TEST] SMTP dispatch complete. Accepted recipients: [${info.accepted.join(', ')}]`);
  console.log(`[SMTP:TEST] Server response: ${info.response}`);

  await closePool();

  return {
    success: true,
    enquiryId: testId,
    recipient: mailOptions.to,
    accepted: info.accepted,
    messageId: info.messageId,
  };
}

// CLI execution (only if called directly with --execute-real-smtp)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--execute-real-smtp')) {
    console.error('SAFETY ERROR: Controlled real SMTP test requires explicit --execute-real-smtp flag.');
    process.exit(1);
  }

  runControlledSmtpTest()
    .then((result) => {
      console.log('[SMTP:TEST] Real delivery test completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[SMTP:TEST] Real delivery test failed: ${err.message}`);
      process.exit(1);
    });
}

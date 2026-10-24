import nodemailer from 'nodemailer';
import { getConfig } from '../config/env.js';

export const VEHICLE_TYPE_LABELS = {
  'two-wheeler': 'Two-Wheeler',
  'private-car': 'Private Car',
  'commercial': 'Commercial Vehicle',
  'heavy': 'Heavy Vehicle',
  'other': 'Other',
};

export const REQUIREMENT_LABELS = {
  'new-insurance': 'New Insurance',
  'renewal': 'Insurance Renewal',
  'claim': 'Claim Assistance',
  'policy': 'Policy Assistance',
  'other': 'Other',
};

/**
 * Returns formatted human-readable label for vehicle type enum.
 * @param {string | null} vehicleType
 * @returns {string}
 */
export function formatVehicleType(vehicleType) {
  if (!vehicleType) return 'Not specified';
  const key = String(vehicleType).toLowerCase().trim();
  return (
    VEHICLE_TYPE_LABELS[key] ||
    vehicleType.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Returns formatted human-readable label for requirement enum.
 * @param {string | null} requirement
 * @returns {string}
 */
export function formatRequirement(requirement) {
  if (!requirement) return 'Not specified';
  const key = String(requirement).toLowerCase().trim();
  return (
    REQUIREMENT_LABELS[key] ||
    requirement.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Formats a submission timestamp into a readable UTC string.
 * @param {Date | string | null} createdAt
 * @returns {string}
 */
export function formatSubmissionTime(createdAt) {
  if (!createdAt) return 'Not available';
  if (createdAt instanceof Date) {
    return isNaN(createdAt.getTime()) ? String(createdAt) : createdAt.toUTCString();
  }
  if (typeof createdAt === 'string') {
    const trimmed = createdAt.trim();
    if (!trimmed) return 'Not available';
    // If in SQL DATETIME format "YYYY-MM-DD HH:MM:SS[.ffffff]", parse as UTC explicitly
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(trimmed) && !trimmed.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      const d = new Date(trimmed.replace(' ', 'T') + 'Z');
      return isNaN(d.getTime()) ? trimmed : d.toUTCString();
    }
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? trimmed : d.toUTCString();
  }
  const d = new Date(createdAt);
  return isNaN(d.getTime()) ? String(createdAt) : d.toUTCString();
}

/**
 * Escapes dynamic customer input to prevent HTML / XSS injection in email clients.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Constructs email options (subject, recipient, text, and safe HTML) for an enquiry.
 *
 * @param {Object} enquiryData
 * @param {Object} [configOverride]
 * @returns {{ from: string, to: string, subject: string, text: string, html: string }}
 */
export function buildEnquiryEmail(enquiryData = {}, configOverride = null) {
  const config = configOverride || getConfig();

  const recipient = config.NOTIFICATION_EMAIL || 'neelkanthbpvi@gmail.com';
  const senderEmail = config.SMTP_USER || 'notifications@dheekshainsurance.com';
  const from = `Dheeksha Insurance <${senderEmail}>`;
  const subject = 'New Customer Enquiry — Dheeksha Insurance';

  const rawName = enquiryData.full_name || 'Valued Customer';
  const rawMobile = enquiryData.mobile_number || 'Not provided';
  const rawWhatsapp = enquiryData.whatsapp_number || 'Not provided';
  const rawVehicle = formatVehicleType(enquiryData.vehicle_type);
  const rawReg = enquiryData.vehicle_registration_number || 'Not provided';
  const rawRequirement = formatRequirement(enquiryData.requirement);
  const rawMessage = enquiryData.message || 'Not provided';
  const rawSubmittedAt = formatSubmissionTime(enquiryData.created_at);
  const rawId = enquiryData.id || 'N/A';

  // Plain-text alternative
  const text = [
    'New Customer Enquiry — Dheeksha Insurance',
    '=========================================',
    '',
    'A customer has submitted a new enquiry through the website:',
    '',
    `Customer Name:           ${rawName}`,
    `Mobile Number:           ${rawMobile}`,
    `WhatsApp Number:         ${rawWhatsapp}`,
    `Vehicle Type:            ${rawVehicle}`,
    `Registration Number:     ${rawReg}`,
    `Requirement:             ${rawRequirement}`,
    `Message:                 ${rawMessage}`,
    '',
    `Submission Time:         ${rawSubmittedAt}`,
    `Enquiry Reference ID:    ${rawId}`,
    '',
    '---',
    'Dheeksha Insurance Notification System',
    'Peravurani, Thanjavur',
  ].join('\n');

  // Safely escaped HTML body
  const safeName = escapeHtml(rawName);
  const safeMobile = escapeHtml(rawMobile);
  const safeWhatsapp = escapeHtml(rawWhatsapp);
  const safeVehicle = escapeHtml(rawVehicle);
  const safeReg = escapeHtml(rawReg);
  const safeRequirement = escapeHtml(rawRequirement);
  const safeMessage = escapeHtml(rawMessage).replace(/\n/g, '<br>');
  const safeSubmittedAt = escapeHtml(rawSubmittedAt);
  const safeId = escapeHtml(rawId);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>New Customer Enquiry</title>
</head>
<body style="margin: 0; padding: 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #F0FAFD; color: #102A43;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(16, 42, 67, 0.08); border: 1px solid #D9EEF4;">
    <tr>
      <td style="background-color: #102A43; padding: 28px 32px; text-align: left;">
        <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">
          Dheeksha Insurance
        </h1>
        <p style="margin: 6px 0 0 0; color: #5CC8E8; font-size: 14px; font-weight: 500;">
          New Website Enquiry Notification
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #526777;">
          A customer has submitted a new vehicle insurance enquiry. The details are provided below:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 14px; line-height: 1.6;">
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #102A43; width: 40%;">Customer Name</td>
            <td style="padding: 10px 0; color: #102A43; font-weight: 600;">${safeName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Mobile Number</td>
            <td style="padding: 10px 0; color: #102A43;">
              <a href="tel:${safeMobile}" style="color: #249FC2; text-decoration: none; font-weight: 600;">${safeMobile}</a>
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">WhatsApp Number</td>
            <td style="padding: 10px 0; color: #102A43;">${safeWhatsapp}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Vehicle Type</td>
            <td style="padding: 10px 0; color: #102A43;">${safeVehicle}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Registration Number</td>
            <td style="padding: 10px 0; color: #102A43;">${safeReg}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Requirement</td>
            <td style="padding: 10px 0; color: #102A43;">${safeRequirement}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777; vertical-align: top;">Message</td>
            <td style="padding: 10px 0; color: #102A43;">${safeMessage}</td>
          </tr>
          <tr style="border-bottom: 1px solid #E2E8F0;">
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Submission Time</td>
            <td style="padding: 10px 0; color: #526777;">${safeSubmittedAt}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: 600; color: #526777;">Reference ID</td>
            <td style="padding: 10px 0; font-family: monospace; font-size: 13px; color: #526777;">${safeId}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="background-color: #F8FAFC; padding: 20px 32px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="margin: 0; font-size: 12px; color: #94A3B8;">
          This is an automated notification from the Dheeksha Insurance website.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { from, to: recipient, subject, text, html };
}

let customTransporter = null;

/**
 * Sets an override transporter (primarily for testing with mocks).
 * @param {Object | null} transporter
 */
export function setTransporter(transporter) {
  customTransporter = transporter;
}

/**
 * Returns active Nodemailer transporter instance, or null if SMTP is unconfigured.
 * @returns {import('nodemailer').Transporter | null}
 */
export function getTransporter(options = {}) {
  if (customTransporter) {
    return customTransporter;
  }

  if (!options?.ignoreSuppression && (process.env.SUPPRESS_EMAIL === 'true' || process.env.EMAIL_SUPPRESSION === 'true')) {
    return null;
  }

  const config = getConfig();
  if (!config.SMTP_USER || !config.SMTP_PASSWORD) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/**
 * Sends enquiry notification email synchronously.
 * Handles timeouts, network failures, and unconfigured states safely without crashing.
 *
 * @param {Object} enquiryData
 * @returns {Promise<{ sent: boolean, reason?: string, error?: string }>}
 */
export async function sendEnquiryNotification(enquiryData) {
  const enquiryId = enquiryData?.id || 'N/A';
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(`[EMAIL] SMTP credentials not configured. Enquiry notification skipped for enquiry ID: ${enquiryId}`);
    return { sent: false, reason: 'unconfigured' };
  }

  try {
    const mailOptions = buildEnquiryEmail(enquiryData);
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Enquiry notification successfully sent for enquiry ID: ${enquiryId}`);
    return { sent: true };
  } catch (err) {
    // Log safe error code without exposing credentials or customer personal info
    console.error(
      `[EMAIL] Failed to send enquiry notification for enquiry ID: ${enquiryId}. Error: ${err.code || err.name || 'UNKNOWN'}`
    );
    return { sent: false, error: err.code || err.name || 'UNKNOWN' };
  }
}

// In-process tracking of pending background notification promises
let pendingDispatches = [];

/**
 * Dispatches an enquiry notification in the background without blocking the HTTP request flow.
 * Catches unhandled rejections to prevent Node.js process crashes.
 *
 * NOTE ON HOSTING TOPOLOGY & DISPATCH:
 * This uses an in-process asynchronous dispatch. If the Node.js process is forcibly
 * terminated or restarted immediately after an HTTP response is sent, queued notifications
 * may not complete. For durable delivery in high-volume environments, an external queue
 * (e.g. BullMQ / Redis) would be used.
 *
 * @param {Object} enquiryData
 * @returns {Promise<{ sent: boolean, reason?: string, error?: string }>}
 */
export function dispatchEnquiryNotification(enquiryData) {
  const promise = (async () => {
    try {
      return await sendEnquiryNotification(enquiryData);
    } catch (err) {
      console.error(
        `[EMAIL] Unexpected dispatch error for enquiry ID: ${enquiryData?.id || 'N/A'}: ${err.code || err.name || 'UNKNOWN'}`
      );
      return { sent: false, error: err.code || err.name || 'UNKNOWN' };
    }
  })();

  pendingDispatches.push(promise);
  promise.finally(() => {
    pendingDispatches = pendingDispatches.filter((p) => p !== promise);
  });

  return promise;
}

/**
 * Waits for all in-flight background notification dispatches to complete.
 * Used by automated tests to synchronize assertions before verifying mocks.
 */
export async function waitForPendingNotifications() {
  await Promise.allSettled(pendingDispatches);
}

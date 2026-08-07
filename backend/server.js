const express = require('express');
const cors = require('cors');
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const googleSheets = require('./googleSheets');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

const CREDENTIAL_TYPES = [
  'State Medical License',
  'DEA Registration',
  'Medicare ID',
  'Medicaid ID',
  'Board Certification',
  'NPI Number',
  'Specialty Certification',
  'Controlled Substance License',
  'Other',
];

const STATUS_TYPES = ['Active', 'Pending Renewal', 'Renewed', 'Expired'];

const REMINDER_SCHEDULES = ['90 days', '60 days', '45 days', '30 days', '15 days', '7 days'];

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePayload(payload) {
  const errors = {};

  if (!payload || typeof payload !== 'object') {
    return { body: 'Invalid or missing JSON payload.' };
  }

  const providerName = payload.providerName || payload.doctorName;
  if (!providerName || String(providerName).trim() === '') {
    errors.providerName = 'Provider Name is required.';
  }

  if (!payload.taxIdNpi || String(payload.taxIdNpi).trim() === '') {
    errors.taxIdNpi = 'Provider Tax ID / NPI is required.';
  }

  const credentialType = payload.credentialType || payload.licenseType;
  if (!credentialType || String(credentialType).trim() === '') {
    errors.credentialType = 'Please select or specify a credential type.';
  }

  const providerNumber = payload.providerNumber || payload.licenseNumber;
  if (!providerNumber || String(providerNumber).trim() === '') {
    errors.providerNumber = 'Provider Number is required.';
  }

  if (!payload.issuingAuthority || String(payload.issuingAuthority).trim() === '') {
    errors.issuingAuthority = 'Issuing Authority is required.';
  }

  const expirationDate = payload.expirationDate || payload.expiryDate;
  if (!expirationDate || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) {
    errors.expirationDate = 'Expiration Date is required in YYYY-MM-DD format.';
  }

  if (!payload.renewalDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.renewalDueDate)) {
    errors.renewalDueDate = 'Renewal Due Date is required in YYYY-MM-DD format.';
  }

  if (!payload.reminderSchedule || String(payload.reminderSchedule).trim() === '') {
    errors.reminderSchedule = 'Reminder Schedule is required.';
  }

  if (!payload.responsiblePerson || String(payload.responsiblePerson).trim() === '') {
    errors.responsiblePerson = 'Responsible Person is required.';
  }

  const coordinatorEmail = payload.coordinatorEmail || payload.notificationEmail;
  if (!coordinatorEmail || !isValidEmail(coordinatorEmail)) {
    errors.coordinatorEmail = 'A valid Coordinator Email is required.';
  }

  if (!payload.status || !STATUS_TYPES.includes(payload.status)) {
    errors.status = 'Please select a valid Status.';
  }

  return Object.keys(errors).length ? errors : null;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseExpiryDate(value) {
  if (!value) return new Date(NaN);
  if (value instanceof Date) return value;
  const dateStr = String(value).split('T')[0];
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day);
}

function getDaysRemaining(expiryDateValue) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiryDate = parseExpiryDate(expiryDateValue);
  if (isNaN(expiryDate.getTime())) return 9999;
  return Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
}

function parseReminderDays(reminderSchedule) {
  if (!reminderSchedule) return 30;
  const match = String(reminderSchedule).match(/\d+/);
  return match ? parseInt(match[0], 10) : 30;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

function isSmtpConfigured() {
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  if (!user || !pass) return false;
  if (user.includes('your-email') || pass.includes('your-gmail-app-password')) return false;
  return true;
}

async function sendAlertEmail(record, daysRemaining) {
  if (!isSmtpConfigured()) {
    console.log(`ℹ️ Email notification skipped for ${record.providerName} (SMTP credentials in backend/.env are default placeholders).`);
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.ALERT_FROM || process.env.SMTP_USER,
    to: record.coordinatorEmail,
    subject: `Credential Renewal Alert — ${record.providerName} (${record.credentialType})`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e2f3; border-radius:16px; overflow:hidden; box-shadow:0 8px 20px rgba(15,23,42,0.08);">
          <div style="background:#4f46e5; color:#ffffff; padding:18px 24px; font-size:20px; font-weight:bold;">Credential Expiration Alert</div>
          <div style="padding:24px; color:#0f172a;">
            <p><strong>Provider Name:</strong> ${record.providerName}</p>
            <p><strong>Tax ID / NPI:</strong> ${record.taxIdNpi}</p>
            <p><strong>Credential Type:</strong> ${record.credentialType}</p>
            <p><strong>Provider Number:</strong> ${record.providerNumber}</p>
            <p><strong>Issuing Authority:</strong> ${record.issuingAuthority}</p>
            <p><strong>Expiration Date:</strong> ${record.expirationDate}</p>
            <p><strong>Renewal Due Date:</strong> ${record.renewalDueDate}</p>
            <p><strong>Responsible Person:</strong> ${record.responsiblePerson}</p>
            <p style="color:${daysRemaining <= 15 ? '#dc2626' : '#d97706'}; font-weight:bold; font-size:18px;">
              <strong>Days Remaining:</strong> ${daysRemaining} day(s)
            </p>
          </div>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Alert sent to ${record.coordinatorEmail} for ${record.providerName}`);
    return true;
  } catch (error) {
    console.warn(`⚠️ Email alert failed for ${record.providerName}:`, error.message);
    return false;
  }
}

async function checkExpiringLicenses() {
  const licenses = await googleSheets.readAllLicenses();

  for (const license of licenses) {
    const daysRemaining = getDaysRemaining(license.expirationDate);
    const reminderDays = parseReminderDays(license.reminderSchedule);

    if (daysRemaining >= 0 && daysRemaining <= reminderDays) {
      try {
        await sendAlertEmail(license, daysRemaining);
      } catch (error) {
        console.warn(`Failed to send email for ${license.providerName}:`, error.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// List all licenses
app.get(['/api/licenses', '/licenses'], async (req, res) => {
  try {
    const licenses = await googleSheets.readAllLicenses();
    res.json(licenses);
  } catch (error) {
    console.error('GET /api/licenses error:', error.message);
    res.status(500).json({ message: 'Unable to read licenses from Google Sheets.', error: error.message });
  }
});

// Export licenses as .xlsx download (reads from Google Sheets, generates xlsx in memory)
app.get(['/api/licenses/export', '/licenses/export'], async (req, res) => {
  try {
    const licenses = await googleSheets.readAllLicenses();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('licenses');

    worksheet.columns = googleSheets.HEADER_ROW.map((header, i) => ({
      header,
      key: googleSheets.COLUMN_KEYS[i],
      width: 24,
    }));

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
        bgColor: { argb: 'FF1E293B' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Add data rows
    for (const lic of licenses) {
      worksheet.addRow(googleSheets.COLUMN_KEYS.map((key) => lic[key] || ''));
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="licenses.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export error:', error.message);
    res.status(500).json({ message: 'Failed to export licenses.', error: error.message });
  }
});

// Add a single license
app.post(['/api/licenses', '/licenses'], async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }

    const errors = validatePayload(body);
    if (errors) {
      return res.status(400).json({ message: 'Validation failed.', errors });
    }

    const newId = `LIC-${Date.now()}`;
    const savedLicense = {
      id: newId,
      providerName: String(body.providerName || body.doctorName).trim(),
      taxIdNpi: String(body.taxIdNpi || '').trim(),
      credentialType: String(body.credentialType || body.licenseType).trim(),
      providerNumber: String(body.providerNumber || body.licenseNumber).trim(),
      issuingAuthority: String(body.issuingAuthority || '').trim(),
      issueDate: body.issueDate || '',
      expirationDate: body.expirationDate || body.expiryDate,
      renewalDueDate: body.renewalDueDate || body.expirationDate || body.expiryDate,
      reminderSchedule: body.reminderSchedule || '30 days',
      responsiblePerson: String(body.responsiblePerson || '').trim(),
      coordinatorEmail: String(body.coordinatorEmail || body.notificationEmail).trim().toLowerCase(),
      status: body.status || 'Active',
      renewalSubmittedDate: body.renewalSubmittedDate || '',
      renewalCompletedDate: body.renewalCompletedDate || '',
      lastReminderSent: body.lastReminderSent || '',
      nextReminderDate: body.nextReminderDate || '',
      createdAt: new Date().toISOString(),
    };

    await googleSheets.addLicense(savedLicense);

    const daysRemaining = getDaysRemaining(savedLicense.expirationDate);
    const reminderDays = parseReminderDays(savedLicense.reminderSchedule);
    let immediateAlert = false;

    if (daysRemaining >= 0 && daysRemaining <= reminderDays) {
      try {
        immediateAlert = await sendAlertEmail(savedLicense, daysRemaining);
      } catch (error) {
        console.warn(`Failed to send immediate alert for ${savedLicense.providerName}:`, error.message);
      }
    }

    res.status(201).json({
      message: 'License saved successfully.',
      license: savedLicense,
      immediateAlert,
      daysRemaining,
    });
  } catch (error) {
    console.error('Error in POST /api/licenses:', error);
    res.status(500).json({ message: `Unable to save license: ${error.message}`, error: error.message });
  }
});

// Download Excel Template for Bulk Register
app.get(['/api/licenses/template', '/licenses/template'], async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('bulk_import_template');

    const TEMPLATE_COLUMNS = [
      { header: 'Provider Name', key: 'providerName', width: 28 },
      { header: 'Provider Tax ID / NPI', key: 'taxIdNpi', width: 24 },
      { header: 'Credential Type', key: 'credentialType', width: 24 },
      { header: 'Provider Number', key: 'providerNumber', width: 24 },
      { header: 'Issuing Authority', key: 'issuingAuthority', width: 24 },
      { header: 'Issue Date', key: 'issueDate', width: 18 },
      { header: 'Expiration Date', key: 'expirationDate', width: 18 },
      { header: 'Renewal Due Date', key: 'renewalDueDate', width: 18 },
      { header: 'Reminder Schedule', key: 'reminderSchedule', width: 20 },
      { header: 'Responsible Person', key: 'responsiblePerson', width: 24 },
      { header: 'Coordinator Email', key: 'coordinatorEmail', width: 30 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Renewal Submitted Date', key: 'renewalSubmittedDate', width: 22 },
      { header: 'Renewal Completed Date', key: 'renewalCompletedDate', width: 22 },
      { header: 'Last Reminder Sent', key: 'lastReminderSent', width: 20 },
      { header: 'Next Reminder Date', key: 'nextReminderDate', width: 20 },
    ];

    worksheet.columns = TEMPLATE_COLUMNS;

    // Style header
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
        bgColor: { argb: 'FF1E293B' },
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Sample data rows
    worksheet.addRow([
      'Dr. Jane Smith', '1982740192', 'State Medical License', 'MD-998822',
      'State Medical Board', '2022-05-10', '2027-05-10', '2027-04-10',
      '60 days', 'Coordinator Sarah', 'sarah@clinic.org', 'Active',
      '', '', '', ''
    ]);

    worksheet.addRow([
      'Dr. Robert Chen', '1298402910', 'DEA Registration', 'DEA-445566',
      'Drug Enforcement Administration', '2021-11-01', '2026-11-01', '2026-10-01',
      '30 days', 'Coordinator Michael', 'mchen@health.org', 'Active',
      '', '', '', ''
    ]);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="doctor_licenses_template.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate Excel template.', error: error.message });
  }
});

// Bulk Register Endpoint
app.post(['/api/licenses/bulk', '/licenses/bulk'], async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }

    const licenses = Array.isArray(body) ? body : (body.licenses || []);
    if (!licenses || !Array.isArray(licenses) || licenses.length === 0) {
      return res.status(400).json({ message: 'No license records provided for bulk import.' });
    }

    const preparedLicenses = [];
    const errors = [];

    licenses.forEach((item, index) => {
      const providerName = String(item.providerName || item.doctorName || item['Provider Name'] || '').trim();
      const taxIdNpi = String(item.taxIdNpi || item['Provider Tax ID / NPI'] || item['Tax ID / NPI'] || '').trim();
      const credentialType = String(item.credentialType || item.licenseType || item['Credential Type'] || 'State Medical License').trim();
      const providerNumber = String(item.providerNumber || item.licenseNumber || item['Provider Number'] || '').trim();
      const issuingAuthority = String(item.issuingAuthority || item['Issuing Authority'] || 'State Board').trim();
      const issueDate = item.issueDate || item['Issue Date'] || '';
      const expirationDate = item.expirationDate || item.expiryDate || item['Expiration Date'] || '';
      const renewalDueDate = item.renewalDueDate || item['Renewal Due Date'] || expirationDate;
      const reminderSchedule = item.reminderSchedule || item['Reminder Schedule'] || '30 days';
      const responsiblePerson = String(item.responsiblePerson || item['Responsible Person'] || 'Coordinator Staff').trim();
      const coordinatorEmail = String(item.coordinatorEmail || item.notificationEmail || item['Coordinator Email'] || '').trim().toLowerCase();
      const status = item.status || item['Status'] || 'Active';
      const renewalSubmittedDate = item.renewalSubmittedDate || item['Renewal Submitted Date'] || '';
      const renewalCompletedDate = item.renewalCompletedDate || item['Renewal Completed Date'] || '';
      const lastReminderSent = item.lastReminderSent || item['Last Reminder Sent'] || '';
      const nextReminderDate = item.nextReminderDate || item['Next Reminder Date'] || '';

      if (!providerName || !expirationDate) {
        errors.push(`Row ${index + 1}: Provider Name and Expiration Date are required.`);
        return;
      }

      const newId = item.id || item['ID'] || `LIC-BULK-${Date.now()}-${index}`;

      preparedLicenses.push({
        id: newId,
        providerName,
        taxIdNpi,
        credentialType,
        providerNumber,
        issuingAuthority,
        issueDate,
        expirationDate,
        renewalDueDate,
        reminderSchedule,
        responsiblePerson,
        coordinatorEmail,
        status,
        renewalSubmittedDate,
        renewalCompletedDate,
        lastReminderSent,
        nextReminderDate,
        createdAt: new Date().toISOString(),
      });
    });

    const addedCount = await googleSheets.addBulkLicenses(preparedLicenses);

    res.json({
      message: `Successfully imported ${addedCount} provider credential(s).`,
      addedCount,
      errors: errors.length > 0 ? errors : null,
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ message: 'Unable to save bulk licenses.', error: error.message });
  }
});

// Delete a license by ID
app.delete(['/api/licenses/:id', '/licenses/:id'], async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await googleSheets.deleteLicense(id);

    if (deleted) {
      return res.json({ message: 'License deleted successfully.', id });
    }

    res.status(404).json({ message: 'License not found.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting license.', error: error.message });
  }
});

// Manual expiration check trigger
app.get(['/api/check-now', '/check-now'], async (req, res) => {
  try {
    await checkExpiringLicenses();
    res.json({ message: 'Manual expiration check completed.' });
  } catch (error) {
    res.status(500).json({ message: 'Manual check failed.', error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function startServer() {
  if (!process.env.VERCEL) {
    cron.schedule('0 0 * * *', async () => {
      console.log('Running midnight expiration check...');
      await checkExpiringLicenses();
    });

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

module.exports = app;

if (!process.env.VERCEL) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

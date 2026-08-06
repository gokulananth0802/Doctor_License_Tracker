const express = require('express');
const cors = require('cors');
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const WORKBOOK_PATH = process.env.VERCEL
  ? path.join('/tmp', 'licenses.xlsx')
  : path.join(__dirname, 'licenses.xlsx');

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

const TABLE_COLUMNS = [
  { header: 'ID', key: 'id', width: 20 },
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
  { header: 'Created At', key: 'createdAt', width: 24 },
];

function applyHeaderStyle(headerRow) {
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
      bgColor: { argb: 'FF1E293B' },
    };
    cell.font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
      size: 11,
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
}

async function createWorkbookIfNeeded() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('licenses');
    worksheet.columns = TABLE_COLUMNS;
    applyHeaderStyle(worksheet.getRow(1));
    await workbook.xlsx.writeFile(WORKBOOK_PATH);
    console.log(`Created new workbook at ${WORKBOOK_PATH}`);
  } else {
    // Check if existing file needs schema header migration
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(WORKBOOK_PATH);
      const worksheet = workbook.getWorksheet(1);
      if (worksheet) {
        const headerCell = extractCellValue(worksheet.getRow(1).getCell(1));
        if (headerCell === 'Doctor Name' || worksheet.columns.length < 18) {
          const records = await readAllLicenses();
          const newWorkbook = new ExcelJS.Workbook();
          const newSheet = newWorkbook.addWorksheet('licenses');
          newSheet.columns = TABLE_COLUMNS;
          applyHeaderStyle(newSheet.getRow(1));

          records.forEach((rec) => {
            newSheet.addRow([
              rec.id,
              rec.providerName,
              rec.taxIdNpi,
              rec.credentialType,
              rec.providerNumber,
              rec.issuingAuthority,
              rec.issueDate,
              rec.expirationDate,
              rec.renewalDueDate,
              rec.reminderSchedule,
              rec.responsiblePerson,
              rec.coordinatorEmail,
              rec.status,
              rec.renewalSubmittedDate,
              rec.renewalCompletedDate,
              rec.lastReminderSent,
              rec.nextReminderDate,
              rec.createdAt,
            ]);
          });

          await newWorkbook.xlsx.writeFile(WORKBOOK_PATH);
          console.log(`Migrated existing licenses workbook at ${WORKBOOK_PATH} to 18-column schema.`);
        }
      }
    } catch (err) {
      console.warn('Error during workbook schema check/migration:', err.message);
    }
  }
}

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

function extractCellValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const val = cell.value;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'object') {
    if (val.result !== undefined) return String(val.result).trim();
    if (val.text !== undefined) return String(val.text).trim();
    if (Array.isArray(val.richText)) return val.richText.map((t) => t.text).join('').trim();
  }
  return String(val).trim();
}

async function readAllLicenses() {
  try {
    await createWorkbookIfNeeded();
    if (!fs.existsSync(WORKBOOK_PATH)) {
      return [];
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(WORKBOOK_PATH);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) return [];

    const records = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;

      const c1 = extractCellValue(row.getCell(1));
      const c2 = extractCellValue(row.getCell(2));
      const c3 = extractCellValue(row.getCell(3));
      const c4 = extractCellValue(row.getCell(4));
      const c5 = extractCellValue(row.getCell(5));

      // Handle old format (Doctor Name, License Type, License Number, Expiry Date, Notification Email)
      if (c1 && !c1.startsWith('LIC-') && c1.length < 15 && (!row.getCell(6).value || row.cellCount <= 5)) {
        records.push({
          id: `LIC-${rowNumber}-${Date.now()}`,
          providerName: c1,
          taxIdNpi: 'N/A',
          credentialType: c2 || 'State Medical License',
          providerNumber: c3 || 'N/A',
          issuingAuthority: 'State Board',
          issueDate: '',
          expirationDate: c4,
          renewalDueDate: c4,
          reminderSchedule: '60 days',
          responsiblePerson: 'Credentialing Coordinator',
          coordinatorEmail: c5,
          status: getDaysRemaining(c4) < 0 ? 'Expired' : 'Active',
          renewalSubmittedDate: '',
          renewalCompletedDate: '',
          lastReminderSent: '',
          nextReminderDate: '',
          createdAt: new Date().toISOString(),
        });
        return;
      }

      // New format reading
      const id = c1 || `LIC-${rowNumber}`;
      const providerName = c2;
      const taxIdNpi = c3;
      const credentialType = c4;
      const providerNumber = c5;
      const issuingAuthority = extractCellValue(row.getCell(6));
      const issueDate = extractCellValue(row.getCell(7));
      const expirationDate = extractCellValue(row.getCell(8));
      const renewalDueDate = extractCellValue(row.getCell(9));
      const reminderSchedule = extractCellValue(row.getCell(10)) || '30 days';
      const responsiblePerson = extractCellValue(row.getCell(11));
      const coordinatorEmail = extractCellValue(row.getCell(12));
      const status = extractCellValue(row.getCell(13)) || 'Active';
      const renewalSubmittedDate = extractCellValue(row.getCell(14));
      const renewalCompletedDate = extractCellValue(row.getCell(15));
      const lastReminderSent = extractCellValue(row.getCell(16));
      const nextReminderDate = extractCellValue(row.getCell(17));
      const createdAt = extractCellValue(row.getCell(18)) || new Date().toISOString();

      if (providerName || providerNumber) {
        records.push({
          id,
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
          createdAt,
        });
      }
    });

    return records;
  } catch (err) {
    console.error('Error reading licenses file:', err);
    return [];
  }
}

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
  const licenses = await readAllLicenses();

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

app.get(['/api/licenses', '/licenses'], async (req, res) => {
  try {
    const licenses = await readAllLicenses();
    res.json(licenses);
  } catch (error) {
    res.status(500).json({ message: 'Unable to read licenses file.', error: error.message });
  }
});

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

    await createWorkbookIfNeeded();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(WORKBOOK_PATH);
    let worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      worksheet = workbook.addWorksheet('licenses');
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

    worksheet.addRow([
      savedLicense.id,
      savedLicense.providerName,
      savedLicense.taxIdNpi,
      savedLicense.credentialType,
      savedLicense.providerNumber,
      savedLicense.issuingAuthority,
      savedLicense.issueDate,
      savedLicense.expirationDate,
      savedLicense.renewalDueDate,
      savedLicense.reminderSchedule,
      savedLicense.responsiblePerson,
      savedLicense.coordinatorEmail,
      savedLicense.status,
      savedLicense.renewalSubmittedDate,
      savedLicense.renewalCompletedDate,
      savedLicense.lastReminderSent,
      savedLicense.nextReminderDate,
      savedLicense.createdAt,
    ]);

    await workbook.xlsx.writeFile(WORKBOOK_PATH);

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
    let errorMessage = 'Unable to save license.';
    if (error.code === 'EBUSY' || error.code === 'EPERM') {
      errorMessage = 'The file "licenses.xlsx" is currently open in Microsoft Excel or another program. Please close it and try again.';
    } else if (error.message) {
      errorMessage = `Unable to save license: ${error.message}`;
    }

    res.status(500).json({ message: errorMessage, error: error.message });
  }
});

app.delete(['/api/licenses/:id', '/licenses/:id'], async (req, res) => {
  try {
    const { id } = req.params;
    await createWorkbookIfNeeded();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(WORKBOOK_PATH);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      return res.status(404).json({ message: 'License file is empty.' });
    }

    let targetRowNumber = -1;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const cellId = extractCellValue(row.getCell(1));
      if (cellId === id) {
        targetRowNumber = rowNumber;
      }
    });

    if (targetRowNumber > 1) {
      worksheet.spliceRows(targetRowNumber, 1);
      await workbook.xlsx.writeFile(WORKBOOK_PATH);
      return res.json({ message: 'License deleted successfully.', id });
    }

    res.status(404).json({ message: 'License not found.' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting license.', error: error.message });
  }
});

app.get(['/api/check-now', '/check-now'], async (req, res) => {
  try {
    await checkExpiringLicenses();
    res.json({ message: 'Manual expiration check completed.' });
  } catch (error) {
    res.status(500).json({ message: 'Manual check failed.', error: error.message });
  }
});

async function startServer() {
  await createWorkbookIfNeeded();

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

app.use(async (req, res, next) => {
  try {
    await createWorkbookIfNeeded();
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = app;

if (!process.env.VERCEL) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}


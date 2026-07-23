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
const LICENSE_TYPES = [
  'State Medical License',
  'DEA Registration',
  'Medicare ID',
  'Medicaid ID',
  'Board Certification',
  'NPI Number',
  'Other',
];

app.use(cors());
app.use(express.json());

async function createWorkbookIfNeeded() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('licenses');

    worksheet.columns = [
      { header: 'Doctor Name', key: 'doctorName', width: 28 },
      { header: 'License Type', key: 'licenseType', width: 24 },
      { header: 'License Number', key: 'licenseNumber', width: 24 },
      { header: 'Expiry Date', key: 'expiryDate', width: 18 },
      { header: 'Notification Email', key: 'notificationEmail', width: 30 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1D4ED8' },
        bgColor: { argb: 'FF1D4ED8' },
      };
      cell.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    await workbook.xlsx.writeFile(WORKBOOK_PATH);
    console.log(`Created new workbook at ${WORKBOOK_PATH}`);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePayload(payload) {
  const errors = {};

  if (!payload.doctorName || String(payload.doctorName).trim() === '') {
    errors.doctorName = 'Doctor Name is required.';
  }

  if (!payload.licenseType || !LICENSE_TYPES.includes(payload.licenseType)) {
    errors.licenseType = 'Please select a valid license type.';
  }

  if (!payload.licenseNumber || String(payload.licenseNumber).trim() === '') {
    errors.licenseNumber = 'License Number is required.';
  }

  if (!payload.expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.expiryDate)) {
    errors.expiryDate = 'Expiry Date is required in YYYY-MM-DD format.';
  }

  if (!payload.notificationEmail || !isValidEmail(payload.notificationEmail)) {
    errors.notificationEmail = 'A valid Notification Email is required.';
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
  await createWorkbookIfNeeded();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) return [];

  const records = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const doctorName = extractCellValue(row.getCell(1));
    const licenseType = extractCellValue(row.getCell(2));
    const licenseNumber = extractCellValue(row.getCell(3));
    const expiryDate = extractCellValue(row.getCell(4));
    const notificationEmail = extractCellValue(row.getCell(5));

    if (doctorName || licenseNumber) {
      records.push({
        doctorName,
        licenseType,
        licenseNumber,
        expiryDate,
        notificationEmail,
      });
    }
  });

  return records;
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

function isSmtpConfigured() {
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  if (!user || !pass) return false;
  if (user.includes('your-email') || pass.includes('your-gmail-app-password')) return false;
  return true;
}

async function sendAlertEmail(record, daysRemaining) {
  if (!isSmtpConfigured()) {
    console.log(`ℹ️ Email notification skipped for ${record.doctorName} (SMTP credentials in backend/.env are default placeholders).`);
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
    to: record.notificationEmail,
    subject: `License Expiring Soon — ${record.doctorName}`,
    html: `
      <div style="font-family: Arial, sans-serif; background:#f4f7fb; padding:24px;">
        <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #d9e2f3; border-radius:16px; overflow:hidden; box-shadow:0 8px 20px rgba(15,23,42,0.08);">
          <div style="background:#dc2626; color:#ffffff; padding:18px 24px; font-size:20px; font-weight:bold;">License Expiring Soon</div>
          <div style="padding:24px; color:#0f172a;">
            <p><strong>Doctor Name:</strong> ${record.doctorName}</p>
            <p><strong>License Type:</strong> ${record.licenseType}</p>
            <p><strong>License Number:</strong> ${record.licenseNumber}</p>
            <p><strong>Expiry Date:</strong> ${record.expiryDate}</p>
            <p style="color:#dc2626; font-weight:bold; font-size:18px;"><strong>Days Remaining:</strong> ${daysRemaining}</p>
          </div>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Alert sent to ${record.notificationEmail} for ${record.doctorName}`);
    return true;
  } catch (error) {
    if (error.responseCode === 535 || (error.message && error.message.includes('Invalid login'))) {
      console.warn(`⚠️ Email alert failed for ${record.doctorName}: Invalid Gmail login (check SMTP_USER and App Password in backend/.env).`);
    } else {
      console.warn(`⚠️ Email alert failed for ${record.doctorName}:`, error.message);
    }
    return false;
  }
}

async function checkExpiringLicenses() {
  const licenses = await readAllLicenses();

  for (const license of licenses) {
    const daysRemaining = getDaysRemaining(license.expiryDate);

    if (daysRemaining >= 0 && daysRemaining <= 60) {
      try {
        await sendAlertEmail(license, daysRemaining);
      } catch (error) {
        console.warn(`Failed to send email for ${license.doctorName}:`, error.message);
      }
    }
  }
}

app.get('/api/licenses', async (req, res) => {
  try {
    const licenses = await readAllLicenses();
    res.json(licenses);
  } catch (error) {
    res.status(500).json({ message: 'Unable to read licenses file.', error: error.message });
  }
});

app.post('/api/licenses', async (req, res) => {
  const errors = validatePayload(req.body);

  if (errors) {
    return res.status(400).json({ message: 'Validation failed.', errors });
  }

  try {
    await createWorkbookIfNeeded();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(WORKBOOK_PATH);
    let worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      worksheet = workbook.addWorksheet('licenses');
    }

    const savedLicense = {
      doctorName: String(req.body.doctorName).trim(),
      licenseType: req.body.licenseType,
      licenseNumber: String(req.body.licenseNumber).trim(),
      expiryDate: req.body.expiryDate,
      notificationEmail: String(req.body.notificationEmail).trim().toLowerCase(),
    };

    // Pass row as positional array so values are appended regardless of ExcelJS column keys
    worksheet.addRow([
      savedLicense.doctorName,
      savedLicense.licenseType,
      savedLicense.licenseNumber,
      savedLicense.expiryDate,
      savedLicense.notificationEmail,
    ]);

    await workbook.xlsx.writeFile(WORKBOOK_PATH);

    const daysRemaining = getDaysRemaining(savedLicense.expiryDate);
    let immediateAlert = false;

    if (daysRemaining >= 0 && daysRemaining <= 60) {
      try {
        immediateAlert = await sendAlertEmail(savedLicense, daysRemaining);
        if (immediateAlert) {
          console.log(`🚨 Immediate alert sent for ${savedLicense.doctorName} — expires in ${daysRemaining} days`);
        }
      } catch (error) {
        console.warn(`Failed to send immediate alert for ${savedLicense.doctorName}:`, error.message);
      }
    }

    res.status(201).json({
      message: 'License saved successfully.',
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

app.get('/api/check-now', async (req, res) => {
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

// Middleware to ensure workbook exists in Vercel serverless environment
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


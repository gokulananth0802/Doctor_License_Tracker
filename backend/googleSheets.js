/**
 * Google Sheets Data Layer for Doctor License Manager
 *
 * Replaces the local licenses.xlsx file with Google Sheets API as the
 * persistent data store. Uses a Google Service Account for headless
 * authentication on Vercel serverless functions.
 *
 * Environment variables required:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL - Service account client_email
 *   GOOGLE_PRIVATE_KEY           - Service account private_key (PEM)
 *   GOOGLE_SHEET_ID              - The spreadsheet ID from the Sheet URL
 */

const { google } = require('googleapis');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHEET_RANGE = 'Sheet1'; // Default sheet tab name
const HEADER_ROW = [
  'ID',
  'Provider Name',
  'Provider Tax ID / NPI',
  'Credential Type',
  'Provider Number',
  'Issuing Authority',
  'Issue Date',
  'Expiration Date',
  'Renewal Due Date',
  'Reminder Schedule',
  'Responsible Person',
  'Coordinator Email',
  'Status',
  'Renewal Submitted Date',
  'Renewal Completed Date',
  'Last Reminder Sent',
  'Next Reminder Date',
  'Created At',
];

// Column key names matching the JSON property names used in the app
const COLUMN_KEYS = [
  'id',
  'providerName',
  'taxIdNpi',
  'credentialType',
  'providerNumber',
  'issuingAuthority',
  'issueDate',
  'expirationDate',
  'renewalDueDate',
  'reminderSchedule',
  'responsiblePerson',
  'coordinatorEmail',
  'status',
  'renewalSubmittedDate',
  'renewalCompletedDate',
  'lastReminderSent',
  'nextReminderDate',
  'createdAt',
];

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff for rate limits & transient errors
// ---------------------------------------------------------------------------

async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.response?.status || err?.code;
      const isRetryable =
        status === 429 ||
        status === 503 ||
        status === 500 ||
        (err.message && err.message.includes('ECONNRESET'));

      if (isRetryable && attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 500 + Math.random() * 500;
        console.warn(
          `Google Sheets API attempt ${attempt}/${maxAttempts} failed (${status}). Retrying in ${Math.round(delay)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

let _sheetsClient = null;
let _sheetId = null;

/**
 * Initializes and returns a cached Google Sheets API client.
 * Uses service account credentials from environment variables.
 */
function getSheetsClient() {
  if (_sheetsClient && _sheetId) {
    return { sheets: _sheetsClient, spreadsheetId: _sheetId };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !rawKey || !sheetId) {
    throw new Error(
      'Missing Google Sheets credentials. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID environment variables.'
    );
  }

  // Vercel sometimes double-escapes newlines in env vars
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  _sheetId = sheetId;

  return { sheets: _sheetsClient, spreadsheetId: _sheetId };
}

// ---------------------------------------------------------------------------
// Header initialisation
// ---------------------------------------------------------------------------

/**
 * Ensures the Google Sheet has the correct header row.
 * Called once on first read — if Row 1 is empty, writes the header.
 */
async function ensureHeaders() {
  const { sheets, spreadsheetId } = getSheetsClient();

  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_RANGE}!A1:R1`,
    })
  );

  const firstRow = res.data.values?.[0];

  // If the sheet is empty or header is missing, write it
  if (!firstRow || firstRow.length === 0 || firstRow[0] !== HEADER_ROW[0]) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_RANGE}!A1:R1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [HEADER_ROW],
        },
      })
    );
    console.log('Google Sheets: Header row initialized.');
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Reads all license records from the Google Sheet.
 * Returns an array of objects with the same shape as the old xlsx reader.
 */
async function readAllLicenses() {
  try {
    await ensureHeaders();
    const { sheets, spreadsheetId } = getSheetsClient();

    const res = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_RANGE}!A2:R`,
      })
    );

    const rows = res.data.values || [];
    const records = [];

    for (const row of rows) {
      // Skip completely empty rows
      if (!row || row.length === 0 || (!row[0] && !row[1])) continue;

      const record = {};
      COLUMN_KEYS.forEach((key, index) => {
        record[key] = (row[index] || '').trim();
      });

      // Only include rows that have meaningful data
      if (record.providerName || record.providerNumber) {
        records.push(record);
      }
    }

    return records;
  } catch (err) {
    console.error('Error reading licenses from Google Sheets:', err.message);
    throw err;
  }
}

/**
 * Appends a single license record as a new row.
 * @param {Object} licenseData - Object with all 18 column key properties
 * @returns {Object} The saved license data (same object passed in)
 */
async function addLicense(licenseData) {
  await ensureHeaders();
  const { sheets, spreadsheetId } = getSheetsClient();

  const rowValues = COLUMN_KEYS.map((key) => licenseData[key] || '');

  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_RANGE}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowValues],
      },
    })
  );

  return licenseData;
}

/**
 * Appends multiple license records as new rows (bulk insert).
 * @param {Array<Object>} licensesArray - Array of license data objects
 * @returns {number} Number of rows successfully added
 */
async function addBulkLicenses(licensesArray) {
  if (!licensesArray || licensesArray.length === 0) return 0;

  await ensureHeaders();
  const { sheets, spreadsheetId } = getSheetsClient();

  const rows = licensesArray.map((lic) =>
    COLUMN_KEYS.map((key) => lic[key] || '')
  );

  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_RANGE}!A:R`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    })
  );

  return licensesArray.length;
}

/**
 * Deletes a license by its ID (column A).
 * Finds the row number, then deletes the entire row using batchUpdate.
 * @param {string} id - The license ID to delete
 * @returns {boolean} True if found and deleted, false if not found
 */
async function deleteLicense(id) {
  const { sheets, spreadsheetId } = getSheetsClient();

  // 1. Read all IDs to find the row number
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_RANGE}!A:A`,
    })
  );

  const allIds = res.data.values || [];
  let targetRowIndex = -1;

  for (let i = 1; i < allIds.length; i++) {
    // i=1 to skip header
    if (allIds[i] && allIds[i][0] === id) {
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    return false; // Not found
  }

  // 2. Get the sheet's internal gid (sheetId) for batchUpdate
  const spreadsheet = await withRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    })
  );

  const sheetGid = spreadsheet.data.sheets[0]?.properties?.sheetId || 0;

  // 3. Delete the row using batchUpdate
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheetGid,
                dimension: 'ROWS',
                startIndex: targetRowIndex,
                endIndex: targetRowIndex + 1,
              },
            },
          },
        ],
      },
    })
  );

  return true;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getSheetsClient,
  ensureHeaders,
  readAllLicenses,
  addLicense,
  addBulkLicenses,
  deleteLicense,
  COLUMN_KEYS,
  HEADER_ROW,
};

/**
 * PrevCare Google Apps Script — Web App backend
 *
 * Setup:
 * 1. Create a Google Sheet with a tab named "Submissions" (headers below)
 * 2. Extensions → Apps Script → paste this file
 * 3. Set Script Property EXECUTION_TOKEN to a strong random string
 * 4. Deploy → New deployment → Web app → Execute as Me → Anyone
 * 5. Copy the Web App URL into VITE_GAS_SUBMIT_URL
 */

const SUBMISSIONS_SHEET = 'Submissions';
const SUBMISSION_HEADERS = ['timestamp', 'student_id_hash', 'encrypted_payload', 'submission_status'];
const SCRIPT_TOKEN = PropertiesService.getScriptProperties().getProperty('EXECUTION_TOKEN');

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUBMISSIONS_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(SUBMISSIONS_SHEET);
  }

  const firstRow = sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, SUBMISSION_HEADERS.length).getValues()[0];
  const hasHeaders = firstRow.length > 0 && firstRow[0] === SUBMISSION_HEADERS[0];

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, SUBMISSION_HEADERS.length).setValues([SUBMISSION_HEADERS]);
    sheet.getRange(1, 1, 1, SUBMISSION_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function validateToken(token) {
  if (!SCRIPT_TOKEN) {
    throw new Error('EXECUTION_TOKEN script property is not configured');
  }
  if (token !== SCRIPT_TOKEN) {
    throw new Error('Unauthorized');
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    const token = e.parameter.token;
    validateToken(token);

    if (action === 'health') {
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'submissions') {
      setupSheet();
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
      const data = sheet.getDataRange().getValues();
      const headers = data.shift();
      const submissions = data.map(function (row, index) {
        return {
          id: String(index + 1),
          timestamp: row[0],
          studentIdHash: row[1],
          encryptedPayload: row[2],
          submissionStatus: row[3] || 'received',
        };
      });
      return jsonResponse({ submissions: submissions });
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    setupSheet();
    const body = JSON.parse(e.postData.contents);
    validateToken(body.token);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
    sheet.appendRow([
      body.timestamp || new Date().toISOString(),
      body.studentIdHash || '',
      body.encryptedPayload || '',
      'received',
    ]);

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err.message || err) });
  }
}

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

/**
 * PrevCare Google Apps Script — Web App backend
 *
 * Setup:
 * 1. Bind this script to your Google Sheet
 * 2. Set Script Property EXECUTION_TOKEN
 * 3. Run setupAllSheets once
 * 4. Deploy as Web App (Execute as Me, Anyone)
 */

const SUBMISSIONS_SHEET = 'Submissions';
const STUDENT_REGISTRY_SHEET = 'StudentRegistry';
const ACCESS_CODES_SHEET = 'AccessCodes';
const NURSE_ROSTER_SHEET = 'NurseRoster';

const SUBMISSION_HEADERS = [
  'timestamp',
  'email_hash',
  'student_id_hash',
  'encrypted_payload',
  'version',
  'submission_status',
];
const REGISTRY_HEADERS = ['email_hash', 'data_key_salt', 'created_at'];
const ACCESS_HEADERS = ['email_hash', 'code_hash', 'expires_at', 'used', 'created_at'];
const ROSTER_HEADERS = [
  'email',
  'active',
  'display_name',
  'student_id',
  'grade',
  'homeroom',
  'notes',
  'updated_at',
];

const SCRIPT_TOKEN = PropertiesService.getScriptProperties().getProperty('EXECUTION_TOKEN');
const CODE_TTL_MINUTES = 10;
const SESSION_TTL_HOURS = 24;

function setupAllSheets() {
  setupSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
  setupSheet_(STUDENT_REGISTRY_SHEET, REGISTRY_HEADERS);
  setupSheet_(ACCESS_CODES_SHEET, ACCESS_HEADERS);
  setupSheet_(NURSE_ROSTER_SHEET, ROSTER_HEADERS);
}

function setupSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const firstRow =
    sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = firstRow.length > 0 && firstRow[0] === headers[0];
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setupSheet() {
  setupAllSheets();
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

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeHash(value) {
  return String(value || '').trim();
}

function isTruthyActive_(value) {
  if (value === true || value === 1) return true;
  var s = String(value || '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

function isEmailAllowlisted_(email) {
  setupSheet_(NURSE_ROSTER_SHEET, ROSTER_HEADERS);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NURSE_ROSTER_SHEET);
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return false;
  }
  var target = normalizeEmail(email);
  for (var i = 1; i < rows.length; i++) {
    var rowEmail = normalizeEmail(rows[i][0]);
    if (!rowEmail || rowEmail !== target) continue;
    if (isTruthyActive_(rows[i][1])) return true;
  }
  return false;
}

function hashValue(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(digest).slice(0, 22);
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSalt() {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now(),
      Utilities.Charset.UTF_8
    )
  ).slice(0, 22);
}

function generateSessionToken() {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now() + Math.random(),
      Utilities.Charset.UTF_8
    )
  ).replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
}

function putSession(sessionToken, emailHash) {
  const cache = CacheService.getScriptCache();
  cache.put('session_' + hashValue(sessionToken), emailHash, SESSION_TTL_HOURS * 3600);
}

function getSessionEmailHash(sessionToken) {
  const cache = CacheService.getScriptCache();
  return cache.get('session_' + hashValue(sessionToken));
}

function getOrCreateDataKeySalt(emailHash) {
  setupSheet_(STUDENT_REGISTRY_SHEET, REGISTRY_HEADERS);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STUDENT_REGISTRY_SHEET);
  const rows = sheet.getDataRange().getValues();
  rows.shift();

  for (var i = 0; i < rows.length; i++) {
    if (normalizeHash(rows[i][0]) === normalizeHash(emailHash)) {
      return rows[i][1];
    }
  }

  const salt = generateSalt();
  sheet.appendRow([emailHash, salt, new Date().toISOString()]);
  return salt;
}

function storeAccessCode(emailHash, code) {
  setupSheet_(ACCESS_CODES_SHEET, ACCESS_HEADERS);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACCESS_CODES_SHEET);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
  sheet.appendRow([emailHash, hashValue(code), expiresAt, false, new Date().toISOString()]);
}

function verifyAccessCode(emailHash, code) {
  setupSheet_(ACCESS_CODES_SHEET, ACCESS_HEADERS);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACCESS_CODES_SHEET);
  const rows = sheet.getDataRange().getValues();
  const codeHash = hashValue(code);
  const now = Date.now();
  var targetHash = normalizeHash(emailHash);

  for (var i = rows.length - 1; i >= 1; i--) {
    var row = rows[i];
    if (normalizeHash(row[0]) !== targetHash) continue;
    if (row[3] === true) continue;
    if (new Date(row[2]).getTime() < now) continue;
    if (row[1] !== codeHash) continue;
    sheet.getRange(i + 1, 4).setValue(true);
    return true;
  }
  return false;
}

function submissionTimestamp_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function getLatestSubmission(emailHash) {
  setupSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
  const rows = sheet.getDataRange().getValues();
  rows.shift();

  var targetHash = normalizeHash(emailHash);
  var latest = null;
  for (var i = 0; i < rows.length; i++) {
    if (normalizeHash(rows[i][1]) !== targetHash) continue;
    var candidate = {
      timestamp: submissionTimestamp_(rows[i][0]),
      emailHash: rows[i][1],
      studentIdHash: rows[i][2],
      encryptedPayload: rows[i][3],
      version: Number(rows[i][4] || 1),
      submissionStatus: rows[i][5] || 'received',
    };
    if (
      !latest ||
      candidate.version > latest.version ||
      (candidate.version === latest.version &&
        new Date(candidate.timestamp).getTime() >= new Date(latest.timestamp).getTime())
    ) {
      latest = candidate;
    }
  }
  return latest;
}

/**
 * Upsert by email_hash. If duplicate rows exist, update the highest-version row
 * and return the new timestamp (source of truth for "last updated").
 */
function upsertSubmission(emailHash, studentIdHash, encryptedPayload) {
  setupSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  var targetHash = normalizeHash(emailHash);
  var existingRowIndex = -1;
  var maxVersion = 0;

  for (var i = 1; i < rows.length; i++) {
    if (normalizeHash(rows[i][1]) !== targetHash) continue;
    var rowVersion = Number(rows[i][4] || 1);
    if (existingRowIndex < 0 || rowVersion >= maxVersion) {
      existingRowIndex = i + 1;
      maxVersion = rowVersion;
    }
  }

  var version = maxVersion > 0 ? maxVersion + 1 : 1;

  if (existingRowIndex > 0) {
    sheet.getRange(existingRowIndex, 1, existingRowIndex, 6).setValues([
      [now, emailHash, studentIdHash, encryptedPayload, version, 'updated'],
    ]);
  } else {
    sheet.appendRow([now, emailHash, studentIdHash, encryptedPayload, 1, 'received']);
    version = 1;
  }

  return { version: version, timestamp: now };
}

function authorizeMailApp() {
  // Run this ONCE from the Apps Script editor to grant send-mail permission.
  var recipient = Session.getActiveUser().getEmail();
  if (!recipient) {
    throw new Error('Could not determine your Google account email. Run while logged into the script owner account.');
  }
  MailApp.sendEmail({
    to: recipient,
    subject: 'PrevCare — MailApp authorization test',
    body: 'MailApp is authorized. Student access codes can now be sent to any email address on the NurseRoster.',
  });
  return 'Test email sent to ' + recipient;
}

function handleRequestCode(body) {
  var email = normalizeEmail(body.email);
  if (!email || email.indexOf('@') === -1) {
    throw new Error('Valid email required');
  }
  if (!isEmailAllowlisted_(email)) {
    throw new Error('Email not on school roster. Contact your school nurse.');
  }
  var emailHash = hashValue(email);
  var code = generateCode();
  storeAccessCode(emailHash, code);

  try {
    MailApp.sendEmail({
      to: email,
      subject: 'PrevCare Access Code',
      body:
        'Your single-use PrevCare access code is: ' +
        code +
        '\n\nThis code expires in ' +
        CODE_TTL_MINUTES +
        ' minutes and can only be used once.\n\nIf you did not request this, ignore this email.',
    });
  } catch (mailErr) {
    var msg = String(mailErr.message || mailErr);
    if (msg.indexOf('script.send_mail') !== -1 || msg.indexOf('permission') !== -1) {
      throw new Error(
        'Mail permission not granted. In Apps Script, run authorizeMailApp() once, approve Send email access, then redeploy the Web App.'
      );
    }
    throw new Error('Could not send email to ' + email + ': ' + msg);
  }

  return { success: true, message: 'Access code sent' };
}

function handleVerifyCode(body) {
  var email = normalizeEmail(body.email);
  var code = String(body.code || '').trim();
  if (!email || !code) {
    throw new Error('Email and code required');
  }
  if (!isEmailAllowlisted_(email)) {
    throw new Error('Email not on school roster. Contact your school nurse.');
  }

  var emailHash = hashValue(email);
  if (!verifyAccessCode(emailHash, code)) {
    throw new Error('Invalid or expired access code');
  }

  var dataKeySalt = getOrCreateDataKeySalt(emailHash);
  var sessionToken = generateSessionToken();
  putSession(sessionToken, emailHash);
  var latest = getLatestSubmission(emailHash);

  return {
    success: true,
    sessionToken: sessionToken,
    emailHash: emailHash,
    dataKeySalt: dataKeySalt,
    hasSubmission: !!latest,
    submission: latest,
  };
}

function handleSubmitUpdate(body) {
  var sessionToken = body.sessionToken;
  var emailHash = getSessionEmailHash(sessionToken);
  if (!emailHash) {
    throw new Error('Session expired. Please sign in again.');
  }
  if (body.emailHash && normalizeHash(body.emailHash) !== normalizeHash(emailHash)) {
    throw new Error('Session mismatch');
  }

  var result = upsertSubmission(
    emailHash,
    body.studentIdHash || '',
    body.encryptedPayload || ''
  );

  return { success: true, version: result.version, timestamp: result.timestamp };
}

function handleGetSubmission(sessionToken) {
  var emailHash = getSessionEmailHash(sessionToken);
  if (!emailHash) {
    throw new Error('Session expired. Please sign in again.');
  }
  var latest = getLatestSubmission(emailHash);
  return {
    success: true,
    emailHash: emailHash,
    submission: latest,
  };
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    var token = e.parameter.token;
    validateToken(token);

    if (action === 'health') {
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'submissions') {
      setupSheet_(SUBMISSIONS_SHEET, SUBMISSION_HEADERS);
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SUBMISSIONS_SHEET);
      var data = sheet.getDataRange().getValues();
      data.shift();
      var submissions = data.map(function (row, index) {
        return {
          id: String(index + 1),
          timestamp: submissionTimestamp_(row[0]),
          emailHash: row[1],
          studentIdHash: row[2],
          encryptedPayload: row[3],
          version: row[4] || 1,
          submissionStatus: row[5] || 'received',
        };
      });
      return jsonResponse({ submissions: submissions });
    }

    if (action === 'studentSubmission') {
      var sessionToken = e.parameter.sessionToken;
      return jsonResponse(handleGetSubmission(sessionToken));
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    setupAllSheets();
    var body = JSON.parse(e.postData.contents);
    validateToken(body.token);

    if (body.action === 'requestCode') {
      return jsonResponse(handleRequestCode(body));
    }

    if (body.action === 'verifyCode') {
      return jsonResponse(handleVerifyCode(body));
    }

    if (body.action === 'submitUpdate') {
      return jsonResponse(handleSubmitUpdate(body));
    }

    // Legacy submit (append only, no session)
    if (body.encryptedPayload) {
      var emailHash = body.emailHash || body.studentIdHash || '';
      upsertSubmission(emailHash, body.studentIdHash || '', body.encryptedPayload);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err.message || err) });
  }
}

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

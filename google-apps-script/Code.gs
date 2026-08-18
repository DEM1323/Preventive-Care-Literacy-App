/**
 * Retired PrevCare Apps Script boundary.
 *
 * The only enabled action is a synthetic-environment health check. Student
 * authentication, reads, and writes are intentionally unavailable.
 */

const DATA_POLICY = PropertiesService.getScriptProperties().getProperty('DATA_POLICY');

function requireSyntheticEnvironment_() {
  if (DATA_POLICY !== 'synthetic-only') {
    throw new Error('Prototype backend is retired unless DATA_POLICY is synthetic-only');
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet(e) {
  try {
    requireSyntheticEnvironment_();
    if (e.parameter.action !== 'health') {
      throw new Error('Unknown action');
    }
    return jsonResponse({ status: 'ok', dataPolicy: DATA_POLICY });
  } catch (err) {
    return jsonResponse({ error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    requireSyntheticEnvironment_();
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'submitUpdate') {
      throw new Error('Prototype intake submissions are disabled');
    }
    if (body.action === 'requestCode' || body.action === 'verifyCode') {
      throw new Error('Prototype Student access is disabled');
    }
    throw new Error('Unknown action');
  } catch (err) {
    return jsonResponse({ success: false, error: String(err.message || err) });
  }
}

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

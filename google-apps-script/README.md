# Google Apps Script Setup

1. Create a new Google Sheet.
2. Open **Extensions → Apps Script** and paste [`Code.gs`](./Code.gs).
3. Enable the manifest file: **Project Settings** → check **Show "appsscript.json" manifest file in editor** → paste [`appsscript.json`](./appsscript.json).
4. Add Script Property `EXECUTION_TOKEN` (match `VITE_GAS_EXECUTION_TOKEN` in `.env`).
5. Run **`setupAllSheets`** once and authorize spreadsheet access.
6. Run **`authorizeMailApp`** once and authorize **Send email** when prompted.
   - This sends a test email to **your** Google account (the script owner).
   - Required before students can receive access codes.
7. Add student emails to the **NurseRoster** tab (`active` = `TRUE`) before they can sign in.
8. **Deploy → Manage deployments → Edit → New version → Deploy**
   - Execute as: **Me**
   - Who has access: **Anyone**

## Fix: "You do not have permission to call MailApp.sendEmail"

This error is **not** caused by the student using a non-Gmail address. `MailApp.sendEmail` can send **to** any email. The script owner has not granted **send mail** permission yet.

**Fix steps:**

1. Open the Apps Script editor (Extensions → Apps Script).
2. Select **`authorizeMailApp`** in the function dropdown → click **Run**.
3. Click **Review permissions** → choose your Google account → **Allow** (including Gmail send access).
4. Check your inbox for the test email from Google.
5. **Redeploy** the Web App (new version) — authorization from step 2 must be active for the deployment.
6. Try student sign-in again.

If it still fails after redeploying, create a **New deployment** instead of only bumping the version.

## Non-Gmail student emails (@school.edu, etc.)

Supported. The code is sent **to** the address the student enters. Notes:

- The email is sent **from** the Google account that owns/deploys the script.
- Some school filters may block it — check spam/junk folders.
- Google Workspace admins can restrict Apps Script mail; ask IT if codes never arrive after authorization.
- The address must appear on **NurseRoster** with `active=TRUE`.

## Sheets created automatically

| Tab | Purpose |
|-----|---------|
| **Submissions** | Encrypted form (one row per student, overwritten on update; `timestamp` = last updated) |
| **StudentRegistry** | Email hash → encryption salt |
| **AccessCodes** | Hashed single-use login codes |
| **NurseRoster** | Nurse-editable allowlist (`email`, `active`, optional metadata) |

## Student auth flow

1. Student enters email → app calls `requestCode` → GAS checks NurseRoster → emails a 6-digit code
2. Student enters code → `verifyCode` → returns session token
3. Form data is encrypted **in the browser** before submit
4. Updates **overwrite** the student's existing row and refresh `timestamp`

## Privacy model

- Google Sheets stores **ciphertext only** in Submissions — never plaintext health answers
- Nurses decrypt **locally in the browser** with the district decrypt key
- NurseRoster stores plaintext emails for access control only

## Content CMS (Modules + IntakeFields)

Publish separate sheets/tabs and set:

- `VITE_MODULES_SHEET_URL` — lesson content
- `VITE_INTAKE_SHEET_URL` — intake field schema / labels

See [docs/NURSE_GUIDE.md](../docs/NURSE_GUIDE.md) for column headers and nurse workflows.

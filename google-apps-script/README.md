# Google Apps Script Setup

1. Create a new Google Sheet.
2. Open **Extensions → Apps Script** and paste [`Code.gs`](./Code.gs).
3. Add Script Property `EXECUTION_TOKEN` (match `VITE_GAS_EXECUTION_TOKEN` in `.env`).
4. Run **`setupAllSheets`** once from the editor and authorize:
   - Spreadsheet access
   - **Send email** (for student access codes)
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL into `.env` as `VITE_GAS_SUBMIT_URL`.

## Sheets created automatically

| Tab | Purpose |
|-----|---------|
| **Submissions** | Encrypted form versions (push updates append new rows) |
| **StudentRegistry** | Email hash → encryption salt (no plaintext email stored) |
| **AccessCodes** | Hashed single-use login codes |

## Student auth flow

1. Student enters email → app calls `requestCode` → GAS emails a 6-digit code
2. Student enters code → `verifyCode` → returns session token + encryption salt
3. Form data is encrypted **in the browser** before any submit
4. Updates **overwrite** the student's existing row (one record per email hash)

## Privacy model

- Google Sheets stores **ciphertext only**
- Plaintext emails are used only transiently to send the access code via Gmail
- The nurse dashboard decrypts submissions **locally in the browser** using the district decrypt key
- Google Sheets stores **ciphertext only** — never plaintext

## Modules CMS (optional)

Publish a **Modules** tab and set `VITE_MODULES_SHEET_URL` — see main README.

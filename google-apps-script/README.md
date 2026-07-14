# Google Apps Script Setup

1. Create a new Google Sheet (you do **not** need to add headers manually).
2. Open **Extensions → Apps Script** and paste [`Code.gs`](./Code.gs).
3. Go to **Project Settings → Script Properties** and add:
   - `EXECUTION_TOKEN` = a strong random string (match `VITE_GAS_EXECUTION_TOKEN` in `.env`)
4. In the Apps Script editor, select **`setupSheet`** from the function dropdown and click **Run**.
   - Authorize the script when prompted.
   - This creates the **Submissions** tab and writes the header row if missing.
   - **Note:** If you already created an empty "Submissions" tab, the old script skipped headers — re-run after updating `Code.gs`, or delete the empty tab and run again.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the Web App URL into `.env`:
   ```
   VITE_GAS_SUBMIT_URL=https://script.google.com/macros/s/.../exec
   VITE_GAS_EXECUTION_TOKEN=your-token
   ```

## Modules CMS Sheet (optional)

Create a second sheet tab **Modules** with columns:

| module_id | icon | badge_icon | badge_name | en_script | en_knowledge_1 | en_skill_1 | ... |

Publish the sheet (Anyone with link can view) and set:

```
VITE_MODULES_SHEET_URL=https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:json&sheet=Modules
```

The app falls back to bundled module content when this URL is not configured.

## Security Notes

- Student health data is encrypted client-side before POST.
- The Google Sheet stores only ciphertext in `encrypted_payload`.
- Nurses decrypt locally in the `/nurse` dashboard using the district passcode.
- Rotate `VITE_DISTRICT_ENCRYPTION_PASSCODE` if the repository is public.

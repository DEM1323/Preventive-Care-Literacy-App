# Nurse Guide — PrevCare

This guide is for school nurses who maintain student access, lesson content, and intake form wording in Google Sheets. You do **not** need to edit code or redeploy the website.

Ask IT for:

- Link to the school’s PrevCare Google Sheet
- Nurse dashboard passcode (`/nurse`)
- District decrypt key (used only in your browser to view forms)
- App URL

---

## Which sheet tabs to use

| Tab | You edit? | Purpose |
|-----|-----------|---------|
| **NurseRoster** | Yes | Student emails allowed to sign in |
| **Modules** (separate published sheet/tab) | Yes | Lesson content |
| **IntakeFields** (separate published sheet/tab) | Yes | Health form questions and labels |
| **Submissions** | No | Encrypted student forms (machine-managed) |
| **StudentRegistry** | No | Encryption salts (machine-managed) |
| **AccessCodes** | No | Login codes (machine-managed) |

Do not edit Submissions, StudentRegistry, or AccessCodes. Changing those rows can break student access or make forms unreadable.

---

## Student roster (NurseRoster)

Only emails listed here with **active = TRUE** can receive a login code.

### Add a student

1. Open the PrevCare Google Sheet → **NurseRoster** tab.
2. Add a new row:
   - `email` — student school email (required)
   - `active` — `TRUE`
   - Optional: `display_name`, `student_id`, `grade`, `homeroom`, `notes`
3. Save. The student can sign in immediately (no website redeploy).

### Remove / revoke access

1. Find the student’s row.
2. Set `active` to `FALSE` (preferred — keeps a record).
3. Or delete the row.

Revoked students cannot request new codes. An already-open session may last up to about 24 hours.

### If a student sees “Email not on school roster”

Their email is missing or `active` is not `TRUE`. Check spelling and that the address matches what they type at sign-in (not case-sensitive).

---

## Viewing student health forms (`/nurse`)

Student health answers are **encrypted**. You view them in the app, not by reading the Submissions sheet.

1. Open the app → `/nurse`.
2. Enter the nurse dashboard passcode (from IT).
3. Click **Fetch Submissions**.
4. Enter the district decrypt key.
5. Click decrypt. Expand **View** for the full form.

The **Last Updated** column shows when the student last saved their form.

**Important:** Students update their own health data by signing in and using **Push Form Update**. Nurses do not edit encrypted answers in the sheet.

---

## Learning modules (Modules sheet)

Lesson text lives in a Google Sheet that IT publishes to the web. Editing the sheet updates the app after refresh (when `VITE_MODULES_SHEET_URL` is set).

### Edit a lesson

1. Open the Modules sheet (IT will share the link).
2. Find the row for the module (`module_id`: `primary`, `access`, `insurance`, `rights`, `school`, `emergency`).
3. Edit columns such as:
   - `en_script`, `es_script`, … — lesson script per language
   - `en_knowledge_1` … `_3` — knowledge bullets
   - `en_skill_1` … `_5` — skill checklist items
   - `en_words` — pipe-separated vocab (`word1|word2`)
   - Same pattern for `es_`, `pt_`, `fr_`, `ht_`
   - `icon`, `badge_icon`, `badge_name`
4. Keep the header row exactly as IT set it (do not rename column headers).
5. If the sheet is already published, edits usually appear after a short delay; refresh the app. If IT asked you to republish: **File → Share → Publish to web**.

### Required columns (header row)

`module_id`, `icon`, `badge_icon`, `badge_name`, then for each language `en` / `es` / `pt` / `fr` / `ht`:

- `{lang}_words`
- `{lang}_script`
- `{lang}_knowledge_1` … `{lang}_knowledge_3`
- `{lang}_skill_1` … `{lang}_skill_5`

If modules never change in the live app, ask IT to set `VITE_MODULES_SHEET_URL` and confirm the tab is published.

---

## Intake form fields (IntakeFields sheet)

Form questions and labels come from the IntakeFields sheet (when `VITE_INTAKE_SHEET_URL` is set). Offline/default fields ship with the app if the sheet is unavailable.

### Safe edits

- Change `label_en` (and other `label_*`) to reword a question
- Change `sort_order` to reorder fields within a step
- Change `step` to move a field to another wizard step
- Set `enabled` to `FALSE` to hide a field for new fills (old answers may still exist in encrypted data)
- Add a new row with a **new** `field_id` (never reuse an old id for a different meaning)

### Do not casually rename `field_id`

`field_id` is the permanent key inside encrypted student answers. Renaming it makes old answers look empty for that question.

Protected fields that must stay: `email`, `studentId`, `consent`.

### Column reference

| Column | Example | Notes |
|--------|---------|--------|
| `field_id` | `allergies` | Stable key — do not rename |
| `enabled` | `TRUE` | Soft-hide when FALSE |
| `step` | `3` | Wizard step number |
| `sort_order` | `10` | Order within the step |
| `type` | `yesno` | `text`, `date`, `tel`, `email`, `textarea`, `yesno`, `checkbox` |
| `required` | `TRUE` | Validation |
| `show_if_field` | `allergies` | Show this field only when another field matches |
| `show_if_value` | `Yes` | Value that unlocks the conditional field |
| `default_value` | `No` | Initial value |
| `label_en` … `label_ht` | … | Display labels |
| `nurse_summary` | `TRUE` | Show as a column on the nurse dashboard |
| `module_hint` | `insurance` | Personalization tags: `insurance`, `allergies`, `housing` |

After editing, refresh the app (republish the sheet if IT requires it).

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| “Email not on school roster” | Add/activate the email on **NurseRoster** |
| No access code email | Check spam; confirm MailApp was authorized by IT; confirm roster `active=TRUE` |
| Form “Last updated” does not change | Student must successfully submit; check internet; sign out/in and try again |
| Modules/form labels never change | Confirm sheet publish URL is set in production; hard-refresh the app |
| Cannot decrypt on `/nurse` | Confirm the district decrypt key with IT (must match the key used when students submit) |

---

## IT setup notes

Technical deploy and Apps Script steps: [google-apps-script/README.md](../google-apps-script/README.md) and the main [README.md](../README.md).

Required for nurse CMS:

- Paste updated `Code.gs`, run `setupAllSheets` (creates **NurseRoster**), redeploy Web App
- Populate **NurseRoster** before students can log in (allowlist is enforced)
- Set GitHub/Actions secrets: `VITE_MODULES_SHEET_URL`, `VITE_INTAKE_SHEET_URL` (published sheet JSON URLs)

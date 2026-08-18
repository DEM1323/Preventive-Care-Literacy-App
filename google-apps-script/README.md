# Retired Google Apps Script Boundary

This code exists only to replace any legacy deployment with a fail-closed boundary. It has no Google OAuth scopes and cannot authenticate a Student or read or write Student data.

## Replacement deployment

Follow [the retirement and cutover record](../docs/security/prototype-retirement.md). An operator must locate every legacy Apps Script project through the owning Google account or bound Sheet, then delete the old deployment or replace it with this code.

Run `scripts/retire-google-prototype.sh` from the repository root for the guided, auditable procedure.

If replacement is required for evidence:

1. Open the legacy Apps Script project.
2. Replace `Code.gs` and `appsscript.json` with the files in this directory.
3. Set Script Property `DATA_POLICY` to `synthetic-only`.
4. Delete the obsolete `EXECUTION_TOKEN` Script Property.
5. Create a new deployment version.
6. Confirm `GET ?action=health` returns `{"status":"ok","dataPolicy":"synthetic-only"}`.
7. Confirm every POST action and every other GET action is rejected.

If `DATA_POLICY` is absent or differs by case, all requests are rejected. This boundary is not a backend for replacement development; it is only a safe tombstone for a legacy deployment.

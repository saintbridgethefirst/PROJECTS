# TeamTrack runbook — what to do when something goes wrong

## Backups (automatic)
- Google takes a backup of the whole database **every day (kept 30 days)** and **every Sunday (kept 14 weeks)**.
- Every morning GitHub checks that a fresh backup exists. If not, the **Backups** workflow fails and
  GitHub emails you. Fix: Actions ▸ Backups ▸ Run workflow ▸ `setup`.
- See which backups exist: Actions ▸ Backups ▸ Run workflow ▸ `check`.

## A team lost or broke its data — restore ONE team
1. Find the team ID: open the team in TeamTrack; it's in the address bar after `#/t/`.
2. GitHub ▸ TRAWPIE ▸ **Actions ▸ Backups ▸ Run workflow**:
   action `restore-team`, team ID, backup day (`YYYY-MM-DD`, or empty for the latest), **apply unticked**.
3. Open the finished run: the log says what would change (documents written / deleted per collection).
   Nothing has changed yet.
4. If it looks right, run it again with **apply ticked**. Only that team changes; other teams are untouched.
5. The team's state just before the restore is attached to the run (Artifacts ▸ `team-…-before-restore`).
   To undo the restore: download it and run
   `node tools/ops/restore-team.mjs --team <ID> --from-file team-<ID>-before.json --apply`
   (or ask Claude to do it).

Each restore makes a temporary copy of the backup and deletes it at the end. If the run says it
couldn't delete it, delete it in Google Cloud ▸ Firestore ▸ Databases (`restore-…`) to avoid charges.

## The whole site is broken after a change
- Every change is in GitHub. Revert the bad commit (or ask Claude to); the pipeline tests and
  redeploys the previous version automatically.
- Firebase Hosting also keeps old versions: Firebase console ▸ Hosting ▸ Release history ▸ Rollback.

## Permissions the deploy account needs
Service account `github-deploy@uni-teamtrack.iam.gserviceaccount.com` (Google Cloud ▸ IAM):
- Firebase Admin, Service Account User — deploying the site and rules
- Cloud Datastore Owner, Cloud Datastore Backups Admin, Cloud Datastore Backup Schedules Admin,
  Cloud Datastore Restore Admin — backups and restores
- Cloud Functions Admin — only if GitHub should deploy the Cloud Functions

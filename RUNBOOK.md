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
- Cloud Functions Admin, Cloud Build Editor, Artifact Registry Administrator, Secret Manager Secret Accessor,
  Cloud Scheduler Admin, Eventarc Admin — GitHub deploys the Cloud Functions whenever `functions/` changes
- Firebase Hosting Admin — preview links for pull requests

## Trying a change before it goes live
Open a pull request instead of pushing to `main`. After the tests pass, a bot comments a private
preview link (`uni-teamtrack--pr-N-….web.app`, expires after 7 days). It uses the **live database**,
so try changes on a test team. To sign in there, add the preview domain once under Firebase ▸
Authentication ▸ Settings ▸ Authorised domains (or just look, signed out). Merge the pull request to go live.

## Before a demo
Feature freeze: for the week before, only bug fixes go to `main`. Check the latest CI run is green,
the Backups check ran this morning, and there are no new error emails.

## One-time console settings (safety net)
Do these once; each takes a couple of minutes.

1. **Point-in-time recovery** (undo the last 7 days to any minute, on top of the daily backups):
   Google Cloud console ▸ Firestore ▸ Databases ▸ `(default)` ▸ Disaster recovery ▸ Edit ▸
   tick **Point-in-time recovery** ▸ Save. Costs about the same as storing the data once more.
2. **Budget alerts** (a bug or abuse can't quietly run up a bill):
   Google Cloud console ▸ Billing ▸ Budgets & alerts ▸ Create budget ▸ project `uni-teamtrack` ▸
   amount £20 a month ▸ alerts at 25 %, 50 %, 90 %, 100 % ▸ email billing admins ▸ Finish.
3. **App Check enforcement** (only the real site can use the database and sign-in):
   Firebase console ▸ App Check ▸ APIs ▸ Cloud Firestore ▸ check the chart shows almost all requests
   as *verified* for a few days ▸ **Enforce**. Then the same for Authentication.
   If people suddenly can't save: App Check ▸ Cloud Firestore ▸ Unenforce, and tell Claude.
4. **Uptime monitoring** (an email within minutes if the site or the GitHub link goes down):
   uptimerobot.com ▸ free account ▸ Add New Monitor ▸ HTTP(s) ▸ `https://uni-teamtrack.web.app` ▸ every 5 minutes.
   Add a second one: Keyword monitor ▸ `https://europe-west2-uni-teamtrack.cloudfunctions.net/githubWebhook`
   ▸ keyword `webhook is running` (its answer to a plain visit).
5. **Server error emails**: Google Cloud console ▸ Error Reporting ▸ turn on notifications ▸ your email.
   (Crashes in browsers and in the app's server code already email the platform admins.)

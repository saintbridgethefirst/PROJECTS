# Trawpie setup guide

This guide takes you from the downloaded folder to a live website where your team
signs in, joins by email and tracks progress together. You don't need to write any
code. Allow about 30 minutes for parts 1 and 2. Parts 3 and 4 are optional.

| Part | What you get | Needed? |
|---|---|---|
| 1. Try it on your computer | The app running in **demo mode** (data stays in your browser) | Recommended first |
| 2. Go live with Firebase | Real accounts, teams, invites and a public web address | Yes, to share with a team |
| 3. Google Drive, Sheets and Calendar | Upload files to Drive, export to Sheets, collect tasks through a shared Sheet, sync deadlines to Google Calendar | Optional |
| 4. Microsoft sign-in and OneDrive | "Continue with Microsoft" and OneDrive uploads | Optional |
| 5. AI summaries | Nothing to set up for "Copy for AI"; optional personal Gemini key | Optional |

---

## Part 1: Try it on your computer

1. Install **Node.js 20 or newer** (the "LTS" download) from <https://nodejs.org>.
2. Open a terminal in this folder:
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder in Finder, then **New Terminal at Folder**.
3. Run these two commands. The first one takes a minute or two.
   ```
   npm install
   npm run dev
   ```
4. Open <http://127.0.0.1:5173> in your browser.

With no Firebase settings the app runs in **demo mode**. Sign in with any name and
email; nothing is sent anywhere. To try invites and roles, open a second browser
tab and sign in as the teammate you invited.

Stop the app with `Ctrl + C` in the terminal.

---

## Part 2: Go live with Firebase (free plan)

Firebase is Google's hosting and database service. Its free **Spark** plan covers
sign-in, the database and the website itself. No credit card is needed.

### 2.1 Create the project
1. Go to <https://console.firebase.google.com> and click **Create a project**.
   Give it a name, for example `teamtrack-yourname`. Google Analytics is not needed.
2. On the project page, click the **web** icon (`</>`) to add a web app. Give it a
   nickname and register it. You don't need Firebase Hosting setup from that screen.
3. Firebase shows a block of settings (`firebaseConfig`). Keep this page open.

### 2.2 Put the settings in a `.env` file
1. In this folder, copy `.env.example` to a new file named `.env`.
2. Fill in the four Firebase lines from the settings you just saw:
   ```
   VITE_FIREBASE_API_KEY=...        (apiKey)
   VITE_FIREBASE_AUTH_DOMAIN=...    (authDomain)
   VITE_FIREBASE_PROJECT_ID=...     (projectId)
   VITE_FIREBASE_APP_ID=...         (appId)
   ```
   These values are not secret: every Firebase website sends them to the browser.
   The security rules in `firestore.rules` are what protect the data.
3. Optionally change `VITE_APP_NAME` and `VITE_APP_TAGLINE`.
4. Open `.firebaserc` and replace `your-firebase-project-id` with your project ID.

### 2.3 Switch on sign-in
In the Firebase console, open **Authentication**, click **Get started**, then the
**Sign-in method** tab:
1. Enable **Email/Password**. Leave "Email link (passwordless sign-in)" off.
   On the free plan Firebase sends only **5 sign-in-link emails per day for the
   whole site**, but up to 1,000 verification emails, which is why the app uses
   passwords. ([Firebase limits](https://firebase.google.com/docs/auth/limits))
2. Enable **Google**. Choose a support email and save.

### 2.4 Create the database
1. Open **Firestore Database** and click **Create database**.
2. Choose a location close to your team, for example `europe-west2 (London)`.
   **You can't change this later.**
3. Start in **production mode**. The app's own rules replace the defaults in the
   next step.

### 2.5 Publish the website
In the terminal, in this folder:
```
npx firebase login
npm run deploy
```
`firebase login` opens a browser window to sign in with the Google account that owns
the project. `npm run deploy` builds the site and uploads three things:
the website, the security rules (`firestore.rules`) and the database indexes
(`firestore.indexes.json`).

When it finishes, it prints your address, for example
`https://teamtrack-yourname.web.app`. Open it, create an account and make your first team.

**After any change to `.env`, or after updating to a newer version of this folder, run
`npm run deploy` again** so the website and the security rules stay in step.

### 2.6 How people join
1. The team owner opens **Settings ▸ Members** and invites people by email, choosing a role.
2. The app saves the invitation and gives you a ready-made message. Send it with
   **Gmail**, **Outlook**, **Other email app** or **Copy message**. Email opens in a
   new tab, so Trawpie stays open behind it.
3. Your teammate opens the site and creates an account (or uses Google) **with the
   same email address**, verifies it from the email Firebase sends, and clicks
   **Join team**.

Only verified addresses can accept invitations, so nobody can join by typing
someone else's email.

### 2.7 Roles
Every team starts with these roles. The owner can change them or add new ones in
**Settings ▸ Roles & permissions**.

| Permission | Owner | Admin | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| Edit own tasks | ✓ | ✓ | ✓ | |
| Edit everyone's tasks | ✓ | ✓ | | |
| Manage weeks | ✓ | ✓ | ✓ | |
| View analytics | ✓ | ✓ | ✓ | ✓ |
| Export and AI summary | ✓ | ✓ | ✓ | |
| Manage members | ✓ | ✓ | | |
| Team settings (name, logo, fields) | ✓ | ✓ | | |
| Manage roles | ✓ | | | |

These permissions are checked twice: by the app, and again by Firebase's servers
through `firestore.rules`. Someone who edits the page in their browser still can't
change data their role doesn't allow.

### 2.8 Weeks and account photos
- New teams start at **WEEK 1**. The owner or an admin can switch to **calendar weeks**
  (the week number of the year) in **Settings ▸ General ▸ Week numbering**, and rename
  existing weeks to match. Any week can still be renamed by clicking its name.
- Everyone can add a photo in **Your account** (the button with your name). It is shown
  next to your row on every team you belong to.

### 2.9 Check the security rules (optional, recommended)
On a computer with normal internet access and **Java 11 or newer** installed:
```
npm run test:rules
```
This runs Google's own Firestore emulator against `firestore.rules`. The first run
downloads the emulator.

### Free plan limits
The free Spark plan includes, per day, 50,000 database reads and 20,000 writes
([Firebase pricing](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)).
That is plenty for small and medium teams. Team logos and task icons are stored
inside the database, so the app doesn't need Cloud Storage, which requires a paid plan.
File attachments go to each person's own Google Drive or OneDrive (parts 3 and 4).

---

## Part 3: Google Drive, Sheets and Calendar (optional)

This switches on four things, all running in each person's browser with their own
Google account (no server, free):

- uploading task attachments to **Google Drive**,
- **Export to Google Sheets** and the **task collection sheet**,
- **Sync to Google Calendar**: a separate "Trawpie – team name" calendar with
  deadlines, phases and milestones, kept up to date each time you press Sync.

The calendar *file* download ("Add to calendar") works without any of this.

The app asks Google for the narrowest permissions there are:

| Permission | What it allows |
|---|---|
| `drive.file` | Only files Trawpie created, or files a person picks. Never the rest of their Drive. |
| `calendar.app.created` | Only calendars Trawpie created, and their events. Never their other calendars. |

Your Firebase project is also a Google Cloud project, so everything below happens in
the same project (`uni-teamtrack` for the university group).

1. Open <https://console.cloud.google.com> and pick the project at the top of the page.
2. **APIs & Services ▸ Library**. Search for and **Enable** each of:
   **Google Drive API**, **Google Sheets API**, **Google Calendar API**.
3. **Google Auth Platform** (older screens call it **OAuth consent screen**):
   - **Branding**: app name `Trawpie`, your email as support and developer contact.
   - **Audience**: user type **External**, publishing status **Testing**.
     Under **Test users** add the Google address of everyone in the group
     (up to 100). Only these people can connect Drive, Sheets or Calendar while the app
     is in Testing; everyone else can still use the rest of Trawpie.
   - **Data access ▸ Add or remove scopes**: add
     `https://www.googleapis.com/auth/drive.file` and
     `https://www.googleapis.com/auth/calendar.app.created`, then **Save**.
     (If the calendar scope isn't listed, make sure the Calendar API from step 2 is
     enabled and reopen the list.)
4. **Clients** (or **APIs & Services ▸ Credentials ▸ Create credentials ▸ OAuth client ID**):
   - Application type **Web application**, name `Trawpie web`.
   - **Authorised JavaScript origins** (no paths, no trailing slash):
     `https://uni-teamtrack.web.app`, `https://uni-teamtrack.firebaseapp.com`,
     and `http://127.0.0.1:5173` for testing on your computer.
   - Leave redirect URIs empty. **Create**, then copy the **Client ID**
     (ends in `.apps.googleusercontent.com`; it isn't a secret).
5. Add it to `.env` in the teamtrack folder:
   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```
6. Run `npm run deploy`.
7. Check: open the site, open a task ▸ **Attach a file** ▸ **Upload to my Google Drive**;
   then side panel ▸ **Add deadlines to your calendar** ▸ **Sync to Google Calendar**.
   The first time, Google shows "Google hasn't verified this app": that's expected in
   Testing. Choose **Continue**.

**Opening it to anyone later.** Testing mode is enough for a group. To let people who
aren't on the test-user list connect, set the publishing status to **In production**.
Google then reviews the app; `drive.file` needs only light checks, while calendar
permissions may count as sensitive and need a fuller review that can take days or
weeks. Until then, everyone can still use the calendar file download.

**If something goes wrong:** "Error 400: redirect_uri_mismatch" or "origin not allowed"
means the site address isn't in the origins list in step 4 (it can take a few minutes
to apply). "Access blocked: app has not completed verification" means that Google
account isn't a test user (step 3).

---

## Part 4: Microsoft sign-in and OneDrive (optional)

This adds **Continue with Microsoft** on the sign-in page and **Upload to my OneDrive**
for attachments. One Microsoft "app registration" serves both. Outlook calendars need
nothing extra: the calendar file from **Add deadlines to your calendar** opens in Outlook.

**Before you start, two things to know**

- **You need a Microsoft Entra directory (tenant) to register the app.** Microsoft has
  deprecated registering apps with a personal Microsoft account outside a directory.
  Either create a free Azure account (it comes with a directory; Microsoft may ask for a
  card or phone number to confirm who you are), or ask your university's IT team to
  register it in the university's directory.
- **University Microsoft accounts are often locked down.** Many universities block
  students from approving outside apps, so people see "Need admin approval". Ask IT
  first (there's a ready-made email in the roadmap doc). Personal Microsoft accounts
  (outlook.com, hotmail.com) work straight away.

**Steps** (replace `uni-teamtrack` if your project is called something else)

1. Go to <https://entra.microsoft.com> ▸ **Applications ▸ App registrations ▸ New registration**.
   - Name: `Trawpie`.
   - Supported account types: **Accounts in any organizational directory and personal
     Microsoft accounts** (or only your university's directory, if IT prefers).
   - Leave the redirect URI empty for now and click **Register**.
   - Copy the **Application (client) ID** from the Overview page.
2. **Authentication ▸ Add a platform ▸ Single-page application** (for OneDrive), with
   these redirect URIs:
   `https://uni-teamtrack.web.app/blank.html`,
   `https://uni-teamtrack.firebaseapp.com/blank.html`,
   `http://127.0.0.1:5173/blank.html`.
3. **API permissions ▸ Add a permission ▸ Microsoft Graph ▸ Delegated permissions**:
   tick **Files.ReadWrite**, and check that **User.Read** is listed (it is by default).
   Also add **openid**, **email** and **profile**.
4. For **Continue with Microsoft**:
   - Firebase console ▸ **Authentication ▸ Sign-in method ▸ Add new provider ▸ Microsoft**.
     Turn it on and copy the **callback URL** it shows
     (`https://uni-teamtrack.firebaseapp.com/__/auth/handler`).
   - Back in Entra: **Authentication ▸ Add a platform ▸ Web**, paste that callback URL.
   - **Certificates & secrets ▸ New client secret** (choose 24 months), and copy the
     secret's **Value** straight away (it's only shown once).
   - In Firebase, paste the **Application (client) ID** and the **secret value**, then Save.
   - Put a reminder in your calendar for when the secret expires: Microsoft sign-in stops
     working on that day until you make a new secret and paste it into Firebase.
5. Add the client ID to `.env`:
   ```
   VITE_MS_CLIENT_ID=00000000-0000-0000-0000-000000000000
   ```
6. Run `npm run deploy`. The sign-in page now shows **Continue with Microsoft**, and
   **Attach a file** shows **Upload to my OneDrive**.

**If something goes wrong:** "AADSTS50011 redirect URI mismatch" means a redirect URI in
step 2 or 4 doesn't match exactly. "Need admin approval" means the university blocks
students from approving the app: send IT the email from the roadmap doc, or use a
personal Microsoft account.

---

## Part 5: AI summaries

Nothing to set up. In a team, click **AI summary**:

- **Copy to any AI chatbot (free).** The app builds a prompt from the board (weekly
  update, risks, per-person status, upcoming deadlines, or your own question), copies
  it and opens the chatbot you pick. Paste and send. Nothing is sent automatically.
  You can hide people's names (Person A, B…) before copying.
- **Answer here (optional).** Each person can paste their own Gemini API key from
  <https://aistudio.google.com>. The key stays in their browser only. Google offers a
  free tier with usage limits that change over time.

If the board holds company information, check your organisation's rules before
pasting it into a public chatbot.

---

## Part 6: Plans, Pro Education and the student email check

### 6.1 Make yourself the platform admin (any plan)
1. Firebase console ▸ **Authentication ▸ Users**: copy your **User UID**.
2. **Firestore Database ▸ Start collection** called `admins`. Document ID = your UID, one field `since` (number) = `1`.
3. Sign out and in again. **Settings ▸ Plan** now shows the 🛠 Platform admin tools: set any team's plan, approve Pro requests, and see every team on Pro Education.

### 6.2 Students with a university sign-in
Nothing to set up. Anyone signed in with a verified university email (`.ac.uk`, `.edu`, `.ac.xx`, `.edu.xx`, ETH, EPFL) sees **Turn on free Pro Education** on Settings ▸ Plan — up to 3 teams a year, enforced by the security rules.

### 6.3 Email: student codes, @mention emails and the Monday digest (Blaze plan)
All three are Cloud Functions in `functions/`, sending through **Resend** from `notifications@mail.trawpie.org`.

**A. Resend (once)**
1. Sign up at resend.com ▸ **Domains ▸ Add domain** ▸ `mail.trawpie.org` (region: Ireland, eu-west-1).
2. Resend shows DNS records (an MX and TXT for `send.mail`, a DKIM TXT `resend._domainkey.mail`). In **GoDaddy ▸ My Products ▸ trawpie.org ▸ DNS ▸ Add record**, add each one exactly as shown — in GoDaddy's *Name* box type only the part before `.trawpie.org` (e.g. `send.mail`).
3. Add a DMARC record if you have none: type **TXT**, name `_dmarc`, value `v=DMARC1; p=none;`.
4. Back in Resend press **Verify**. It can take a few minutes (up to a few hours).
5. **API Keys ▸ Create** ▸ permission **Sending access**, domain `mail.trawpie.org`. Copy it — you'll paste it into the terminal in B, never into chat or a file.

**B. Deploy the functions (from your Mac, in the project folder)**
```
cd functions && npm install && cd ..
npx firebase deploy --only functions
```
First time it asks to enable Cloud Functions, Cloud Build, Artifact Registry, Cloud Scheduler — answer **y**. Then:
- `RESEND_API_KEY` → paste the key (input is hidden)
- `MAIL_FROM` → `Trawpie <notifications@mail.trawpie.org>`
- `APP_URL` → `https://uni-teamtrack.web.app`
If it complains about the region, open **Firestore ▸ Settings**, note the location, and change `REGION` at the top of `functions/index.js` to match (London = `europe-west2`, `eur3` = `europe-west1`, `nam5` = `us-central1`).

**C. Switch on the student code form:** in `.env` set `VITE_STUDENT_EMAIL_CHECK=true`, then `npm run deploy`.

What runs: student codes (15 min, 5 an hour, hashed), an email to each @mentioned person in teams on Pro/Pro Education/Organisation, and the Monday 08:00 digest of overdue and next-7-days tasks. Everyone can switch the emails off in **My account ▸ Email notifications**.

### 6.4 Error reports
Crashes in people's browsers appear under **Settings ▸ Plan ▸ Platform admin ▸ Recent errors** (no personal data). To delete reports automatically after 30 days: **Firestore ▸ Time-to-live ▸ Create policy** ▸ collection group `clientErrors`, field `expireAt`.

### 6.5 GitHub sync (Blaze plan)

Two Cloud Functions do this: `githubConnect` (makes a secret for a team) and `githubWebhook` (GitHub calls it). They are deployed with the others:

```
firebase deploy --only functions
```

No GitHub token or app is needed. In Trawpie, someone who manages team settings opens **Settings ▸ Integrations ▸ GitHub**, types the repository (`owner/name`) and presses **Connect**. Trawpie shows a payload URL and a secret; on GitHub, open the repository's **Settings ▸ Webhooks ▸ Add webhook**, paste both, choose `application/json`, and tick **Issues** and **Pull requests**. The secret is stored in `teams/{team}/private/github`, which no one can read from the app.

After that:
- a pull request whose title, description or branch name has a task's reference (`TT-XXXXXX`, shown on every task with a **Copy branch name** button) is linked to that task, and finishes it when merged;
- a new issue becomes a task for the person chosen in the settings, unless it names a task (issues raised from the app's **Raise an issue** form do), and closing it finishes the task;
- nothing finishes a task past a sign-off that hasn't been given.

GitHub's webhook page shows each delivery and Trawpie's answer, which is the first place to look if something doesn't link.

## Moving data from the old single-file tracker
In a team, open the side panel and click **Import tasks (Excel, CSV or old tracker)**.
Choose the old tracker's Excel file (the one with the `Database_DO_NOT_EDIT` sheet) or
a JSON backup from it. The app shows a preview before
adding anything. Ordinary Excel or CSV task lists can be imported the same way.

## Troubleshooting
| Problem | Fix |
|---|---|
| "This sign-in method isn't switched on" | Part 2.3: enable Email/Password or Google in Firebase. |
| Google sign-in pop-up closes straight away | Allow pop-ups for the site. If using your own domain, add it under Authentication ▸ Settings ▸ Authorized domains. |
| "You don't have permission to do that" | Your role doesn't allow it. Ask the owner, or check Settings ▸ Roles. |
| Invitation doesn't appear | The teammate must sign in with the invited address and verify it. |
| Changed `.env` but nothing happened | Run `npm run deploy` again. |
| "Missing index" error in the browser console | Run `npm run deploy` (it uploads `firestore.indexes.json`) and wait a few minutes. |

## Deploying from GitHub (automatic)

Every push to `main` runs all the tests on GitHub (Actions tab). If they pass, the website and the
security rules are deployed to uni-teamtrack. Cloud Functions are deployed only when you press
**Actions ▸ CI ▸ Run workflow** and tick "Also deploy the Cloud Functions".

One-time setup — a key GitHub can deploy with:

1. Google Cloud console ▸ project **uni-teamtrack** ▸ **IAM & Admin ▸ Service Accounts ▸ Create service account**,
   name `github-deploy`. Give it the roles **Firebase Admin** and **Service Account User**
   (and **Cloud Functions Admin** if GitHub should deploy functions too).
2. Open the new account ▸ **Keys ▸ Add key ▸ Create new key ▸ JSON**. A file downloads.
3. GitHub ▸ TRAWPIE ▸ **Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret**:
   name `FIREBASE_SERVICE_ACCOUNT`, value = the whole contents of that file. Save, then delete the file.

The site's public settings live in `.env.live` (used by `npm run build:live`); your own `.env` is
only used on your computer. Never put the Resend key or the service-account key in the repository.

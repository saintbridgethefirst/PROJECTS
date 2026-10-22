# Trawpie

*Technical Research And Welfare for People In Education* · part of **Penteint**.
(Formerly TeamTrack. The Firebase project id stays `uni-teamtrack`; old GitHub issues that say “TeamTrack: TT-…” still link.)

A team progress tracker you can host as a website. People sign in, join their team by
email invitation, and plan work week by week, with roles, deadlines, analytics and
AI summaries.

It grew out of the single-file "R&D Team Progress Tracking Dashboard" (v13): the
board, right-click menus, deadlines, timeline and analytics are the same, now backed
by real accounts and a shared database instead of a shared Excel file.

**To set it up, follow [SETUP.md](SETUP.md).** Without any settings it runs in demo
mode, so `npm install` then `npm run dev` is enough to try it.

## Features
- **Accounts:** email and password, Google, optionally Microsoft. Invitations only
  work for verified email addresses.
- **Teams and invites:** create teams, invite by email, accept or decline, leave,
  remove members, delete a team.
- **Roles:** Owner, Admin, Member, Viewer, plus custom roles built from eight
  permissions. Enforced in the app **and** on the server (`firestore.rules`).
- **Customisable:** team name and logo, your own account photo (shown to your teams), task icons (emoji or small image), custom
  fields (text, number, date, dropdown, checkbox, link, person) with "show on card",
  and renamable or hideable built-in labels.
- **Board:** weeks, categories, tasks, sub-tasks, priorities, status flags,
  deadlines, week numbering (WEEK 1, 2, 3… or calendar weeks), carry-forward, supporting people, right-click menus, undo/redo of your
  own changes, live updates from teammates, offline editing.
- **Project phases:** split the project into stages (e.g. Research → Design → Build →
  Test) with dates and milestones; tag tasks with a phase, filter the board by phase, and
  see progress per phase and phase bands on the timeline.
- **Teamwork:** comments on every task (members can comment even on tasks they can't
  edit; viewers read only), @mentions with autocomplete and an unread badge, an Activity
  panel (your mentions + a team-wide feed of changes and comments), and **My tasks** on
  the team list: everything you own or support across all your teams, by deadline.
- **Phone app:** install Trawpie on a phone's home screen (or a computer's dock); it
  opens full-screen and starts without a connection.
- **Search everything:** Ctrl+K (⌘K) or 🔍 finds tasks (even by sub-task or reference),
  comments, people, phases, weeks and actions.
- **Templates and repeating tasks:** save a task with its sub-tasks as a template; make a
  task repeat every 1, 2 or 4 weeks, with an optional end date.
- **Kanban view:** switch the board to To do · Doing · Done columns (top bar ▸ Kanban). Drag
  cards between columns (or Alt + ← →), filter by week or person, and show one row per person.
- **Dependencies:** a task can wait on others; cards warn (⚠) when a task it waits on is
  overdue, due later, or planned for a later week. The editor lists what each task blocks.
- **Effort, workload and burndown:** estimate hours per task; Analytics ▸ Planning shows hours
  per person per week against the team's weekly capacity, a burndown per phase, and tasks
  waiting on late work.
- **Features you switch on (Settings ▸ Features):** core features are always on; Planning,
  Meetings, Lab notebook and Literature are on by default; Parts, Finance, People and capacity,
  Time logging, Risk register and Requirements are advanced features a team turns on when it
  needs them. Turning one off hides it everywhere; nothing is deleted.
- **People and capacity:** hours a week, skills and time off per person; a workload heatmap;
  "needs skill" on tasks with suggestions of who has the skill and free hours; workload across
  all your teams (👥 Workload on the team list).
- **Time logging:** log hours on tasks against the estimate; timesheet export.
- **Risk register and requirements:** a likelihood × impact grid with owners and plans;
  requirements linked to the tasks that deliver them, verification and a traceability export.
- **Tools (🧰 Tools):** meeting notes whose action items become tasks; a parts and
  orders list; finance (budget lines, spending with receipts, income, money committed by orders,
  burn-rate forecast, Excel export) for roles with the finance permissions; a literature list
  (add by DOI, reading status, tags, BibTeX import and export, links to tasks).
- **Progress report:** one click (Analytics ▸ 📄 Progress report, or Ctrl+K) builds a report for a
  supervisor: pick a period, a person and the sections, add a note, then print / save as PDF,
  download for Word or copy as text for an email.
- **Lab notebook:** dated entries with photos on every task.
- **Carried-forward tasks:** copies carried into later weeks stay linked. Edits flow into later
  weeks, and analytics, the timeline, Kanban and My tasks show the chain once ("↪ 3 wks").
- **Circle menu:** choose a circle (radial) right-click menu instead of the list in Your
  account; same actions, with sub-menus on an outer ring (or replacing the ring on phones).
- **Theme packs:** 11 colour themes (Midnight, Ocean, Forest, Grape, Graphite, Daylight,
  Paper, Sakura, Mint and two high-contrast ones) plus "Match my device". Each person picks
  their own, and it follows them to every device they sign in on.
- **GitHub links:** paste an issue or pull-request link on a task to see whether it's
  open, closed or merged; when everything linked is done, one click completes the task.
- **Calendars:** "Add to calendar" downloads deadlines, phases and milestones as an
  .ics file for any calendar app, and **Sync to Google Calendar** keeps a separate team
  calendar in your own Google account up to date.
- **Analytics:** KPIs, insights, workload per person, deadline buckets and a timeline
  showing the days left on every task.
- **Files:** attach links, or upload to Google Drive or OneDrive and share with the team.
- **Google Sheets:** export the board, or send teammates a collection sheet and
  import what they fill in.
- **Import and export:** Excel and CSV import (including the old tracker's file, Jira's
  CSV export and Trello's board export),
  Excel report, JSON backup.
- **AI summary:** builds a prompt from the board for any chatbot (free, nothing sent
  automatically), or answers in the app with your own Gemini key.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Run locally at http://127.0.0.1:5173 |
| `npm run build` | Build the website into `dist/` |
| `npm run deploy` | Build and publish to Firebase (site, rules, indexes) |
| `npm test` | Unit tests, including every permission scenario against the rules model |
| `npm run test:e2e` | Browser test: three teammates in three tabs (demo mode; needs `npx vite preview --port 4173` running) |
| `npm run test:phase5` | Browser test of the installable app (offline), search, templates and repeating tasks (same preview server) |
| `npm run test:features` | Browser test of feature switches, people and capacity, time logging, risks, requirements and workload across teams (same preview server) |
| `npm run test:phase8` | Browser test of the progress report: options, preview, Word, copy, finance gating (same preview server) |
| `npm run test:phase7` | Browser test of meetings, parts, finance, literature, the lab notebook and carried-forward chains (same preview server) |
| `npm run test:phase6` | Browser test of Kanban, dependencies, effort, workload and burndown, with permissions and a phone (same preview server) |
| `npm run test:delete` | Browser test of deleting tasks every way (editor, menus, phone), undo, repeats and permissions (same preview server) |
| `npm run test:radial` | Browser test of the circle right-click menu on desktop and iPhone (same preview server) |
| `npm run test:phase4` | Browser test of Jira and Trello import and GitHub links (same preview server) |
| `npm run test:google` | Calendar export and Google Drive, Sheets and Calendar against a stand-in for Google (builds its own copy on port 4174) |
| `npm run test:themes` | Browser test of the theme packs: picker, every pack, contrast, saved on the account (same preview server) |
| `npm run test:collab` | Browser test of comments, @mentions, the Activity panel and My tasks with three teammates (same preview server) |
| `npm run test:phases` | Browser test of project phases: settings, tagging, filter, analytics, timeline, viewer (same preview server) |
| `npm run test:auth` | Browser test of the live sign-in screen with a fake backend (same preview server) |
| `npm run test:rules` | The same permission scenarios against the real `firestore.rules` in Google's emulator (needs Java 11+) |

## Folder map
```
index.html              page skeleton (sign-in, team list, board)
src/main.js             sign-in, team list, opening a team, the bridge to the board
src/backend/firebase.js live backend (Firebase Auth + Firestore)
src/backend/demo.js     demo backend (browser storage, same permission rules)
src/permissions.js      roles and permissions: the single source of truth
src/rules-sim.js        JavaScript copy of firestore.rules used by demo mode and tests
src/sync.js             turns board edits into per-task database writes
src/model.js            cleans every document read or written
src/themes.js           theme packs (colours in src/themes.css)
src/collab.js           comments, @mentions, Activity panel, My tasks
src/settings.js         team settings: general, members, roles, fields, integrations
src/ai.js               AI summary prompt builder
src/importer.js         Excel, CSV and old-tracker import
src/search.js           search everything (Ctrl+K)
src/research.js         Research: meetings, parts, finance, literature
src/tools-extra.js      Tools: people, timesheet, risks, requirements; workload across teams
src/report.js           progress report (PDF, Word, email text)
src/notebook.js         lab notebook and linked items on each task
src/github.js           GitHub issue / pull-request state on task links
src/calendar.js         calendar file (.ics) export and the Add to calendar dialog
src/integrations/       Google Drive, Sheets and Calendar sync, OneDrive
public/icons/           app logo and icons (phone home screen, browser tab); ref/logo.png is the full-size logo
tools/build-board.mjs   builds public/board/board.js from the v13 board (ref/) plus tools/board-overrides.js
firestore.rules         server-side security rules
```

## Things to know
- Which @mentions you've already seen is remembered per browser, so a mention read on
  your laptop still shows as new the first time you open the team on your phone.
- Each task is its own database document, so two people editing different tasks never
  overwrite each other. If two people edit the **same** task at the same moment, the
  later save wins for the fields both changed.
- The per-task history log is written by the app. It is a useful record of who
  changed what, but not a tamper-proof audit trail.
- Team logos and task icons are stored in the database, so they are kept small
  (about 150 KB and 25 KB). Larger files belong in Drive or OneDrive attachments.

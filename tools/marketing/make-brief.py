"""Builds marketing/TeamTrack-video-brief.pdf: a brief to upload to Gemini (or any AI tool)
with the script, storyboard screenshots, key facts and a ready prompt.
Uses the media in marketing/video-kit (made by capture.mjs / clips.mjs).
    python3 tools/marketing/make-brief.py
"""
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, Table,
                                TableStyle, PageBreak, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'marketing' / 'video-kit'
OUT = ROOT / 'marketing' / 'TeamTrack-video-brief.pdf'

pdfmetrics.registerFont(TTFont('Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')

INK = colors.HexColor('#14213d'); INK2 = colors.HexColor('#44506b'); MUTED = colors.HexColor('#6b7489')
TEAL = colors.HexColor('#0e9f8e'); SUN = colors.HexColor('#fff4d1'); PAPER = colors.HexColor('#f6f2e8'); LINE = colors.HexColor('#ddd5c2')

S = {
    'title': ParagraphStyle('title', fontName='Sans-Bold', fontSize=26, leading=31, textColor=INK, spaceAfter=6),
    'sub': ParagraphStyle('sub', fontName='Sans', fontSize=12.5, leading=18, textColor=INK2, spaceAfter=14),
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=17, leading=22, textColor=INK, spaceBefore=10, spaceAfter=8),
    'h2': ParagraphStyle('h2', fontName='Sans-Bold', fontSize=13, leading=17, textColor=INK, spaceBefore=4, spaceAfter=4),
    'body': ParagraphStyle('body', fontName='Sans', fontSize=10, leading=14.5, textColor=INK2, spaceAfter=6),
    'small': ParagraphStyle('small', fontName='Sans', fontSize=8.5, leading=12, textColor=MUTED),
    'cell': ParagraphStyle('cell', fontName='Sans', fontSize=9, leading=12.5, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='Sans-Bold', fontSize=9, leading=12.5, textColor=INK),
    'mono': ParagraphStyle('mono', fontName='Mono', fontSize=8.6, leading=12.4, textColor=INK),
    'label': ParagraphStyle('label', fontName='Sans-Bold', fontSize=7.5, leading=10, textColor=MUTED),
}

def P(text, style='body'): return Paragraph(text, S[style])

# ── Content ────────────────────────────────────────────────────────────────
SUMMARY = ('TeamTrack is a live team progress tracker for student project teams, competition teams (drone, Formula Student, '
           'robotics), research groups and small engineering teams. Its heart is a shared board of <b>people × weeks</b>: '
           'one row per person, one column per week, with task cards that show progress, deadlines and who is helping. '
           'It updates live for everyone, and teams switch on extra tools as they need them: meetings, a lab notebook, '
           'literature, sub-teams, parts and orders, finance, people and capacity, time logging, risks and requirements.')

FACTS = [
    ('What it is', 'A live team progress tracker: a board of people × weeks with tasks, sub-tasks, deadlines and progress.'),
    ('Who it is for', 'Student project teams, competition teams, research groups and small engineering teams.'),
    ('Free plan', 'Up to 30 people per team and up to 5 teams of your own, with every standard and advanced tool.'),
    ('Students', 'Pro Education is free with a university email (.ac.uk, .edu and similar), for up to 3 teams a year.'),
    ('Pro', 'Per team: up to 100 people, email alerts for @mentions, a Monday digest, and full change history.'),
    ('Views', 'Board, Kanban, Analytics (overview, team, sub-teams, deadlines, phases, planning) and Timeline.'),
    ('Tools', 'Meetings, lab notebook, literature, sub-teams, parts & orders, finance, people & capacity, time logging, risks, requirements.'),
    ('Carry forward', 'An unfinished task moves to next week with its notes, papers, comments, files and logged hours.'),
    ('Weeks', 'Set the start date once; change one week and later weeks follow. Own numbering or calendar weeks, plus a weekly metric badge.'),
    ('Team & roles', 'Invitations are emailed by the server. Roles: Owner, Admin, Member, Viewer, plus custom roles, enforced on the server.'),
    ('Extras', 'Search (Ctrl K), @mentions, AI summary, Excel and Google Sheets export, calendar export, import from Excel, CSV, Jira and Trello.'),
    ('Where', 'In the browser on laptop and phone, and installable like an app. Website: uni-teamtrack.web.app'),
]

# (title, media, alt media, on screen, voiceover, in 60 s cut, seconds in the 60 s cut)
SCENES = [
    ('Hook', '01-signin.jpg', [], 'Your team’s whole week. One picture.', 'Running a student or engineering project with lots of people and moving parts? Meet TeamTrack.', True, 4),
    ('The board', 'clip-01-board-tour.mp4', ['03b-whole-team.jpg'], 'People × weeks, live for everyone', 'It’s a shared board: one row per person, one column per week. Everyone sees who’s doing what, and it updates live.', True, 7),
    ('Progress', 'clip-02-tick-subtasks.mp4', [], 'Tick it off, everyone sees it', 'Break work into sub-tasks. Tick them off and the progress bar moves for the whole team.', True, 5),
    ('What’s late', '09-kanban.jpg', ['03-board.jpg'], 'Late work turns red', 'Late tasks turn red, and the Kanban view shows what’s to do, in progress and done.', False, 0),
    ('Carry forward', 'clip-03-carry-forward.mp4', [], 'Not finished? Carry it forward', 'Not finished this week? Carry it forward. Its notes, papers and comments come with it.', True, 7),
    ('Everything on a task', '05-linked-notebook.jpg', ['04-task-editor.jpg', '06-comments.jpg'], 'Notes, files, papers, comments', 'Each task holds a lab notebook with photos, time logged, linked papers and parts, and comments with @mentions.', False, 0),
    ('Sub-teams', 'clip-05-subteams.mp4', ['08-subteams.jpg'], 'Fuselage, Payload, Electronics…', 'Big team? Split it into sub-teams, each with its own view and progress.', True, 5),
    ('Analytics', 'clip-04-views.mp4', ['10-analytics.jpg', '11-planning.jpg', '13-timeline.jpg'], 'Are we on track?', 'Analytics answers “are we on track?”: completion, overdue work, workload, burndown and a timeline, all worked out for you.', True, 7),
    ('Tools', 'clip-06-tools.mp4', ['15-parts.jpg', '16-finance.jpg', '17-literature.jpg', '20-risks.jpg', '21-requirements.jpg'], 'Parts · Budget · Papers · Risks', 'Switch on the tools you need: parts and orders, budget and spending, literature, risks, requirements, meetings and people’s capacity.', True, 7),
    ('Your calendar', 'clip-08-week-dates.mp4', ['27-weeks.jpg'], 'Weeks that match your calendar', 'Set when week one starts and every week follows. Change one, and the rest move with it.', False, 0),
    ('Invite your team', 'clip-07-invite.mp4', ['25-invite.jpg'], 'Invite by email. We send it.', 'Invite people by email. TeamTrack sends the invitation for you.', True, 5),
    ('Find anything', 'clip-09-search.mp4', ['22-search.jpg', '23-activity.jpg'], 'Search everything · Ctrl K', 'Search finds any task, paper or meeting in a second, and the activity bell shows who mentioned you.', False, 0),
    ('Anywhere, your way', '28-phone.jpg', ['29-dark-theme.jpg'], 'Phone, laptop, 12 themes', 'It works on your phone and laptop, with twelve themes including dark mode.', False, 0),
    ('Free for students', '26-plan.jpg', [], 'Free for teams up to 30 · Free Pro for students', 'It’s free for teams of up to thirty, and students with a university email get Pro free.', True, 6),
    ('Call to action', '30-guide.jpg', ['02-home.jpg'], 'uni-teamtrack.web.app', 'Make your team’s week visible. Try TeamTrack free at uni-teamtrack dot web dot app.', True, 5),
]

MEDIA_NOTES = {
    'clip-01-board-tour.mp4': 'Scrolls the board top to bottom, then jumps to this week', 'clip-02-tick-subtasks.mp4': 'Ticks two sub-tasks; the progress bar grows',
    'clip-03-carry-forward.mp4': 'Right-click → Carry forward; the copy appears next week with its links', 'clip-04-views.mp4': 'Board → Kanban → Analytics → Planning, Sub-teams, Timeline',
    'clip-05-subteams.mp4': 'Filters the board by each sub-team', 'clip-06-tools.mp4': 'Tools: Parts, Finance, Literature, Risks, Requirements, People',
    'clip-07-invite.mp4': 'Types an email, presses Invite & email, shows “Emailed”', 'clip-08-week-dates.mp4': 'Changes Week 1’s start date; later weeks follow',
    'clip-09-search.mp4': 'Searches “carbon” and opens the task',
}

GEMINI_PROMPT = '''I’m attaching a brief for TeamTrack, a team progress tracker I built for student and engineering project teams. It contains a product summary, key facts, a 60-second script, a storyboard with a screenshot of each scene, and the list of screen-recording files I have.

Please act as my video producer and:
1. Tighten the 60-second voiceover so it reads naturally at about 150 words per minute (≈ 140–150 words), keeping it friendly and professional. Keep each line matched to its scene.
2. Give me a shot list for each scene: which of my files to use, which part of the screen to zoom into (use the screenshots), the on-screen text, and the timing.
3. Suggest 3 hooks for the first 3 seconds, and 3 end-card lines.
4. Write a LinkedIn post (founder story: a mechanical design engineer who tracked R&D in spreadsheets and built this for student teams) to go with the video, plus 5 hashtags.
5. Also give me a 2–3 minute YouTube version of the script using the extra scenes.

Rules: only use the facts in the brief. Don’t invent features, numbers, customers or prices. The app shots must come from my real recordings and screenshots, not generated footage.'''

# ── Helpers ────────────────────────────────────────────────────────────────
def img_for(media):
    f = KIT / (media.replace('.mp4', '-poster.jpg') if media.endswith('.mp4') else media)
    return f

def picture(path, width, maxh=None):
    w, h = PILImage.open(path).size
    iw, ih = width, width * h / w
    if maxh and ih > maxh: iw, ih = maxh * w / h, maxh
    return Image(str(path), width=iw, height=ih)

def boxed(flowables, bg=PAPER, pad=8, border=LINE):
    t = Table([[flowables]], colWidths=[None])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.8, border),
                           ('LEFTPADDING', (0, 0), (-1, -1), pad + 2), ('RIGHTPADDING', (0, 0), (-1, -1), pad + 2),
                           ('TOPPADDING', (0, 0), (-1, -1), pad), ('BOTTOMPADDING', (0, 0), (-1, -1), pad)]))
    return t

def footer(canvas, doc):
    canvas.saveState(); canvas.setFont('Sans', 8); canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, 'TeamTrack · explainer video brief · sample data is fictional')
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, str(doc.page)); canvas.restoreState()

# ── Build ──────────────────────────────────────────────────────────────────
doc = BaseDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                      title='TeamTrack — explainer video brief', author='Rushikesh Vibhandik', subject='Script, storyboard and facts for a TeamTrack explainer video')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=footer)])
W = doc.width
story = []

story += [P('TeamTrack — explainer video brief', 'title'),
          P('Script, storyboard, key facts and a ready prompt for making a 60-second LinkedIn video and a 2–3 minute YouTube walkthrough. '
            'The screenshots show a fictional sample team (“Skyhawk UAV”, a 6-person drone-competition team).', 'sub')]
story += [picture(KIT / '03b-whole-team.jpg', W), Spacer(1, 10)]
story += [P('How to use this with Gemini', 'h1'),
          P('Upload this PDF to Gemini and paste the prompt below. Gemini can read the screenshots, so it can tell you where to zoom in each scene. '
            'Then build the video in your editor (invideo, CapCut, etc.) using the screen-recording files listed at the end.'),
          boxed([P('PROMPT TO PASTE', 'label'), Spacer(1, 3)] + [P(line.replace('&', '&amp;') or '&nbsp;', 'mono') for line in GEMINI_PROMPT.split('\n')], bg=SUN, border=colors.HexColor('#e6c66a'))]
story.append(PageBreak())

story += [P('Product summary', 'h1'), P(SUMMARY),
          P('<b>Audience:</b> university students and staff running team projects; competition and research teams. '
            '<b>Tone:</b> friendly, confident, practical. No hype words. <b>Main hook:</b> see your whole team’s week in one picture. '
            '<b>Main offer:</b> free for teams up to 30, and free Pro for students.'), Spacer(1, 6),
          P('Key facts (use only these)', 'h1')]
ft = Table([[P(k, 'cellb'), P(v, 'cell')] for k, v in FACTS], colWidths=[34 * mm, W - 34 * mm])
ft.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -2), 0.5, LINE), ('BACKGROUND', (0, 0), (0, -1), PAPER),
                        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5), ('BOX', (0, 0), (-1, -1), 0.8, LINE)]))
story += [ft, PageBreak()]

# 60-second script table
words = sum(len(x[4].split()) for x in SCENES if x[5])
story += [P('The 60-second script (LinkedIn)', 'h1'),
          P(f'Ten scenes. Times are a guide. The voiceover below is {words} words, which runs just over a minute at a natural pace, '
            'so step 1 of the prompt asks Gemini to tighten it to about 145 words.')]
S['head'] = ParagraphStyle('head', parent=S['cellb'], textColor=colors.white)
rows = [[P('#', 'head'), P('Time', 'head'), P('Scene & media', 'head'), P('On screen', 'head'), P('Voiceover', 'head')]]
t = 0; n = 0
for title, media, alt, on, vo, short, secs in SCENES:
    if not short: continue
    n += 1
    rows.append([P(str(n), 'cell'), P(f'{t}–{t + secs}s', 'cell'), P(f'<b>{title}</b><br/><font size=7.5 color="#6b7489">{media}</font>', 'cell'), P(on, 'cell'), P(vo, 'cell')])
    t += secs
words = sum(len(s[4].split()) for s in SCENES if s[5])
st = Table(rows, colWidths=[9 * mm, 17 * mm, 44 * mm, 36 * mm, W - 106 * mm], repeatRows=1)
st.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, 0), INK), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                        ('LINEBELOW', (0, 1), (-1, -1), 0.5, LINE), ('BOX', (0, 0), (-1, -1), 0.8, LINE),
                        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
story += [st, Spacer(1, 6), P(f'Total: about {t} seconds and {words} words of voiceover. End card: TeamTrack logo · “Free for students” · uni-teamtrack.web.app', 'small'), PageBreak()]

# Storyboard
story += [P('Storyboard — every scene', 'h1'),
          P('Scenes marked “60 s cut” are in the LinkedIn version; the others are extra scenes for the YouTube version. '
            'For video files, the picture is a still frame from the recording.')]
for i, (title, media, alt, on, vo, short, secs) in enumerate(SCENES, 1):
    meta = Table([[P(f'<b>{i:02d} · {title}</b>', 'h2'), P('60 s cut' if short else 'YouTube only', 'small')]], colWidths=[W - 30 * mm, 30 * mm])
    meta.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('ALIGN', (1, 0), (1, 0), 'RIGHT'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0)]))
    block = [meta, picture(img_for(media), W * 0.78, maxh=92 * mm), Spacer(1, 4),
             boxed([P('ON SCREEN', 'label'), P(f'<b>{on}</b>', 'cell')], bg=SUN, pad=5, border=colors.HexColor('#e6c66a')), Spacer(1, 3),
             boxed([P('VOICEOVER', 'label'), P(vo, 'cell')], pad=5), Spacer(1, 3),
             P(f'<b>Media:</b> {media}' + (f' — {MEDIA_NOTES[media]}' if media in MEDIA_NOTES else '') + (f'<br/><b>Extra screenshots:</b> {", ".join(alt)}' if alt else ''), 'small'),
             Spacer(1, 10)]
    story.append(KeepTogether(block))
story.append(PageBreak())

# Long version and files
story += [P('YouTube version (2–3 minutes)', 'h1'),
          P('Use all 15 scenes in order and slow down: show each feature for 8–15 seconds, and let the voiceover explain one thing at a time. '
            'Add a 10-second intro (“In this video I’ll show you how a 6-person drone team plans 6 weeks of work in TeamTrack”) and finish with how to start: '
            'sign in, create a team, invite people, add tasks.'),
          P('Media files', 'h1'),
          P('All files are 1920×1080. Screen recordings are MP4 (no sound) with a visible cursor; screenshots are JPG. '
            'They are in the <b>marketing/video-kit</b> folder of the project.')]
files = sorted(p.name for p in KIT.iterdir() if p.suffix in ('.mp4', '.jpg') and not p.name.endswith('-poster.jpg'))
fr = [[P(f, 'mono'), P(MEDIA_NOTES.get(f, ''), 'cell')] for f in files if f.endswith('.mp4')] + \
     [[P(f, 'mono'), P('Screenshot', 'cell')] for f in files if f.endswith('.jpg')]
ftab = Table(fr, colWidths=[62 * mm, W - 62 * mm])
ftab.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (-1, -2), 0.4, LINE), ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
story += [ftab]

doc.build(story)
print('wrote', OUT, round(OUT.stat().st_size / 1e6, 1), 'MB')

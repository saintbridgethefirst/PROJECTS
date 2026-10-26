"""Build public/templates/dissertation-gantt-chart.xlsx: a free Gantt chart template for a
dissertation or thesis (undergraduate, master's and PhD sheets, plus How to use).

Every date is a formula on the two yellow cells (start and hand-in), so typing your own dates
re-flows the whole plan; the bars are conditional formatting, so they move when a date changes.
Works in Excel, Google Sheets (File > Import) and LibreOffice.

  node tools/templates/gantt-rows.mjs > /tmp/rows.json
  python3 tools/templates/make-gantt-template.py /tmp/rows.json public/templates/dissertation-gantt-chart.xlsx
"""
import json
import sys
from datetime import date

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

FONT = 'Arial'
INK, MUTED = '1F2937', '6B7280'
C = {  # fills
    'phase': '3B5BDB', 'task': '91A7FF', 'done': '2F9E44', 'late': 'E8590C', 'milestone': 'C2255C',
    'week': 'FFF3BF', 'after': 'F1F3F5', 'input': 'FFF59D', 'phaseRow': 'EDF2FF', 'head': 'F8F9FA',
}
fill = lambda hex_: PatternFill('solid', start_color=hex_, end_color=hex_)
f = lambda **k: Font(name=FONT, **k)
thin = Side(style='thin', color='DEE2E6')

FIRST_ROW = 8          # first plan row
GANTT_COL = 7          # column G: first week/month
EXTRA_ROWS = 12        # empty rows, ready for your own tasks
SITE = 'https://trawpie.org/dissertation'


def date_formula(frac):
    if frac == 0:
        return '=$C$3'
    if frac == 1:
        return '=$C$4'
    return f'=$C$3+ROUND({frac}*($C$4-$C$3),0)'


def sheet(wb, title, heading, data, cols, monthly):
    ws = wb.create_sheet(title)
    ws.sheet_view.showGridLines = False
    rows = data['rows']
    last = FIRST_ROW + len(rows) + EXTRA_ROWS - 1
    lastcol = GANTT_COL + cols - 1
    L = get_column_letter
    g0, gN = L(GANTT_COL), L(lastcol)

    ws['A1'] = heading
    ws['A1'].font = f(bold=True, size=16, color=INK)
    ws['A2'] = 'Free template from Trawpie: ' + SITE.replace('https://', '')
    ws['A2'].hyperlink = SITE
    ws['A2'].font = f(size=10, color='3B5BDB', underline='single')

    for r, label, val in ((3, 'Start date', date.fromisoformat(data['start'])),
                          (4, 'Thesis submission' if monthly else 'Hand-in date', date.fromisoformat(data['handIn']))):
        ws.cell(r, 1, label).font = f(bold=True, color=INK)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=4)
        c = ws.cell(r, 3, val)
        c.number_format = 'ddd d mmm yyyy'
        c.alignment = Alignment(horizontal='center')
        c.fill = fill(C['input'])
        c.font = f(bold=True, color='0000FF')
        c.border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws['E3'] = '← type your dates in the yellow cells; every date below moves with them'
    ws['E3'].font = f(size=9, italic=True, color=MUTED)
    ws['A5'] = 'Today'
    ws['A5'].font = f(bold=True, color=INK)
    ws.merge_cells('C5:D5')
    ws['C5'] = '=TODAY()'
    ws['C5'].number_format = 'ddd d mmm yyyy'
    ws['C5'].font = f(color=INK)
    ws['C5'].alignment = Alignment(horizontal='center')

    # Legend (row 4/5, beside the dates)
    legend = [('phase', 'Phase'), ('task', 'Task'), ('done', 'Done'), ('late', 'Late'), ('milestone', 'Milestone ◆'),
              ('week', 'This month' if monthly else 'This week')]
    col = 5
    ws.cell(5, col, 'Key:').font = f(size=9, bold=True, color=MUTED)
    col += 1
    for key, text in legend:
        sw = ws.cell(5, col + 1)
        sw.fill = fill(C[key])
        ws.cell(5, col + 2, text).font = f(size=9, color=INK)
        col += 4

    # Header rows: 6 = week number (or year), 7 = column dates
    heads = ['Task', 'Type', 'Start', 'End', 'Days', 'Status']
    for i, h in enumerate(heads, 1):
        c = ws.cell(7, i, h)
        c.font = f(bold=True, color=INK, size=10)
        c.fill = fill(C['head'])
        c.alignment = Alignment(vertical='bottom', horizontal='left' if i == 1 else 'center')
        c.border = Border(bottom=Side(style='medium', color='ADB5BD'))
    for k in range(cols):
        cl = L(GANTT_COL + k)
        if monthly:
            top = f'=IF(OR(MONTH({cl}7)=1,COLUMN()={GANTT_COL}),YEAR({cl}7),"")'
            d = f'=DATE(YEAR($C$3),MONTH($C$3),1)' if k == 0 else f'=EDATE({L(GANTT_COL + k - 1)}7,1)'
            fmt = 'mmm'
        else:
            top = k + 1
            d = '=$C$3-WEEKDAY($C$3,3)' if k == 0 else f'={L(GANTT_COL + k - 1)}7+7'
            fmt = 'd mmm'
        t = ws.cell(6, GANTT_COL + k, top)
        t.font = f(size=8, color=MUTED, bold=monthly)
        t.alignment = Alignment(horizontal='center')
        c = ws.cell(7, GANTT_COL + k, d)
        c.number_format = fmt
        c.font = f(size=8, color=INK)
        c.fill = fill(C['head'])
        c.alignment = Alignment(text_rotation=90, horizontal='center', vertical='bottom')
        c.border = Border(bottom=Side(style='medium', color='ADB5BD'))
        ws.column_dimensions[cl].width = 3.6 if monthly else 3.4
    ws.row_dimensions[7].height = 44
    ws.cell(6, 6, 'Year' if monthly else 'Week').font = f(size=8, color=MUTED)
    ws.cell(6, 6).alignment = Alignment(horizontal='right')

    # Plan rows, then empty rows ready for your own tasks
    end_of = (lambda cl: f'EOMONTH({cl}$7,0)') if monthly else (lambda cl: f'{cl}$7+6')
    for i in range(last - FIRST_ROW + 1):
        r = FIRST_ROW + i
        row = rows[i] if i < len(rows) else None
        if row:
            ws.cell(r, 1, ('   ' if row['type'] != 'Phase' else '') + row['name'])
            ws.cell(r, 2, row['type'])
            ws.cell(r, 3, date_formula(row['start']))
            ws.cell(r, 4, date_formula(row['end']))
            ws.cell(r, 6, '' if row['type'] == 'Phase' else 'Not started')
        ws.cell(r, 5, f'=IF(AND(ISNUMBER(C{r}),ISNUMBER(D{r})),D{r}-C{r}+1,"")')
        for c in range(1, 7):
            cell = ws.cell(r, c)
            cell.font = f(size=10, color=INK, bold=bool(row and row['type'] == 'Phase'))
            cell.border = Border(bottom=thin)
            if c in (3, 4):
                cell.number_format = 'd mmm yy'
            if c >= 2:
                cell.alignment = Alignment(horizontal='center')
        for k in range(cols):
            cl = L(GANTT_COL + k)
            cell = ws.cell(r, GANTT_COL + k, f'=IF(AND($B{r}="Milestone",$D{r}>={cl}$7,$D{r}<={end_of(cl)}),"◆","")')
            cell.font = f(size=9, bold=True, color='FFFFFF')
            cell.alignment = Alignment(horizontal='center')
            cell.border = Border(bottom=thin, left=Side(style='hair', color='E9ECEF'))

    # Bars: conditional formatting, so they follow the dates. Earlier rules win.
    grid = f'{g0}{FIRST_ROW}:{gN}{last}'
    a, r0 = g0, FIRST_ROW
    over = f'AND(ISNUMBER($C{r0}),ISNUMBER($D{r0}),$C{r0}<={end_of(a)},$D{r0}>={a}$7)'
    rules = [
        (f'AND($B{r0}="Milestone",$D{r0}>={a}$7,$D{r0}<={end_of(a)})', 'milestone'),
        (f'AND($F{r0}="Done",{over})', 'done'),
        (f'AND($B{r0}<>"Phase",$F{r0}<>"Done",ISNUMBER($D{r0}),$D{r0}<TODAY(),{over})', 'late'),
        (f'AND($B{r0}="Phase",{over})', 'phase'),
        (f'AND($B{r0}="Task",{over})', 'task'),
        (f'AND(TODAY()>={a}$7,TODAY()<={end_of(a)})', 'week'),
        (f'{a}$7>$C$4', 'after'),
    ]
    for formula, key in rules:
        ws.conditional_formatting.add(grid, FormulaRule(formula=[formula], fill=fill(C[key]), stopIfTrue=False))
    ws.conditional_formatting.add(f'{g0}7:{gN}7', FormulaRule(formula=[f'AND(TODAY()>={a}$7,TODAY()<={end_of(a)})'], fill=fill('FFE066')))
    ws.conditional_formatting.add(f'A{r0}:F{last}', FormulaRule(formula=[f'$B{r0}="Phase"'], fill=fill(C['phaseRow'])))
    ws.conditional_formatting.add(f'A{r0}:A{last}', FormulaRule(formula=[f'$B{r0}="Milestone"'], font=Font(name=FONT, bold=True, color=C['milestone'])))
    ws.conditional_formatting.add(f'F{r0}:F{last}', FormulaRule(formula=[f'$F{r0}="Done"'], font=Font(name=FONT, bold=True, color=C['done'])))

    dv_type = DataValidation(type='list', formula1='"Phase,Task,Milestone"', allow_blank=True)
    dv_status = DataValidation(type='list', formula1='"Not started,In progress,Done"', allow_blank=True)
    ws.add_data_validation(dv_type)
    ws.add_data_validation(dv_status)
    dv_type.add(f'B{r0}:B{last}')
    dv_status.add(f'F{r0}:F{last}')

    ws.column_dimensions['A'].width = 46
    ws.column_dimensions['B'].width = 11
    ws.column_dimensions['C'].width = 11
    ws.column_dimensions['D'].width = 11
    ws.column_dimensions['E'].width = 6
    ws.column_dimensions['F'].width = 12
    ws.freeze_panes = ws.cell(FIRST_ROW, GANTT_COL)
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = '6:7'
    return ws


def how_to(wb):
    ws = wb.active
    ws.title = 'How to use'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 4
    ws.column_dimensions['B'].width = 120
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    lines = [
        ('Dissertation and thesis Gantt chart template', 'h1'),
        ('Free from Trawpie. Undergraduate, master’s and PhD sheets: pick the tab for your level.', 'p'),
        ('', 'p'),
        ('How to use it', 'h2'),
        ('1. Type your start date and hand-in (or thesis submission) date in the two yellow cells at the top of your sheet.', 'p'),
        ('2. Every date in the plan moves with them: tasks are spread across your time in proportion, the way the plan suggests.', 'p'),
        ('3. Type over any start or end date to fix it to your university’s real deadline (proposal, ethics, draft to supervisor).', 'p'),
        ('4. Set each task’s Status as you go. Done turns the bar green; anything not done after its end date turns orange.', 'p'),
        ('5. The yellow column is this week (this month on the PhD sheet). ◆ marks a milestone.', 'p'),
        ('6. Add your own tasks in the empty rows at the bottom: give them a Type, a start and an end date, and the bars appear.', 'p'),
        ('', 'p'),
        ('Good to know', 'h2'),
        ('Not working with people? Delete the Ethics rows and rename the data collection tasks (experiments, a build, a dataset).', 'p'),
        ('Longer than the chart? Copy the last date column to the right as far as you need; the bars follow.', 'p'),
        ('Dates are proposals, not rules: agree the plan with your supervisor and change it as you learn more.', 'p'),
        ('Opening in Google Sheets: File ▸ Import ▸ Upload, then Replace spreadsheet. The colours and formulas come with it.', 'p'),
        ('', 'p'),
        ('Rather have it done for you?', 'h2'),
        ('Trawpie makes this plan from your hand-in date in about a minute, then keeps it live: tasks with checklists, chapter word counts, a proposal helper, supervisor meetings, draft feedback and reminders in your calendar. Free for students.', 'p'),
        (SITE, 'link'),
    ]
    for i, (text, kind) in enumerate(lines, 2):
        c = ws.cell(i, 2, text)
        if kind == 'h1':
            c.font = f(bold=True, size=18, color=INK)
            ws.row_dimensions[i].height = 28
        elif kind == 'h2':
            c.font = f(bold=True, size=13, color='3B5BDB')
            ws.row_dimensions[i].height = 22
        elif kind == 'link':
            c.hyperlink = SITE
            c.font = f(size=11, color='3B5BDB', underline='single', bold=True)
        else:
            c.font = f(size=11, color=INK)
            c.alignment = Alignment(wrap_text=True, vertical='top')


def main(src, out):
    data = json.load(open(src))
    wb = Workbook()
    how_to(wb)
    sheet(wb, 'Undergraduate', 'Undergraduate dissertation Gantt chart', data['ug'], 36, False)
    sheet(wb, 'Masters', 'Master’s dissertation Gantt chart', data['masters'], 22, False)
    sheet(wb, 'PhD', 'PhD thesis Gantt chart', data['phd'], 56, True)
    wb.active = 1
    wb.calculation.fullCalcOnLoad = True   # no cached values from openpyxl: work everything out on open
    wb.properties.title = 'Dissertation Gantt chart template'
    wb.properties.creator = 'Trawpie'
    wb.save(out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

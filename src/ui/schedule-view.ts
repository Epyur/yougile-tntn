import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CachedTask } from '../types/cache';
import type { CreateTaskPayload } from '../types/yougile';
import { TASKS_VIEW_TYPE, TasksView } from './tasks-view';
import { AssigneeSelector } from './assignee-selector';

function stripHtml(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || el.innerText || '';
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && e.message === 'Failed to fetch') return true;
  if (e instanceof Error && /network|fetch|offline|econnrefused|enotfound|dns|timeout/i.test(e.message)) return true;
  return false;
}

export const SCHEDULE_VIEW_TYPE = 'yougile-schedule-view';

interface CalendarEvent {
  taskId: string;
  title: string;
  place: string;
  targetAudience: string;
  responsibleName: string;
  date: string;
  startTime: string;
  endTime: string;
  deadline: number;
  descriptionRaw: string;
  completed: boolean;
  columnId: string;
  additionalInfo: string;
  reportHtml: string;
  parentTaskId: string;
  parentAutoComplete: boolean;
}

function parseCalendarEvent(task: CachedTask): CalendarEvent | null {
  if (!task.deadline) return null;
  const dl = new Date(task.deadline);
  const dateStr = dl.toISOString().slice(0, 10);

  let place = '';
  let targetAudience = '';
  let startTime = '';
  let endTime = '';
  let additionalInfo = '';
  let reportHtml = '';
  let descriptionRaw = task.description;
  let parentTaskId = '';
  let parentAutoComplete = false;

  if (task.description) {
    const reportIdx = task.description.indexOf('<!--REPORT-->');
    const jsonPart = reportIdx !== -1 ? task.description.substring(0, reportIdx).trim() : task.description.trim();
    if (reportIdx !== -1) {
      reportHtml = task.description.substring(reportIdx + '<!--REPORT-->'.length).trim();
    }

    if (jsonPart.startsWith('{') || jsonPart.startsWith('[')) {
      try {
        const parsed = JSON.parse(jsonPart);
        if (parsed && typeof parsed === 'object') {
          place = parsed.place || '';
          targetAudience = parsed.targetAudience || '';
          startTime = parsed.startTime || '';
          endTime = parsed.endTime || '';
          additionalInfo = parsed.additionalInfo || '';
          parentTaskId = parsed.parentTaskId || '';
          parentAutoComplete = parsed.parentAutoComplete === true;
          descriptionRaw = JSON.stringify(parsed, null, 2);
        }
      } catch {
        const mdMatch = jsonPart.match(/^---\n([\s\S]*?)\n---/);
        if (mdMatch) {
          const mdBody = mdMatch[1];
          for (const line of mdBody.split('\n')) {
            const [key, ...vals] = line.split(':');
            const val = vals.join(':').trim();
            if (key.trim() === 'place') place = val;
            else if (key.trim() === 'targetAudience') targetAudience = val;
            else if (key.trim() === 'startTime') startTime = val;
            else if (key.trim() === 'endTime') endTime = val;
          }
        }
      }
    }
  }

  return {
    taskId: task.id,
    title: task.title,
    place,
    targetAudience,
    responsibleName: task.assigned.length > 0 ? task.assigned[0] : '',
    date: dateStr,
    startTime,
    endTime,
    deadline: task.deadline,
    descriptionRaw,
    completed: task.completed,
    columnId: task.columnId,
    additionalInfo,
    reportHtml,
    parentTaskId,
    parentAutoComplete,
  };
}

function parseDescriptionToMd(event: CalendarEvent): string {
  const lines = [
    `Название мероприятия: ${event.title}`,
    `Место проведения: ${event.place}`,
    `Целевая аудитория: ${event.targetAudience}`,
    `Дата проведения: ${event.date}`,
    `Время начала: ${event.startTime}`,
    `Время окончания: ${event.endTime}`,
  ];
  if (event.responsibleName) {
    lines.push(`Ответственный: ${event.responsibleName}`);
  }
  return lines.join('\n');
}

function buildEventDescription(title: string, place: string, targetAudience: string, startTime: string, endTime: string, additionalInfo: string, parentTaskId?: string, parentAutoComplete?: boolean): string {
  const data: Record<string, unknown> = {};
  data.title = title;
  data.place = place;
  data.targetAudience = targetAudience;
  data.startTime = startTime;
  data.endTime = endTime;
  data.additionalInfo = additionalInfo;
  if (parentTaskId) {
    data.parentTaskId = parentTaskId;
    data.parentAutoComplete = parentAutoComplete === true;
  }
  return JSON.stringify(data, null, 2);
}

export class ScheduleView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private currentYear: number;
  private currentMonth: number;
  private selectedDate: string | null = null;
  private createViewActive = false;
  private dayViewActive = false;
  private filterMode: 'all' | 'events' | 'docs' = 'events';
  private selectedColumnIds: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth();
  }

  getViewType(): string {
    return SCHEDULE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Расписание мероприятий';
  }

  getIcon(): string {
    return 'calendar';
  }

  async onOpen(): Promise<void> {
    try {
      const container = this.contentEl;
      container.addClass('mailer-yougile-container');
      this.containerElContent = container.createDiv();
      const ids = this.filterMode === 'docs'
        ? this.plugin.settings.docsSelectedColumnIds
        : this.plugin.settings.calendarSelectedColumnIds;
      this.selectedColumnIds = new Set((ids || '').split(',').filter(Boolean));
      this.renderCalendar();
      void this.syncAndRender();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('ScheduleView onOpen error:', msg, e);
      if (this.containerElContent) {
        this.containerElContent.empty();
        this.containerElContent.createDiv({ text: `Ошибка: ${msg}`, cls: 'mailer-yougile-error' });
      }
    }
  }

  private renderCalendar(): void {
    try {
      const container = this.containerElContent;
      if (!container) {
        console.error('renderCalendar: containerElContent is null');
        return;
      }
      container.empty();
      this.dayViewActive = false;
      this.createViewActive = false;

      const headerEl = container.createDiv({ cls: 'mailer-yougile-header mailer-flex-space-between' });

      const navLeft = headerEl.createDiv({ cls: 'mailer-yougile-header' });
      const prevBtn = navLeft.createEl('button', { text: '◀', cls: 'mailer-yougile-refresh-btn' });
      const monthYearLabel = navLeft.createEl('span', { text: this.getMonthYearLabel(), cls: 'mailer-bold mailer-mx-8' });
      const nextBtn = navLeft.createEl('button', { text: '▶', cls: 'mailer-yougile-refresh-btn' });

      const filterToggle = container.createEl('select');
      filterToggle.addClass('dropdown');
      filterToggle.addClass('mailer-mb-8');
    filterToggle.addClass('mailer-w-auto');
      filterToggle.createEl('option', { value: 'all', text: 'Все задачи с дедлайном' });
      filterToggle.createEl('option', { value: 'events', text: 'Расписание мероприятий' });
      filterToggle.createEl('option', { value: 'docs', text: 'Документы' });
      filterToggle.value = this.filterMode;
      const columnFilterContainer = container.createDiv({ cls: 'mailer-mb-8' });

      filterToggle.addEventListener('change', () => {
        this.filterMode = filterToggle.value as 'all' | 'events' | 'docs';
        const ids = this.filterMode === 'docs'
          ? this.plugin.settings.docsSelectedColumnIds
          : this.plugin.settings.calendarSelectedColumnIds;
        this.selectedColumnIds = new Set((ids || '').split(',').filter(Boolean));
        this.renderCalendar();
      });

      if (this.filterMode === 'events' && this.plugin.settings.calendarBoardId) {
        this.renderColumnCheckboxes(columnFilterContainer, this.plugin.settings.calendarBoardId, 'calendarSelectedColumnIds');
      } else if (this.filterMode === 'docs' && this.plugin.settings.docsBoardId) {
        this.renderColumnCheckboxes(columnFilterContainer, this.plugin.settings.docsBoardId, 'docsSelectedColumnIds');
      }

      const navRight = headerEl.createDiv({ cls: 'mailer-yougile-header' });
      const createBtnText = this.filterMode === 'docs' ? '➕ Создать документ' : '➕ Создать мероприятие';
      const createBtn = navRight.createEl('button', { text: createBtnText, cls: 'mailer-yougile-refresh-btn' });
      const syncBtn = navRight.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });

      prevBtn.addEventListener('click', () => {
        this.currentMonth--;
        if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; }
        this.renderCalendar();
      });

      nextBtn.addEventListener('click', () => {
        this.currentMonth++;
        if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; }
        this.renderCalendar();
      });

      createBtn.addEventListener('click', () => {
        if (this.filterMode === 'docs') {
          this.plugin.activateDocumentsView();
        } else {
          this.showCreateForm();
        }
      });

      syncBtn.addEventListener('click', () => this.syncAndRender());

      const syncStatus = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано' });

      const calendarGrid = container.createDiv({ cls: 'mailer-yougile-calendar-grid' });

      const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
      for (const dn of dayNames) {
        const dayHeader = calendarGrid.createDiv({ cls: 'mailer-yougile-calendar-day-header', text: dn });
      }

      const events = this.getCalendarEvents();
      const eventsByDate = new Map<string, CalendarEvent[]>();
      for (const ev of events) {
        const list = eventsByDate.get(ev.date) || [];
        list.push(ev);
        eventsByDate.set(ev.date, list);
      }

      const firstDay = new Date(this.currentYear, this.currentMonth, 1);
      const startDayOfWeek = (firstDay.getDay() + 6) % 7;
      const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
      const todayStr = new Date().toISOString().slice(0, 10);

      for (let i = 0; i < startDayOfWeek; i++) {
        calendarGrid.createDiv();
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = calendarGrid.createDiv({ cls: 'mailer-yougile-calendar-cell' });

        if (dateStr === todayStr) {
          cell.style.backgroundColor = 'var(--interactive-accent)';
          cell.style.color = 'var(--text-on-accent)';
        }

        const dayNum = cell.createDiv({ text: String(day), cls: 'mailer-bold mailer-mb-2' });

        const dayEvents = eventsByDate.get(dateStr) || [];
        for (const ev of dayEvents) {
          const evEl = cell.createDiv({ cls: 'mailer-yougile-calendar-event' });
          evEl.setText(ev.title);
          if (ev.completed) {
            evEl.style.backgroundColor = 'var(--color-green)';
          }
        }

        cell.addEventListener('click', () => {
          this.selectedDate = dateStr;
          this.renderDayView(dateStr, dayEvents);
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('renderCalendar error:', msg, e);
      const container = this.containerElContent;
      if (container) {
        container.empty();
        const errEl = container.createDiv({ cls: 'mailer-yougile-error' });
        errEl.setText(`Ошибка календаря: ${msg}`);
        errEl.createEl('button', { text: '🔄 Повторить', cls: 'mailer-yougile-refresh-btn' })
          .addEventListener('click', () => this.renderCalendar());
      }
    }
  }

  private getMonthYearLabel(): string {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${months[this.currentMonth]} ${this.currentYear}`;
  }

  private isDocumentTask(task: { description: string }): boolean {
    if (!task.description) return false;
    const desc = task.description.trim();
    if (!desc.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(desc);
      return !!(parsed && typeof parsed === 'object' && parsed.type === 'document');
    } catch {
      return false;
    }
  }

  private renderColumnCheckboxes(container: HTMLElement, boardId: string, settingKey: 'calendarSelectedColumnIds' | 'docsSelectedColumnIds'): void {
    const columns = this.plugin.db.getColumns().filter(c => c.boardId === boardId);
    columns.sort((a, b) => a.title.localeCompare(b.title));
    container.createDiv({ text: 'Колонки:', cls: 'mailer-yougile-task-meta' });
    for (const col of columns) {
      const wrapper = container.createEl('label');
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.marginRight = '12px';
      wrapper.style.marginTop = '4px';
      wrapper.style.fontSize = 'var(--font-smaller)';
      wrapper.style.cursor = 'pointer';
      wrapper.style.whiteSpace = 'nowrap';
      const cb = wrapper.createEl('input', { attr: { type: 'checkbox' } });
      cb.style.width = '16px';
      cb.style.height = '16px';
      cb.style.margin = '0 4px 0 0';
      cb.style.flexShrink = '0';
      cb.checked = this.selectedColumnIds.size === 0 || this.selectedColumnIds.has(col.id);
      if (cb.checked) this.selectedColumnIds.add(col.id);
      const span = wrapper.createEl('span');
      span.setText(col.title);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.selectedColumnIds.add(col.id);
        } else {
          this.selectedColumnIds.delete(col.id);
        }
        this.plugin.settings[settingKey] = Array.from(this.selectedColumnIds).join(',');
        void this.plugin.saveSettings();
        this.renderCalendar();
      });
    }
  }

  private getCalendarEvents(): CalendarEvent[] {
    const tasks = this.plugin.db.getTasks();
    const projectId = this.filterMode === 'docs' ? this.plugin.settings.docsProjectId : this.plugin.settings.calendarProjectId;
    const boardId = this.filterMode === 'docs' ? this.plugin.settings.docsBoardId : this.plugin.settings.calendarBoardId;

    let filtered = tasks;
    if (this.filterMode === 'events' || this.filterMode === 'docs') {
      if (projectId) filtered = filtered.filter(t => t.projectId === projectId);
      if (boardId) filtered = filtered.filter(t => t.boardId === boardId);
      if (this.selectedColumnIds.size > 0) {
        filtered = filtered.filter(t => this.selectedColumnIds.has(t.columnId));
      }
      if (this.filterMode === 'docs') {
        filtered = filtered.filter(t => this.isDocumentTask(t));
      }
    }
    filtered = filtered.filter(t => !!t.deadline);

    const events: CalendarEvent[] = [];
    for (const t of filtered) {
      const ev = parseCalendarEvent(t);
      if (ev) events.push(ev);
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    return events;
  }

  private renderDayView(dateStr: string, dayEvents: CalendarEvent[]): void {
    const container = this.containerElContent;
    container.empty();
    this.dayViewActive = true;
    this.createViewActive = false;

    const backBtn = container.createEl('button', { text: '← Назад к календарю', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderCalendar());

    container.createEl('h3', { text: `Расписание на ${dateStr}` });

    const createForDayBtn = container.createEl('button', { text: '➕ Создать мероприятие', cls: 'mailer-yougile-refresh-btn mailer-mb-12' });
    createForDayBtn.addEventListener('click', () => this.showCreateFormWithDate(dateStr));

    if (dayEvents.length === 0) {
      container.createDiv({ text: 'Нет мероприятий на этот день', cls: 'mailer-yougile-empty' });
      return;
    }

    dayEvents.sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (const ev of dayEvents) {
      const evEl = container.createDiv({ cls: 'mailer-yougile-task-item' });
      const bodyEl = evEl.createDiv({ cls: 'mailer-yougile-task-body' });

      const titleEl = bodyEl.createDiv({ cls: `mailer-yougile-task-title${ev.completed ? ' completed' : ''}` });
      titleEl.setText(ev.title);

      const detailLines: string[] = [];
      if (ev.startTime) detailLines.push(`🕐 ${ev.startTime}${ev.endTime ? ` - ${ev.endTime}` : ''}`);
      if (ev.place) detailLines.push(`📍 ${ev.place}`);
      if (ev.targetAudience) detailLines.push(`👥 ${ev.targetAudience}`);
      if (ev.responsibleName) detailLines.push(`👤 ${ev.responsibleName}`);
      if (detailLines.length > 0) {
        bodyEl.createDiv({ cls: 'mailer-yougile-task-meta', text: detailLines.join(' · ') });
      }

      evEl.addEventListener('click', () => {
        if (this.filterMode === 'all') {
          this.openTaskInTasksView(ev.taskId);
        } else {
          this.renderEventDetail(ev);
        }
      });
    }
  }

  private renderEventDetail(ev: CalendarEvent): void {
    const container = this.containerElContent;
    container.empty();

    this.createViewActive = false;
    this.dayViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => {
      if (this.selectedDate) {
        const events = this.getCalendarEvents().filter(e => e.date === this.selectedDate);
        this.renderDayView(this.selectedDate, events);
      } else {
        this.renderCalendar();
      }
    });

    container.createEl('h3', { text: ev.title });

    const infoLines = [
      `📅 Дата: ${ev.date}`,
      `🕐 Время: ${ev.startTime || '—'} - ${ev.endTime || '—'}`,
      `📍 Место: ${ev.place || '—'}`,
      `👥 Целевая аудитория: ${ev.targetAudience || '—'}`,
      `👤 Ответственный: ${ev.responsibleName || '—'}`,
      `✅ Статус: ${ev.completed ? 'Завершено' : 'Активно'}`,
    ];

    const metaEl = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    for (const line of infoLines) {
      metaEl.createDiv({ text: line });
    }

    if (ev.additionalInfo) {
      const infoDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-section-divider' });
      infoDiv.createDiv({ text: 'Дополнительная информация:' });
      infoDiv.createDiv({ text: ev.additionalInfo });
    }

    if (ev.reportHtml) {
      const reportDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-section-divider' });
      reportDiv.innerHTML = ev.reportHtml;
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const editBtn = btnRow.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addEventListener('click', () => this.renderEventEditForm(ev));

    if (ev.completed) {
      const reopenBtn = btnRow.createEl('button', { text: '🔄 Возобновить', cls: 'mailer-yougile-refresh-btn' });
      reopenBtn.addEventListener('click', async () => {
        try {
          await this.plugin.client.updateTask(ev.taskId, { completed: false });
          new Notice('Мероприятие возобновлено');
          void this.syncAndRender();
        } catch (e: unknown) {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    } else {
      const completeBtn = btnRow.createEl('button', { text: 'Завершить', cls: 'mailer-yougile-refresh-btn' });
      completeBtn.addEventListener('click', () => this.renderReportForm(ev));
    }
  }

  private showCreateFormWithDate(dateStr: string): void {
    this.showCreateForm(dateStr);
  }

  showCreateForm(prefillDate?: string): void {
    this.createViewActive = true;
    this.dayViewActive = false;
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => {
      if (this.selectedDate) {
        const events = this.getCalendarEvents().filter(e => e.date === this.selectedDate);
        this.renderDayView(this.selectedDate, events);
      } else {
        this.renderCalendar();
      }
    });

    container.createEl('h3', { text: 'Новое мероприятие' });

    const columnsInfo = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    const pTitle = this.plugin.db.getProjects().find(p => p.id === this.plugin.settings.calendarProjectId)?.title || '—';
    const bTitle = this.plugin.db.getBoards().find(b => b.id === this.plugin.settings.calendarBoardId)?.title || '—';
    columnsInfo.setText(`Проект: ${pTitle} · Доска: ${bTitle}`);

    const columnLabel = container.createEl('label', { text: 'Направление мероприятия' });
    const columnSelect = container.createEl('select');
    columnSelect.addClass('mailer-mb-8');
    const boardId = this.plugin.settings.calendarBoardId;
    let boardColumns = this.plugin.db.getColumns();
    if (boardId) boardColumns = boardColumns.filter(c => c.boardId === boardId);
    boardColumns.sort((a, b) => a.title.localeCompare(b.title));
    for (const col of boardColumns) {
      columnSelect.createEl('option', { value: col.id, text: col.title });
    }

    const fields: Array<{ label: string; key: string; type: string; placeholder?: string }> = [
      { label: 'Название мероприятия', key: 'title', type: 'text', placeholder: 'Введите название' },
      { label: 'Место проведения', key: 'place', type: 'text', placeholder: 'Адрес или место' },
      { label: 'Целевая аудитория', key: 'targetAudience', type: 'text', placeholder: 'Кому предназначено' },
      { label: 'Дата проведения', key: 'date', type: 'date' },
      { label: 'Время начала', key: 'startTime', type: 'time' },
      { label: 'Время окончания', key: 'endTime', type: 'time' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};

    for (const f of fields) {
      const label = container.createEl('label', { text: f.label });
      const input = container.createEl('input', { attr: { type: f.type, placeholder: f.placeholder || '' } });
      inputs[f.key] = input;
      if (f.key === 'date' && prefillDate) {
        input.value = prefillDate;
      }
      if (f.key === 'date' && !prefillDate && !input.value) {
        input.value = new Date().toISOString().slice(0, 10);
      }
    }

    const assigneeSelector = new AssigneeSelector(container, 'Ответственный', () => this.plugin.db.getUsers());

    // Parent task selector
    const parentLabel = container.createEl('label', { text: 'Материнская задача (необязательно)' });
    const parentInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Начните вводить название задачи...' } });
    parentInput.addClass('mailer-mb-8');
    const parentDatalist = container.createEl('datalist');
    parentDatalist.id = 'schedule-parent-tasks';
    parentInput.setAttr('list', 'schedule-parent-tasks');
    const allParentTasks = this.plugin.db.getTasks()
      .sort((a, b) => a.title.localeCompare(b.title));
    const taskIdByTitle = new Map<string, string>();
    const taskDeadlineByTitle = new Map<string, number | undefined>();
    for (const t of allParentTasks) {
      parentDatalist.createEl('option', { value: t.title });
      taskIdByTitle.set(t.title, t.id);
      taskDeadlineByTitle.set(t.title, t.deadline);
    }

    const autoCompleteWrapper = container.createDiv({ cls: 'mailer-cb-flex' });
    const autoCompleteCb = autoCompleteWrapper.createEl('input', { attr: { type: 'checkbox' } });
    autoCompleteCb.style.width = '16px';
    autoCompleteCb.style.height = '16px';
    autoCompleteCb.style.margin = '0 4px 0 0';
    autoCompleteCb.style.flexShrink = '0';
    autoCompleteCb.style.cursor = 'pointer';
    const autoCompleteSpan = autoCompleteWrapper.createEl('span');
    autoCompleteSpan.setText('Завершить материнскую задачу при завершении мероприятия');

    const additionalLabel = container.createEl('label', { text: 'Дополнительная информация и описание' });
    const additionalTextarea = container.createEl('textarea', { cls: 'mailer-textarea' });
    additionalTextarea.placeholder = 'Любая дополнительная информация о мероприятии';

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const submitBtn = btnRow.createEl('button', { text: 'Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => {
      if (this.selectedDate) {
        const events = this.getCalendarEvents().filter(e => e.date === this.selectedDate);
        this.renderDayView(this.selectedDate, events);
      } else {
        this.renderCalendar();
      }
    });

    submitBtn.addEventListener('click', async () => {
      const title = inputs.title.value.trim();
      if (!title) { new Notice('Название мероприятия обязательно'); return; }
      const place = inputs.place.value.trim();
      const targetAudience = inputs.targetAudience.value.trim();
      const dateVal = inputs.date.value;
      const startTime = inputs.startTime.value;
      const endTime = inputs.endTime.value;
      const additionalInfo = additionalTextarea.value.trim();
      if (!dateVal) { new Notice('Дата проведения обязательна'); return; }

      const parentTaskTitle = parentInput.value.trim();
      const parentTaskId = parentTaskTitle ? taskIdByTitle.get(parentTaskTitle) : undefined;
      const parentAutoComplete = autoCompleteCb.checked;

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');

      const description = buildEventDescription(title, place, targetAudience, startTime, endTime, additionalInfo, parentTaskId, parentAutoComplete);

      const assignedIds = assigneeSelector.getSelectedIds();

      const deadlineMs = new Date(`${dateVal}T${endTime || '23:59'}`).getTime();

      const selectedColumnId = columnSelect.value;

      // Check if event date is within parent deadline
      if (parentTaskId && parentAutoComplete) {
        const parentDeadline = taskDeadlineByTitle.get(parentTaskTitle);
        if (parentDeadline && deadlineMs > parentDeadline) {
          new Notice(`⚠️ Внимание: дата мероприятия (${dateVal}) выходит за пределы дедлайна материнской задачи`);
        }
      }

      try {
        const payload: CreateTaskPayload = {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        const result = await this.plugin.client.createTask(payload);

        // If parent task selected, add new task as its subtask
        if (parentTaskId && result?.id) {
          try {
            const parentTask = await this.plugin.client.getTaskById(parentTaskId);
            const existingSubtasks = parentTask?.subtasks ?? [];
            await this.plugin.client.updateTask(parentTaskId, {
              subtasks: [...existingSubtasks, result.id],
            });
          } catch (e2: unknown) {
            new Notice('Мероприятие создано, но не удалось привязать к материнской задаче');
          }
        }

        new Notice('Мероприятие создано');
        void this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          const offlinePayload: Record<string, unknown> = {
            title,
            description,
            columnId: selectedColumnId || undefined,
            assigned: assignedIds.length > 0 ? assignedIds : undefined,
            deadline: { deadline: deadlineMs, withTime: true },
          };
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: offlinePayload,
          });
          if (parentTaskId) {
            this.plugin.db.addToOfflineQueue({
              type: 'update-task',
              payload: { id: parentTaskId, subtaskTitle: title },
            });
          }
          new Notice('Нет соединения. Мероприятие будет создано позже.');
          void this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          submitBtn.setText('Создать');
          submitBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private renderEventEditForm(ev: CalendarEvent): void {
    const container = this.containerElContent;
    container.empty();

    this.createViewActive = true;
    this.dayViewActive = false;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderEventDetail(ev));

    container.createEl('h3', { text: `Редактирование: ${ev.title}` });

    const fields: Array<{ label: string; key: string; type: string; placeholder?: string }> = [
      { label: 'Название мероприятия', key: 'title', type: 'text', placeholder: 'Введите название' },
      { label: 'Место проведения', key: 'place', type: 'text', placeholder: 'Адрес или место' },
      { label: 'Целевая аудитория', key: 'targetAudience', type: 'text', placeholder: 'Кому предназначено' },
      { label: 'Дата проведения', key: 'date', type: 'date' },
      { label: 'Время начала', key: 'startTime', type: 'time' },
      { label: 'Время окончания', key: 'endTime', type: 'time' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};
    const prefillValues: Record<string, string> = {
      title: ev.title,
      place: ev.place,
      targetAudience: ev.targetAudience,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
    };

    for (const f of fields) {
      const label = container.createEl('label', { text: f.label });
      const input = container.createEl('input', { attr: { type: f.type, placeholder: f.placeholder || '' } });
      input.value = prefillValues[f.key] || '';
      inputs[f.key] = input;
    }

    const assigneeSelector = new AssigneeSelector(container, 'Ответственный', () => this.plugin.db.getUsers(), ev.responsibleName);

    const columnLabel = container.createEl('label', { text: 'Направление мероприятия' });
    const columnSelect = container.createEl('select');
    columnSelect.addClass('mailer-mb-8');
    const boardId = this.plugin.settings.calendarBoardId;
    let boardColumns = this.plugin.db.getColumns();
    if (boardId) boardColumns = boardColumns.filter(c => c.boardId === boardId);
    boardColumns.sort((a, b) => a.title.localeCompare(b.title));
    for (const col of boardColumns) {
      const opt = columnSelect.createEl('option', { value: col.id, text: col.title });
      if (col.id === ev.columnId) opt.selected = true;
    }

    const additionalLabel = container.createEl('label', { text: 'Дополнительная информация и описание' });
    const additionalTextarea = container.createEl('textarea', { cls: 'mailer-textarea' });
    additionalTextarea.value = ev.additionalInfo;

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderEventDetail(ev));

    saveBtn.addEventListener('click', async () => {
      const title = inputs.title.value.trim();
      if (!title) { new Notice('Название мероприятия обязательно'); return; }
      const place = inputs.place.value.trim();
      const targetAudience = inputs.targetAudience.value.trim();
      const dateVal = inputs.date.value;
      const startTime = inputs.startTime.value;
      const endTime = inputs.endTime.value;
      const additionalInfo = additionalTextarea.value.trim();
      if (!dateVal) { new Notice('Дата проведения обязательна'); return; }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');

      const description = buildEventDescription(title, place, targetAudience, startTime, endTime, additionalInfo);

      const assignedIds = assigneeSelector.getSelectedIds();

      const deadlineMs = new Date(`${dateVal}T${endTime || '23:59'}`).getTime();
      const selectedColumnId = columnSelect.value;

      try {
        await this.plugin.client.updateTask(ev.taskId, {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        });
        new Notice('Мероприятие обновлено');
        void this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'update-task',
            payload: {
              id: ev.taskId,
              title,
              description,
              columnId: selectedColumnId || undefined,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
              deadline: { deadline: deadlineMs, withTime: true },
            },
          });
          new Notice('Нет соединения. Изменения будут сохранены позже.');
          void this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          saveBtn.setText('💾 Сохранить');
          saveBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private getJsonFromTask(taskId: string): string | null {
    const task = this.plugin.db.getTasks().find(t => t.id === taskId);
    if (!task || !task.description) return null;
    const reportIdx = task.description.indexOf('<!--REPORT-->');
    const jsonPart = reportIdx !== -1 ? task.description.substring(0, reportIdx).trim() : task.description.trim();
    if (!jsonPart.startsWith('{')) return null;
    try {
      JSON.parse(jsonPart);
      return jsonPart;
    } catch {
      return null;
    }
  }

  private renderReportForm(ev: CalendarEvent): void {
    const container = this.containerElContent;
    container.empty();

    this.createViewActive = true;
    this.dayViewActive = false;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderEventDetail(ev));

    container.createEl('h3', { text: `Отчёт по мероприятию: ${ev.title}` });

    const textLabel = container.createEl('label', { text: 'Опишите результаты' });
    const resultTextarea = container.createEl('textarea', { cls: 'mailer-report-textarea' });
    resultTextarea.placeholder = 'Опишите результаты мероприятия...';

    const fileLabel = container.createEl('label', { text: 'Прикрепить файлы (изображения, документы)' });
    fileLabel.addClass('mailer-mt-12');
    const fileInput = container.createEl('input', { attr: { type: 'file', multiple: 'true' } });
    fileInput.addClass('mailer-mt-4');

    const fileListDiv = container.createDiv();
    fileListDiv.addClass('mailer-mt-8');
    fileListDiv.addClass('mailer-yougile-task-meta');

    fileInput.addEventListener('change', () => {
      fileListDiv.empty();
      if (fileInput.files) {
        for (let i = 0; i < fileInput.files.length; i++) {
          fileListDiv.createDiv({ text: `📎 ${fileInput.files[i].name}` });
        }
      }
    });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const submitBtn = btnRow.createEl('button', { text: '✅ Завершить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderEventDetail(ev));

    submitBtn.addEventListener('click', async () => {
      const results = resultTextarea.value.trim();
      if (!results && (!fileInput.files || fileInput.files.length === 0)) {
        new Notice('Добавьте описание результатов или прикрепите файлы');
        return;
      }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const reportParts: string[] = [];
      reportParts.push('<hr>');
      reportParts.push('<h3>📋 Отчёт о мероприятии</h3>');

      if (results) {
        reportParts.push(`<p>${results.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`);
      }

      const files = fileInput.files;
      const uploadedUrls: Array<{ name: string; url: string }> = [];

      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          try {
            const buffer = await file.arrayBuffer();
            const result = await this.plugin.client.uploadFile(buffer, file.name);
            uploadedUrls.push({ name: file.name, url: result.fullUrl });
          } catch (e: unknown) {
            if (!isNetworkError(e)) {
              new Notice(`Ошибка загрузки ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        for (const u of uploadedUrls) {
          const ext = u.name.toLowerCase().split('.').pop() || '';
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
          if (isImage) {
            reportParts.push(`<p><a href="${u.url}"><img src="${u.url}" alt="${u.name}" style="max-width:100%;max-height:300px"></a></p>`);
          } else {
            reportParts.push(`<p><a href="${u.url}">📄 ${u.name}</a></p>`);
          }
        }
      }

      const reportHtml = reportParts.join('\n');

      const existingJson = this.getJsonFromTask(ev.taskId) || ev.descriptionRaw;

      try {
        await this.plugin.client.updateTask(ev.taskId, {
          description: `${existingJson}\n<!--REPORT-->${reportHtml}`,
          completed: true,
        });

        // Auto-complete parent task if configured
        if (ev.parentTaskId && ev.parentAutoComplete) {
          try {
            await this.plugin.client.updateTask(ev.parentTaskId, { completed: true });
          } catch {
            new Notice('⚠️ Не удалось завершить материнскую задачу');
          }
        }

        new Notice('Мероприятие завершено');
        void this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'update-task',
            payload: {
              id: ev.taskId,
              description: `${existingJson}\n<!--REPORT-->${reportHtml}`,
              completed: true,
            },
          });
          if (ev.parentTaskId && ev.parentAutoComplete) {
            this.plugin.db.addToOfflineQueue({
              type: 'update-task',
              payload: { id: ev.parentTaskId, completed: true },
            });
          }
          new Notice('Нет соединения. Отчёт будет сохранён позже.');
          void this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          submitBtn.setText('✅ Завершить');
          submitBtn.removeAttribute('disabled');
          cancelBtn.removeAttribute('disabled');
        }
      }
    });
  }

  async syncAndRender(): Promise<void> {
    if (!this.containerElContent) return;
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      this.containerElContent.empty();
      this.containerElContent.createDiv({ text: 'Настройте API ключ в настройках плагина', cls: 'mailer-yougile-empty' });
      return;
    }
    this.containerElContent.empty();
    const loadingEl = this.containerElContent.createDiv({ text: 'Синхронизация...', cls: 'mailer-yougile-loading' });
    try {
      await this.plugin.db.sync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouGile: Ошибка синхронизации — ${msg}`);
    }
    loadingEl.detach();
    try {
      const ids = this.filterMode === 'docs'
        ? this.plugin.settings.docsSelectedColumnIds
        : this.plugin.settings.calendarSelectedColumnIds;
      this.selectedColumnIds = new Set((ids || '').split(',').filter(Boolean));
      this.renderCalendar();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.containerElContent.empty();
      const errEl = this.containerElContent.createDiv({ cls: 'mailer-yougile-error' });
      errEl.setText(`Ошибка загрузки календаря: ${msg}. Подробнее в консоли (Ctrl+Shift+I).`);
      console.error('Calendar error:', e);
      errEl.createEl('button', { text: '🔄 Попробовать снова', cls: 'mailer-yougile-refresh-btn' })
        .addEventListener('click', () => this.syncAndRender());
    }
  }

  private openTaskInTasksView(taskId: string): void {
    this.plugin.activateView();
    window.setTimeout(() => {
      const leaf = this.plugin.app.workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
      const view = leaf?.view;
      if (view instanceof TasksView) {
        void view.openTaskDetail(taskId);
      }
    }, 300);
  }
}

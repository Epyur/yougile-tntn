import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CachedTask } from '../types/cache';
import { TASKS_VIEW_TYPE, TasksView } from './tasks-view';

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
}

function parseCalendarEvent(task: CachedTask): CalendarEvent | null {
  if (!task.deadline) return null;
  const dl = new Date(task.deadline);
  const dateStr = dl.toISOString().slice(0, 10);

  let place = '';
  let targetAudience = '';
  let startTime = '';
  let endTime = '';
  let descriptionRaw = task.description;

  if (task.description) {
    const desc = task.description.trim();
    if (desc.startsWith('{') || desc.startsWith('[')) {
      try {
        const parsed = JSON.parse(desc);
        if (parsed && typeof parsed === 'object') {
          place = parsed.place || '';
          targetAudience = parsed.targetAudience || '';
          startTime = parsed.startTime || '';
          endTime = parsed.endTime || '';
          descriptionRaw = JSON.stringify(parsed, null, 2);
        }
      } catch {
        const mdMatch = desc.match(/^---\n([\s\S]*?)\n---/);
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

function buildEventDescription(title: string, place: string, targetAudience: string, startTime: string, endTime: string): string {
  const data: Record<string, string> = {};
  data.title = title;
  data.place = place;
  data.targetAudience = targetAudience;
  data.startTime = startTime;
  data.endTime = endTime;
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
  private filterMode: 'all' | 'events' = 'events';

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
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');

    this.containerElContent = container.createDiv();
    this.renderCalendar();
  }

  private renderCalendar(): void {
    const container = this.containerElContent;
    container.empty();
    this.dayViewActive = false;
    this.createViewActive = false;

    const headerEl = container.createDiv({ cls: 'mailer-yougile-header' });
    headerEl.style.justifyContent = 'space-between';

    const navLeft = headerEl.createDiv({ cls: 'mailer-yougile-header' });
    const prevBtn = navLeft.createEl('button', { text: '◀', cls: 'mailer-yougile-refresh-btn' });
    const monthYearLabel = navLeft.createEl('span', { text: this.getMonthYearLabel() });
    monthYearLabel.style.fontWeight = 'bold';
    monthYearLabel.style.margin = '0 8px';
    const nextBtn = navLeft.createEl('button', { text: '▶', cls: 'mailer-yougile-refresh-btn' });

    const filterToggle = container.createEl('select');
    filterToggle.addClass('dropdown');
    filterToggle.style.marginBottom = '8px';
    filterToggle.style.width = 'auto';
    filterToggle.createEl('option', { value: 'all', text: 'Все задачи с дедлайном' });
    filterToggle.createEl('option', { value: 'events', text: 'Только мероприятия' });
    filterToggle.value = this.filterMode;
    filterToggle.addEventListener('change', () => {
      this.filterMode = filterToggle.value as 'all' | 'events';
      this.renderCalendar();
    });

    const navRight = headerEl.createDiv({ cls: 'mailer-yougile-header' });
    const createBtn = navRight.createEl('button', { text: '➕ Создать мероприятие', cls: 'mailer-yougile-refresh-btn' });
    const syncBtn = navRight.createEl('button', { text: 'Обновить', cls: 'mailer-yougile-refresh-btn' });

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

    createBtn.addEventListener('click', () => this.showCreateForm());

    syncBtn.addEventListener('click', () => this.syncAndRender());

    const syncStatus = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано' });

    const calendarGrid = container.createDiv({ cls: 'mailer-yougile-calendar-grid' });
    calendarGrid.style.display = 'grid';
    calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    calendarGrid.style.gap = '2px';

    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    for (const dn of dayNames) {
      const dayHeader = calendarGrid.createDiv({ cls: 'mailer-yougile-calendar-day-header', text: dn });
      dayHeader.style.textAlign = 'center';
      dayHeader.style.fontWeight = 'bold';
      dayHeader.style.padding = '4px';
      dayHeader.style.fontSize = 'var(--font-smaller)';
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
      cell.style.border = '1px solid var(--background-modifier-border)';
      cell.style.padding = '4px';
      cell.style.minHeight = '70px';
      cell.style.cursor = 'pointer';
      cell.style.fontSize = 'var(--font-smaller)';
      cell.style.overflow = 'hidden';

      if (dateStr === todayStr) {
        cell.style.backgroundColor = 'var(--interactive-accent)';
        cell.style.color = 'var(--text-on-accent)';
      }

      const dayNum = cell.createDiv({ text: String(day) });
      dayNum.style.fontWeight = 'bold';
      dayNum.style.marginBottom = '2px';

      const dayEvents = eventsByDate.get(dateStr) || [];
      for (const ev of dayEvents) {
        const evEl = cell.createDiv({ cls: 'mailer-yougile-calendar-event' });
        evEl.setText(ev.title);
        evEl.style.fontSize = '10px';
        evEl.style.padding = '1px 2px';
        evEl.style.marginBottom = '1px';
        evEl.style.borderRadius = '2px';
        evEl.style.whiteSpace = 'nowrap';
        evEl.style.overflow = 'hidden';
        evEl.style.textOverflow = 'ellipsis';
        evEl.style.backgroundColor = ev.completed ? 'var(--color-green)' : 'var(--interactive-accent)';
        evEl.style.color = 'var(--text-on-accent)';
      }

      cell.addEventListener('click', () => {
        this.selectedDate = dateStr;
        this.renderDayView(dateStr, dayEvents);
      });
    }
  }

  private getMonthYearLabel(): string {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${months[this.currentMonth]} ${this.currentYear}`;
  }

  private getCalendarEvents(): CalendarEvent[] {
    const tasks = this.plugin.db.getTasks();
    const projectId = this.plugin.settings.calendarProjectId;
    const boardId = this.plugin.settings.calendarBoardId;

    let filtered = tasks;
    if (this.filterMode === 'events') {
      if (projectId) filtered = filtered.filter(t => t.projectId === projectId);
      if (boardId) filtered = filtered.filter(t => t.boardId === boardId);
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

    const createForDayBtn = container.createEl('button', { text: '➕ Создать мероприятие', cls: 'mailer-yougile-refresh-btn' });
    createForDayBtn.style.marginBottom = '12px';
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

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    if (ev.completed) {
      const reopenBtn = btnRow.createEl('button', { text: '🔄 Возобновить', cls: 'mailer-yougile-refresh-btn' });
      reopenBtn.addEventListener('click', async () => {
        try {
          await this.plugin.client.updateTask(ev.taskId, { completed: false });
          new Notice('Мероприятие возобновлено');
          this.syncAndRender();
        } catch (e) {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    } else {
      const completeBtn = btnRow.createEl('button', { text: 'Завершить', cls: 'mailer-yougile-refresh-btn' });
      completeBtn.addEventListener('click', async () => {
        try {
          await this.plugin.client.updateTask(ev.taskId, { completed: true });
          new Notice('Мероприятие завершено');
          this.syncAndRender();
        } catch (e) {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
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

    const fields: Array<{ label: string; key: string; type: string; placeholder?: string }> = [
      { label: 'Название мероприятия', key: 'title', type: 'text', placeholder: 'Введите название' },
      { label: 'Место проведения', key: 'place', type: 'text', placeholder: 'Адрес или место' },
      { label: 'Целевая аудитория', key: 'targetAudience', type: 'text', placeholder: 'Кому предназначено' },
      { label: 'Ответственный (email)', key: 'responsible', type: 'text', placeholder: 'user@example.com' },
      { label: 'Дата проведения', key: 'date', type: 'date' },
      { label: 'Время начала', key: 'startTime', type: 'time' },
      { label: 'Время окончания', key: 'endTime', type: 'time' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};

    for (const f of fields) {
      const label = container.createEl('label', { text: f.label });
      const input = container.createEl('input', { attr: { type: f.type, placeholder: f.placeholder || '' } });
      input.style.width = '100%';
      input.style.boxSizing = 'border-box';
      inputs[f.key] = input;
      if (f.key === 'date' && prefillDate) {
        input.value = prefillDate;
      }
      if (f.key === 'date' && !prefillDate && !input.value) {
        input.value = new Date().toISOString().slice(0, 10);
      }
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

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
      const responsibleEmail = inputs.responsible.value.trim();
      const dateVal = inputs.date.value;
      const startTime = inputs.startTime.value;
      const endTime = inputs.endTime.value;
      if (!dateVal) { new Notice('Дата проведения обязательна'); return; }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');

      const description = buildEventDescription(title, place, targetAudience, startTime, endTime);

      let assignedIds: string[] = [];
      if (responsibleEmail) {
        const users = this.plugin.db.getUsers();
        const emailToId = new Map(users.map(u => [u.email || u.name || u.id, u.id]));
        const uid = emailToId.get(responsibleEmail);
        if (uid) assignedIds = [uid];
      }

      const deadlineMs = new Date(`${dateVal}T${endTime || '23:59'}`).getTime();

      try {
        const payload: Record<string, unknown> = {
          title,
          description,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        await this.plugin.client.createTask(payload as any);
        new Notice('Мероприятие создано');
        this.syncAndRender();
      } catch (e) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title,
              description,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
              deadline: { deadline: deadlineMs, withTime: true },
            },
          });
          new Notice('Нет соединения. Мероприятие будет создано позже.');
          this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          submitBtn.setText('Создать');
          submitBtn.removeAttribute('disabled');
        }
      }
    });
  }

  async syncAndRender(): Promise<void> {
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      this.containerElContent.empty();
      this.containerElContent.createDiv({ text: 'Настройте API ключ в настройках плагина', cls: 'mailer-yougile-empty' });
      return;
    }
    try {
      await this.plugin.db.sync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouGile: Ошибка синхронизации — ${msg}`);
    }
    this.renderCalendar();
  }

  private openTaskInTasksView(taskId: string): void {
    this.plugin.activateView();
    setTimeout(() => {
      const leaf = this.plugin.app.workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
      const view = leaf?.view;
      if (view instanceof TasksView) {
        view.detailTaskId = taskId;
        view.detailViewActive = true;
        view.renderTaskDetail(taskId);
      }
    }, 300);
  }
}

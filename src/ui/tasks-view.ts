import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CachedTask } from '../types/cache';
import type { YouGileTaskFull, CreateTaskPayload, YouGileChatMessage } from '../types/yougile';
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

export const TASKS_VIEW_TYPE = 'yougile-tasks-view';

export class TasksView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private selectProject!: HTMLSelectElement;
  private selectBoard!: HTMLSelectElement;
  private selectColumn!: HTMLSelectElement;
  private selectAssignee!: HTMLSelectElement;
  private selectStatus!: HTMLSelectElement;
  private tabButtons: HTMLElement[] = [];
  private currentTab: 'tasks' | 'chats' = 'tasks';

  private detailViewActive = false;
  private detailTaskId = '';
  private createViewActive = false;
  private searchInput!: HTMLInputElement;
  private filterMode: 'all' | 'events' = 'all';

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TASKS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'YouGile';
  }

  getIcon(): string {
    return 'list-todo';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');

    const headerEl2 = container.createDiv({ cls: 'mailer-yougile-header' });
    const tasksTab = headerEl2.createEl('button', { text: '📋 Задачи', cls: 'mailer-yougile-refresh-btn' });
    const chatsTab = headerEl2.createEl('button', { text: '💬 Чаты', cls: 'mailer-yougile-refresh-btn' });
    this.tabButtons = [tasksTab, chatsTab];
    tasksTab.addEventListener('click', () => this.switchTab('tasks'));
    chatsTab.addEventListener('click', () => this.switchTab('chats'));

    const filtersEl = container.createDiv({ cls: 'mailer-yougile-header' });
    this.selectProject = filtersEl.createEl('select');
    this.selectProject.addClass('dropdown');
    this.selectProject.addEventListener('change', () => {
      this.plugin.settings.selectedProjectId = this.selectProject.value;
      this.plugin.saveSettings();
      this.populateFilters();
      this.renderFromCache();
    });

    this.selectBoard = filtersEl.createEl('select');
    this.selectBoard.addClass('dropdown');
    this.selectBoard.addEventListener('change', () => {
      this.populateFilters();
      this.renderFromCache();
    });

    this.selectColumn = filtersEl.createEl('select');
    this.selectColumn.addClass('dropdown');
    this.selectColumn.addEventListener('change', () => this.renderFromCache());

    this.selectAssignee = filtersEl.createEl('select');
    this.selectAssignee.addClass('dropdown');
    this.selectAssignee.addEventListener('change', () => this.renderFromCache());

    this.selectStatus = filtersEl.createEl('select');
    this.selectStatus.addClass('dropdown');
    this.selectStatus.createEl('option', { value: 'active', text: 'Только активные' });
    this.selectStatus.createEl('option', { value: 'all', text: 'Все' });
    this.selectStatus.createEl('option', { value: 'completed', text: 'Только завершённые' });
    this.selectStatus.value = 'active';
    this.selectStatus.addEventListener('change', () => this.renderFromCache());

    const filterToggle = filtersEl.createEl('select');
    filterToggle.addClass('dropdown');
    filterToggle.createEl('option', { value: 'all', text: 'Все задачи' });
    filterToggle.createEl('option', { value: 'events', text: 'Мероприятия' });
    filterToggle.addEventListener('change', () => {
      this.filterMode = filterToggle.value as 'all' | 'events';
      this.renderFromCache();
    });

    const headerEl = container.createDiv({ cls: 'mailer-yougile-header' });
    const createBtn = headerEl.createEl('button', { text: '➕ Новая задача', cls: 'mailer-yougile-refresh-btn' });
    createBtn.addEventListener('click', () => this.showCreateForm());

    this.searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по задачам...' } });
    this.searchInput.addClass('mailer-input');
    this.searchInput.addClass('mailer-mb-8');
    this.searchInput.addEventListener('input', () => this.renderFromCache());

    const refreshBtn = headerEl.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());

    this.containerElContent = container.createDiv();

    this.populateFilters();
    this.renderFromCache();

    this.registerInterval(window.setInterval(() => this.syncAndRender(), 5 * 60 * 1000));
  }

  private switchTab(tab: 'tasks' | 'chats'): void {
    this.currentTab = tab;
    this.tabButtons.forEach((btn, i) => {
      btn.style.fontWeight = i === (tab === 'tasks' ? 0 : 1) ? 'bold' : 'normal';
    });
    this.detailViewActive = false;
    this.createViewActive = false;
    if (tab === 'tasks') {
      this.renderFromCache();
    } else {
      this.renderChats();
    }
  }

  private populateFilters(): void {
    const savedProject = this.selectProject.value;
    const savedBoard = this.selectBoard.value;
    const savedColumn = this.selectColumn.value;
    const savedAssignee = this.selectAssignee.value;
    const savedStatus = this.selectStatus.value;

    const projects = this.plugin.db.getProjects();
    const selP = this.selectProject;
    selP.empty();
    selP.createEl('option', { value: '', text: 'Все проекты' });
    for (const p of projects) {
      selP.createEl('option', { value: p.id, text: p.title });
    }
    selP.value = savedProject || this.plugin.settings.selectedProjectId;

    const selectedProjectId = this.selectProject.value;
    const boards = this.plugin.db.getBoards().filter(b => !selectedProjectId || b.projectId === selectedProjectId);
    const selB = this.selectBoard;
    selB.empty();
    selB.createEl('option', { value: '', text: 'Все доски' });
    for (const b of boards) {
      selB.createEl('option', { value: b.id, text: b.title });
    }
    selB.value = savedBoard;

    const selectedBoardId = this.selectBoard.value;
    let columns = this.plugin.db.getColumns();
    if (selectedBoardId) {
      columns = columns.filter(c => c.boardId === selectedBoardId);
    }
    const uniqueCols = new Map<string, string[]>();
    for (const c of columns) {
      const ids = uniqueCols.get(c.title) || [];
      ids.push(c.id);
      uniqueCols.set(c.title, ids);
    }
    const sortedCols = [...uniqueCols.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const selC = this.selectColumn;
    selC.empty();
    selC.createEl('option', { value: '', text: 'Все колонки' });
    for (const [title] of sortedCols) {
      selC.createEl('option', { value: uniqueCols.get(title)!.join(','), text: title });
    }
    selC.value = savedColumn;

    const assignees = this.plugin.db.getUniqueAssignees();
    const selA = this.selectAssignee;
    selA.empty();
    selA.createEl('option', { value: '', text: 'Все исполнители' });
    for (const a of assignees) {
      selA.createEl('option', { value: a, text: a });
    }
    selA.value = savedAssignee;

    this.selectStatus.value = savedStatus;
  }

  private async syncAndRender(): Promise<void> {
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      this.containerElContent.empty();
      this.containerElContent.createDiv({ text: 'Настройте API ключ в настройках плагина', cls: 'mailer-yougile-empty' });
      return;
    }
    this.containerElContent.empty();
    this.containerElContent.createDiv({ text: 'Синхронизация...', cls: 'mailer-yougile-loading' });
    try {
      await this.flushOfflineQueue();
      await this.plugin.db.sync();
      this.populateFilters();
      if (this.currentTab === 'tasks') {
        if (this.detailViewActive) {
          this.renderTaskDetail(this.detailTaskId);
        } else if (this.createViewActive) {
          this.renderCreateForm();
        } else {
          this.renderFromCache();
        }
      } else {
        this.renderChats();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouGile: Ошибка синхронизации — ${msg}`);
      if (this.currentTab === 'tasks') {
        if (this.detailViewActive) {
          this.renderTaskDetail(this.detailTaskId);
        } else {
          this.renderFromCache();
        }
      }
    }
  }

  private async flushOfflineQueue(): Promise<void> {
    const queue = this.plugin.db.getOfflineQueue();
    for (const action of queue) {
      if (action.synced) continue;
      if (action.type === 'upload-file') {
        this.plugin.db.markOfflineSynced(action.id);
        continue;
      }
      try {
        switch (action.type) {
          case 'create-task': {
            const created = await this.plugin.client.createTask(action.payload as unknown as CreateTaskPayload);
            if (action.payload.completed) {
              await this.plugin.client.updateTask(created.id, { completed: true });
            }
            break;
          }
          case 'add-info':
          case 'toggle-completed':
            await this.plugin.client.updateTask(action.payload.taskId as string, action.payload);
            break;
          case 'send-message':
            await this.plugin.client.sendMessage(action.payload.chatId as string, action.payload.text as string);
            break;
        }
        this.plugin.db.removeOfflineAction(action.id);
        new Notice(`YouGile: Офлайн-действие "${action.type}" синхронизировано`);
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          break;
        }
        this.plugin.db.removeOfflineAction(action.id);
        new Notice(`YouGile: Ошибка офлайн-действия "${action.type}" — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private getDeadlineIndicator(task: CachedTask): { color: string; symbol: string } {
    if (!task.deadline) return { color: '', symbol: '' };
    const now = Date.now();
    const diff = task.deadline - now;
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    if (diff < 0 && !task.completed) {
      return { color: '#e74c3c', symbol: '🔴' };
    } else if (diff < twoWeeks && !task.completed) {
      return { color: '#f39c12', symbol: '🟠' };
    } else if (!task.completed) {
      return { color: '#2ecc71', symbol: '🟢' };
    }
    return { color: '', symbol: '' };
  }

  private getSyncStatusText(): string {
    return this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано';
  }

  // --- Вкладка Задачи ---

  private renderFromCache(): void {
    const container = this.containerElContent;
    container.empty();

    let tasks = this.plugin.db.getTasks();

    const projectId = this.selectProject.value;
    const boardId = this.selectBoard.value;
    const columnId = this.selectColumn.value;
    const assigneeId = this.selectAssignee.value;
    const statusFilter = this.selectStatus.value;

    if (projectId) tasks = tasks.filter(t => t.projectId === projectId);
    if (boardId) tasks = tasks.filter(t => t.boardId === boardId);
    if (columnId) {
      const colIds = columnId.split(',');
      tasks = tasks.filter(t => colIds.includes(t.columnId));
    }
    if (assigneeId) tasks = tasks.filter(t => t.assigned.indexOf(assigneeId) !== -1);
    if (statusFilter === 'active') tasks = tasks.filter(t => !t.completed);
    if (statusFilter === 'completed') tasks = tasks.filter(t => t.completed);

    if (this.filterMode === 'events') {
      const eventProjectId = this.plugin.settings.calendarProjectId;
      const eventBoardId = this.plugin.settings.calendarBoardId;
      if (eventProjectId) tasks = tasks.filter(t => t.projectId === eventProjectId);
      if (eventBoardId) tasks = tasks.filter(t => t.boardId === eventBoardId);
      tasks = tasks.filter(t => !!t.deadline);
    }

    const query = this.searchInput?.value?.toLowerCase().trim() || '';
    if (query) {
      tasks = tasks.filter(t =>
        t.title.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.projectTitle.toLowerCase().includes(query) ||
        t.columnTitle.toLowerCase().includes(query) ||
        t.assigned.some(a => a.toLowerCase().includes(query))
      );
    }

    tasks.sort((a, b) => b.timestamp - a.timestamp);

    if (tasks.length === 0) {
      container.createDiv({ text: 'Нет задач', cls: 'mailer-yougile-empty' });
      return;
    }

    const syncEl = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.getSyncStatusText() });

    const lastSync = this.plugin.db.getLastSyncAt();
    if (lastSync > 0) {
      container.createDiv({ text: `Синхр: ${new Date(lastSync).toLocaleTimeString()} · Задач: ${tasks.length}`, cls: 'mailer-yougile-task-meta' });
    }

    const renderedIds = new Set<string>();
    const renderTask = (task: CachedTask, depth: number): void => {
      if (renderedIds.has(task.id)) return;
      renderedIds.add(task.id);

      const taskEl = container.createDiv({ cls: 'mailer-yougile-task-item' });
      if (depth > 0) taskEl.style.paddingLeft = `${12 + depth * 20}px`;

      const indi = this.getDeadlineIndicator(task);
      if (indi.color) {
        const indiEl = taskEl.createSpan({ text: indi.symbol });
      }

      const bodyEl = taskEl.createDiv({ cls: 'mailer-yougile-task-body' });

      const titleEl = bodyEl.createDiv({ cls: `mailer-yougile-task-title${task.completed ? ' completed' : ''}` });
      titleEl.setText(task.title || 'Без названия');

      const metaParts: string[] = [];
      if (task.projectTitle) metaParts.push(task.projectTitle);
      if (task.columnTitle) metaParts.push(task.columnTitle);
      if (Array.isArray(task.assigned) && task.assigned.length > 0) metaParts.push(`👤 ${task.assigned.join(', ')}`);
      if (metaParts.length > 0) bodyEl.createDiv({ cls: 'mailer-yougile-task-meta', text: metaParts.join(' → ') });

      if (task.deadline) {
        const dl = new Date(task.deadline);
        bodyEl.createDiv({ cls: 'mailer-yougile-task-meta', text: `📅 ${dl.toLocaleDateString()}` });
      }

      taskEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        this.detailTaskId = task.id;
        this.detailViewActive = true;
        this.renderTaskDetail(task.id);
      });
    };

    const allTasks = this.plugin.db.getTasks();
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const renderTree = (ids: string[], depth: number): void => {
      for (const id of ids) {
        const t = taskMap.get(id);
        if (!t) continue;
        renderTask(t, depth);
        if (t.subtasks && t.subtasks.length > 0) renderTree(t.subtasks.map(s => s.id), depth + 1);
      }
    };
    renderTree(tasks.map(t => t.id), 0);
  }

  private async renderTaskDetail(taskId: string): Promise<void> {
    const container = this.containerElContent;
    container.empty();
    this.detailViewActive = true;
    this.detailTaskId = taskId;

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => {
      this.detailViewActive = false;
      this.renderFromCache();
    });

    container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.getSyncStatusText() });

    container.createDiv({ text: 'Загрузка...', cls: 'mailer-yougile-loading' });

    try {
      const [task, subscribers, messages] = await Promise.all([
        this.plugin.client.getTaskById(taskId) as Promise<YouGileTaskFull>,
        this.plugin.client.getTaskChatSubscribers(taskId).catch(() => []),
        this.plugin.client.getMessages(taskId).catch(() => []),
      ]);
      container.empty();

      const backBtn2 = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
      backBtn2.addEventListener('click', () => {
        this.detailViewActive = false;
        this.renderFromCache();
      });

      container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.getSyncStatusText() });

      this.renderTaskDetailContent(container, task, subscribers, messages);
    } catch (e: unknown) {
      container.empty();
      const msg = e instanceof Error ? e.message : String(e);
      container.createDiv({ text: `Ошибка: ${msg}`, cls: 'mailer-yougile-error' });
      new Notice(`YouGile: ${msg}`);
    }
  }

  private renderTaskDetailContent(container: HTMLElement, task: YouGileTaskFull, subscribers: string[], messages: YouGileChatMessage[]): void {
    const titleRow = container.createDiv({ cls: 'mailer-yougile-header' });
    titleRow.createEl('h3', { text: task.title || 'Без названия' });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    if (task.idTaskProject) meta.createEl('div', { text: `ID: ${task.idTaskProject}` });
    if (task.idTaskCommon) meta.createEl('div', { text: `Общий ID: ${task.idTaskCommon}` });
    if (task.type) meta.createEl('div', { text: `Тип: ${task.type}` });

    if (task.description) {
      container.createEl('h4', { text: 'Описание' });
      container.createDiv({ text: stripHtml(task.description) });
    }

    if (task.assigned && task.assigned.length > 0) {
      container.createEl('h4', { text: 'Исполнители' });
      container.createDiv({ text: task.assigned.map(id => this.plugin.db.getUserName(id)).join(', ') });
    }

    if (task.createdBy) {
      container.createEl('h4', { text: 'Создатель' });
      container.createDiv({ text: this.plugin.db.getUserName(task.createdBy) });
    }

    if (subscribers.length > 0) {
      container.createEl('h4', { text: 'Подписчики чата' });
      container.createDiv({ text: subscribers.map(id => this.plugin.db.getUserName(id)).join(', ') });
    }

    if (task.columnId) {
      container.createEl('h4', { text: 'Колонка' });
      const cached = this.plugin.db.getTask(task.id);
      container.createDiv({ text: cached?.columnTitle || task.columnId });
    }

    container.createEl('h4', { text: 'Статус' });
    const statusParts: string[] = [];
    if (task.completed) statusParts.push('✅ Выполнена');
    else statusParts.push('❌ Не выполнена');
    if (task.archived) statusParts.push('📦 В архиве');
    container.createDiv({ text: statusParts.join(' · ') });

    if (task.deadline) {
      container.createEl('h4', { text: 'Дедлайн' });
      const dl = task.deadline;
      const parts: string[] = [];
      if (dl.deadline) parts.push(`до ${new Date(dl.deadline).toLocaleString()}`);
      if (dl.startDate) parts.push(`с ${new Date(dl.startDate).toLocaleString()}`);
      if (parts.length) container.createDiv({ text: parts.join(' ') });
    }

    if (task.timeTracking) {
      container.createEl('h4', { text: 'Учёт времени' });
      const tt = task.timeTracking;
      container.createDiv({ text: `План: ${tt.plan ?? 0}ч · Факт: ${tt.work ?? 0}ч` });
    }

    if (task.checklists && task.checklists.length > 0) {
      container.createEl('h4', { text: 'Чек-листы' });
      for (const cl of task.checklists) {
        const clEl = container.createDiv();
        clEl.createEl('strong', { text: cl.title });
        for (const item of cl.items) {
          clEl.createDiv({ text: `${item.isCompleted ? '✅' : '⬜'} ${item.title}` });
        }
      }
    }

    if (task.stickers && Object.keys(task.stickers).length > 0) {
      container.createEl('h4', { text: 'Стикеры' });
      const keys = Object.keys(task.stickers);
      for (let i = 0; i < keys.length; i++) {
        const stickerId = keys[i];
        const state = task.stickers[stickerId];
        container.createDiv({ text: `${stickerId}: ${state}` });
      }
    }

    if (task.subtasks && task.subtasks.length > 0) {
      container.createEl('h4', { text: 'Подзадачи' });
      const ul = container.createEl('ul', { cls: 'mailer-yougile-subtask-list' });
      ul.style.margin = '4px 0';
      ul.style.paddingLeft = '20px';
      for (const sub of task.subtasks) {
        const subId = typeof sub === 'string' ? sub : sub.id;
        const subTitle = typeof sub === 'string' ? (this.plugin.db.getTask(subId)?.title || subId) : (sub.title || subId);
        const li = ul.createEl('li');
        li.style.listStyle = 'disc';
        li.style.marginBottom = '2px';
        const linkEl = li.createEl('a', {
          text: subTitle,
          href: '#',
          cls: 'mailer-yougile-task-link',
        });
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          this.detailTaskId = subId;
          this.renderTaskDetail(subId);
        });
      }
    }

    if (task.color && task.color !== 'task-primary') {
      container.createDiv({ text: `🎨 Цвет: ${task.color}` });
    }

    if (task.timer?.running || task.stopwatch?.running) {
      container.createEl('h4', { text: 'Таймеры' });
      if (task.timer?.running) container.createDiv({ text: '⏱ Таймер запущен' });
      if (task.stopwatch?.running) container.createDiv({ text: '⏱ Секундомер запущен' });
    }

    // --- Add info section: always visible, above buttons ---
    container.createEl('h4', { text: 'Дополнить описание' });
    const addInfoRow = container.createDiv({ cls: 'mailer-yougile-fullwidth' });
    const infoInput = addInfoRow.createEl('textarea', {
      attr: { placeholder: 'Введите текст дополнения...', rows: '3' },
    });
    infoInput.addClass('mailer-textarea');
    const addInfoSubmitBtn = addInfoRow.createEl('button', { text: 'Добавить информацию', cls: 'mailer-yougile-refresh-btn' });
    addInfoSubmitBtn.addEventListener('click', async () => {
      const text = infoInput.value.trim();
      if (!text) return;
      addInfoSubmitBtn.setText('⏳');
      addInfoSubmitBtn.setAttr('disabled', 'true');
      try {
        await this.plugin.client.updateTask(this.detailTaskId, {
          description: task.description
            ? `${task.description}<br><p>${text} (${this.plugin.settings.login} ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})</p>`
            : `<p>${text} (${this.plugin.settings.login} ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()})</p>`,
        });
        new Notice('YouGile: Информация добавлена');
        this.renderTaskDetail(this.detailTaskId);
      } catch (e: unknown) {
        console.error('YouGile add-info error:', e);
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'add-info',
            payload: { taskId: this.detailTaskId, text, description: task.description ?? '' },
          });
          new Notice('YouGile: Нет соединения. Изменение сохранено локально.');
          this.renderTaskDetail(this.detailTaskId);
        } else {
          new Notice(`YouGile: Ошибка — ${e instanceof Error ? e.message : String(e)}`);
          addInfoSubmitBtn.setText('Добавить информацию');
          addInfoSubmitBtn.removeAttribute('disabled');
        }
      }
    });

    // --- Button row ---
    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });

    const setCompleted = async (completed: boolean): Promise<void> => {
      try {
        await this.plugin.client.updateTask(this.detailTaskId, { completed });
        new Notice(completed ? 'YouGile: Задача завершена' : 'YouGile: Задача возобновлена');
        this.renderTaskDetail(this.detailTaskId);
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'toggle-completed',
            payload: { taskId: this.detailTaskId, completed },
          });
          new Notice('YouGile: Нет соединения. Изменение сохранено локально.');
          this.renderTaskDetail(this.detailTaskId);
        } else {
          new Notice(`YouGile: Ошибка — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };

    if (task.completed) {
      const reopenBtn = btnRow.createEl('button', {
        text: '🔄 Возобновить',
        cls: 'mailer-yougile-refresh-btn',
      });
      reopenBtn.addEventListener('click', () => setCompleted(false));
    } else {
      const completeBtn = btnRow.createEl('button', {
        text: 'Завершить',
        cls: 'mailer-yougile-refresh-btn',
      });
      completeBtn.addEventListener('click', () => setCompleted(true));
    }

    const editBtn = btnRow.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addEventListener('click', () => this.renderEditForm(task));

    const fileBtn = btnRow.createEl('button', { text: '📎 Прикрепить файл', cls: 'mailer-yougile-refresh-btn' });
    const fileInput = container.createEl('input', { attr: { type: 'file', hidden: 'true' } });
    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      fileBtn.setText('⏳ Загрузка...');
      fileBtn.setAttr('disabled', 'true');
      try {
        const buffer = await file.arrayBuffer();
        const result = await this.plugin.client.uploadFile(buffer, file.name);
        const now = new Date();
        const user = this.plugin.settings.login;
        const updatedDesc = task.description
          ? `${task.description}<br><p><a href="${result.fullUrl}">Файл от ${user}</a> (${user} ${now.toLocaleDateString()} ${now.toLocaleTimeString()})</p>`
          : `<p><a href="${result.fullUrl}">Файл от ${user}</a> (${user} ${now.toLocaleDateString()} ${now.toLocaleTimeString()})</p>`;
        await this.plugin.client.updateTask(this.detailTaskId, { description: updatedDesc });
        new Notice('YouGile: Файл прикреплён');
        this.renderTaskDetail(this.detailTaskId);
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'upload-file',
            payload: { taskId: this.detailTaskId, fileName: file.name, fileSize: file.size },
          });
          new Notice('YouGile: Нет соединения. Файл будет загружен позже.');
          fileBtn.setText('📎 Прикрепить файл');
          fileBtn.removeAttribute('disabled');
          this.renderTaskDetail(this.detailTaskId);
        } else {
          new Notice(`YouGile: Ошибка — ${e instanceof Error ? e.message : String(e)}`);
          fileBtn.setText('📎 Прикрепить файл');
          fileBtn.removeAttribute('disabled');
        }
      }
    });

    // --- Чат задачи ---
    container.createEl('hr');
    container.createEl('h4', { text: '💬 Чат задачи' });

    const msgContainer = container.createDiv();
    msgContainer.style.maxHeight = '400px';
    msgContainer.style.overflowY = 'auto';
    msgContainer.style.marginBottom = '8px';

    if (messages.length === 0) {
      msgContainer.createDiv({ text: 'Нет сообщений', cls: 'mailer-yougile-empty' });
    } else {
      for (const msg of messages) {
        const msgEl = msgContainer.createDiv({ cls: 'mailer-yougile-task-item' });
        msgEl.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.getUserName(msg.fromUserId) });
        const textDiv = msgEl.createDiv({ cls: 'mailer-yougile-task-title' });
        textDiv.innerHTML = msg.text;
        if (msg.label) msgEl.createDiv({ cls: 'mailer-yougile-task-meta', text: `🏷 ${msg.label}` });
      }
    }

    const inputRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
    inputRow.style.gap = '4px';
    inputRow.style.alignItems = 'start';
    const inputEl = inputRow.createEl('textarea', { attr: { placeholder: 'Сообщение...', rows: '2' } });
    inputEl.style.flex = '1';
    inputEl.addClass('mailer-textarea');

    let pendingAttachment = '';

    const attachBtn = inputRow.createEl('button', { text: '📎', cls: 'mailer-yougile-refresh-btn' });
    attachBtn.style.fontSize = '18px';
    attachBtn.style.lineHeight = '1';
    attachBtn.style.padding = '4px 8px';
    const chatFileInput = container.createEl('input', { attr: { type: 'file', hidden: 'true' } });
    attachBtn.addEventListener('click', () => chatFileInput.click());
    chatFileInput.addEventListener('change', async () => {
      const file = chatFileInput.files?.[0];
      if (!file) return;
      attachBtn.setText('⏳');
      attachBtn.setAttr('disabled', 'true');
      try {
        const buffer = await file.arrayBuffer();
        const result = await this.plugin.client.uploadFile(buffer, file.name);
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name);
        if (isImage) {
          pendingAttachment = `<br><img src="${result.fullUrl}" alt="${file.name}" style="max-width:100%">`;
        } else {
          pendingAttachment = `<br><a href="${result.fullUrl}">${file.name}</a>`;
        }
        new Notice('YouGile: Файл загружен');
      } catch (e: unknown) {
        new Notice(`YouGile: Ошибка загрузки — ${e instanceof Error ? e.message : String(e)}`);
      }
      attachBtn.setText('📎');
      attachBtn.removeAttribute('disabled');
    });

    const sendBtn = inputRow.createEl('button', { text: 'Отправить', cls: 'mailer-yougile-refresh-btn' });
    sendBtn.addEventListener('click', async () => {
      let text = inputEl.value.trim();
      if (!text && !pendingAttachment) return;
      if (pendingAttachment) {
        text = text + pendingAttachment;
        pendingAttachment = '';
      }
      sendBtn.setText('⏳');
      sendBtn.setAttr('disabled', 'true');
      try {
        await this.plugin.client.sendMessage(task.id, text);
        inputEl.value = '';
        this.renderTaskDetail(this.detailTaskId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`YouGile: Ошибка — ${msg}`);
        sendBtn.setText('Отправить');
        sendBtn.removeAttribute('disabled');
      }
    });
  }

  // --- Вкладка Создание задачи ---

  showCreateForm(): void {
    this.createViewActive = true;
    this.detailViewActive = false;
    this.renderCreateForm();
  }

  private renderCreateForm(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => {
      this.createViewActive = false;
      this.renderFromCache();
    });

    container.createEl('h3', { text: 'Новая задача YouGile' });

    const nameLabel = container.createEl('label', { text: 'Название задачи' });
    const nameInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Введите название' } });
    nameInput.addClass('mailer-input');

    const descLabel = container.createEl('label', { text: 'Описание' });
    const descInput = container.createEl('textarea', { attr: { placeholder: 'Описание задачи (опционально)', rows: '3' } });
    descInput.addClass('mailer-textarea');

    const projects = this.plugin.db.getProjects();
    const projectLabel = container.createEl('label', { text: 'Проект' });
    const projectSelect = container.createEl('select');
    projectSelect.addClass('mailer-select');
    projectSelect.createEl('option', { value: '', text: '— выберите проект —' });
    for (const p of projects) {
      projectSelect.createEl('option', { value: p.id, text: p.title });
    }

    let selectedBoardId = '';
    let selectedColumnId = '';

    const boardLabel = container.createEl('label', { text: 'Доска' });
    const boardSelect = container.createEl('select');
    boardSelect.addClass('mailer-select');
    boardSelect.createEl('option', { value: '', text: '— выберите доску —' });

    const columnLabel = container.createEl('label', { text: 'Колонка' });
    const columnSelect = container.createEl('select');
    columnSelect.addClass('mailer-select');
    columnSelect.createEl('option', { value: '', text: '— выберите колонку —' });

    projectSelect.addEventListener('change', () => {
      const pid = projectSelect.value;
      selectedBoardId = '';
      selectedColumnId = '';
      boardSelect.empty();
      boardSelect.createEl('option', { value: '', text: '— выберите доску —' });
      columnSelect.empty();
      columnSelect.createEl('option', { value: '', text: '— выберите колонку —' });
      if (!pid) return;
      const boards = this.plugin.db.getBoards().filter(b => b.projectId === pid);
      for (const b of boards) {
        boardSelect.createEl('option', { value: b.id, text: b.title });
      }
    });

    boardSelect.addEventListener('change', () => {
      const bid = boardSelect.value;
      selectedBoardId = bid;
      selectedColumnId = '';
      columnSelect.empty();
      columnSelect.createEl('option', { value: '', text: '— выберите колонку —' });
      if (!bid) return;
      const columns = this.plugin.db.getColumns().filter(c => c.boardId === bid);
      for (const c of columns) {
        columnSelect.createEl('option', { value: c.id, text: c.title });
      }
    });

    columnSelect.addEventListener('change', () => {
      selectedColumnId = columnSelect.value;
    });

    const assigneeSelector = new AssigneeSelector(container, 'Исполнители', () => this.plugin.db.getUsers());

    const deadlineLabel = container.createEl('label', { text: 'Дедлайн (дата, опционально)' });
    const deadlineInput = container.createEl('input', { attr: { type: 'date' } });
    deadlineInput.addClass('mailer-input');

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });

    const submitBtn = btnRow.createEl('button', { text: 'Создать', cls: 'mailer-yougile-refresh-btn' });
    submitBtn.addEventListener('click', async () => {
      const title = nameInput.value.trim();
      if (!title) {
        new Notice('YouGile: Название задачи обязательно');
        return;
      }
      const deadlineVal = deadlineInput.value;
      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      try {
        const assigned = assigneeSelector.getSelectedIds();
        const payload: CreateTaskPayload = {
          title,
          description: descInput.value.trim() || undefined,
          columnId: selectedColumnId || undefined,
          assigned: assigned.length > 0 ? assigned : undefined,
        };
        if (deadlineVal) {
          payload.deadline = { deadline: new Date(deadlineVal).getTime(), withTime: false };
        }
        await this.plugin.client.createTask(payload);
        new Notice('Задача создана');
        this.createViewActive = false;
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title,
              description: descInput.value.trim() || undefined,
              columnId: selectedColumnId || undefined,
              deadline: deadlineVal ? { deadline: new Date(deadlineVal).getTime(), withTime: false } : undefined,
            },
          });
          new Notice('YouGile: Нет соединения. Задача будет создана позже.');
          this.createViewActive = false;
          this.renderFromCache();
        } else {
          new Notice(`YouGile: Ошибка — ${e instanceof Error ? e.message : String(e)}`);
          submitBtn.setText('Создать');
          submitBtn.removeAttribute('disabled');
        }
      }
    });

    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => {
      this.createViewActive = false;
      this.renderFromCache();
    });
  }

  // --- Вкладка Редактирование задачи ---

  private renderEditForm(task: YouGileTaskFull): void {
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к деталям', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderTaskDetail(task.id));

    container.createEl('h3', { text: `Редактирование: ${task.title}` });

    const nameInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Название задачи' } });
    nameInput.addClass('mailer-input');
    nameInput.value = task.title || '';

    const descInput = container.createEl('textarea', { attr: { placeholder: 'Описание', rows: '3' } });
    descInput.addClass('mailer-textarea');
    descInput.value = stripHtml(task.description || '');

    const projects = this.plugin.db.getProjects();
    const projectSelect = container.createEl('select');
    projectSelect.addClass('mailer-select');

    const col = this.plugin.db.getColumns().find(c => c.id === task.columnId);
    const board = col ? this.plugin.db.getBoards().find(b => b.id === col.boardId) : undefined;
    const currentProject = board ? projects.find(p => p.id === board.projectId) : undefined;

    projectSelect.createEl('option', { value: '', text: '— выберите проект —' });
    for (const p of projects) {
      projectSelect.createEl('option', { value: p.id, text: p.title });
    }
    if (currentProject) projectSelect.value = currentProject.id;

    const boardSelect = container.createEl('select');
    boardSelect.addClass('mailer-select');

    const columnSelect = container.createEl('select');
    columnSelect.addClass('mailer-select');

    let selectedBoardId = board?.id || '';
    let selectedColumnId = task.columnId || '';

    const populateBoards = () => {
      boardSelect.empty();
      boardSelect.createEl('option', { value: '', text: '— выберите доску —' });
      const pid = projectSelect.value;
      const boards = pid ? this.plugin.db.getBoards().filter(b => b.projectId === pid) : [];
      for (const b of boards) {
        boardSelect.createEl('option', { value: b.id, text: b.title });
      }
      boardSelect.value = selectedBoardId;
    };

    const populateColumns = () => {
      columnSelect.empty();
      columnSelect.createEl('option', { value: '', text: '— выберите колонку —' });
      const bid = boardSelect.value;
      const columns = bid ? this.plugin.db.getColumns().filter(c => c.boardId === bid) : [];
      for (const c of columns) {
        columnSelect.createEl('option', { value: c.id, text: c.title });
      }
      columnSelect.value = selectedColumnId;
    };

    populateBoards();
    populateColumns();

    projectSelect.addEventListener('change', () => {
      selectedBoardId = '';
      selectedColumnId = '';
      populateBoards();
      populateColumns();
    });

    boardSelect.addEventListener('change', () => {
      selectedBoardId = boardSelect.value;
      selectedColumnId = '';
      populateColumns();
    });

    columnSelect.addEventListener('change', () => {
      selectedColumnId = columnSelect.value;
    });

    const assigneeSelector = new AssigneeSelector(container, 'Исполнители', () => this.plugin.db.getUsers());
    if (task.assigned && task.assigned.length > 0) {
      assigneeSelector.setSelectedIds(task.assigned);
    }

    const deadlineInput = container.createEl('input', { attr: { type: 'date' } });
    deadlineInput.addClass('mailer-input');
    if (task.deadline?.deadline) {
      deadlineInput.value = new Date(task.deadline.deadline).toISOString().split('T')[0];
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });

    const submitBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    submitBtn.addEventListener('click', async () => {
      const title = nameInput.value.trim();
      if (!title) {
        new Notice('YouGile: Название задачи обязательно');
        return;
      }
      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      try {
        const assigned = assigneeSelector.getSelectedIds();
        const payload: Record<string, unknown> = { title };
        const desc = descInput.value.trim();
        if (desc) payload.description = desc;
        if (selectedColumnId) payload.columnId = selectedColumnId;
        if (assigned.length > 0) payload.assigned = assigned;
        const deadlineVal = deadlineInput.value;
        if (deadlineVal) {
          payload.deadline = { deadline: new Date(deadlineVal).getTime(), withTime: false };
        } else {
          payload.deadline = null;
        }
        await this.plugin.client.updateTask(task.id, payload);
        new Notice('YouGile: Задача обновлена');
        this.renderTaskDetail(task.id);
      } catch (e: unknown) {
        new Notice(`YouGile: Ошибка — ${e instanceof Error ? e.message : String(e)}`);
        submitBtn.setText('💾 Сохранить');
        submitBtn.removeAttribute('disabled');
      }
    });

    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderTaskDetail(task.id));
  }

  // --- Вкладка Чаты ---

  private currentChatId = '';
  private currentChatTitle = '';

  private async renderChats(): Promise<void> {
    const container = this.containerElContent;
    container.empty();

    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      container.createDiv({ text: 'Настройте API ключ', cls: 'mailer-yougile-empty' });
      return;
    }

    if (this.currentChatId) {
      this.renderMessages(container);
      return;
    }

    container.createDiv({ text: 'Загрузка...', cls: 'mailer-yougile-loading' });

    try {
      const taskIdRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
      taskIdRow.style.gap = '8px';
      taskIdRow.style.marginBottom = '8px';
      const taskIdInput = taskIdRow.createEl('input', { attr: { type: 'text', placeholder: 'Введите ID задачи для загрузки чата...' } });
      taskIdInput.style.flex = '1';
      const loadBtn = taskIdRow.createEl('button', { text: 'Загрузить', cls: 'mailer-yougile-refresh-btn' });
      loadBtn.addEventListener('click', () => {
        const id = taskIdInput.value.trim();
        if (id) {
          this.currentChatId = id;
          this.currentChatTitle = id;
          this.renderChats();
        }
      });

      const chats = await this.plugin.client.getGroupChats();
      container.empty();
      if (chats.length === 0) {
        container.createDiv({ text: 'Нет чатов', cls: 'mailer-yougile-empty' });
        return;
      }
      for (const chat of chats) {
        const chatEl = container.createDiv({ cls: 'mailer-yougile-task-item' });
        chatEl.createDiv({ text: chat.title, cls: 'mailer-yougile-task-title' });
        chatEl.addEventListener('click', () => {
          this.currentChatId = chat.id;
          this.currentChatTitle = chat.title;
          this.renderChats();
        });
      }
    } catch (e: unknown) {
      container.empty();
      const msg = e instanceof Error ? e.message : String(e);
      container.createDiv({ text: `Ошибка: ${msg}`, cls: 'mailer-yougile-error' });
    }
  }

  private async renderMessages(container: HTMLElement): Promise<void> {
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к чатам', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => {
      this.currentChatId = '';
      this.currentChatTitle = '';
      this.renderChats();
    });

    container.createEl('h6', { text: this.currentChatTitle });

    const msgContainer = container.createDiv();
    msgContainer.createDiv({ text: 'Загрузка...', cls: 'mailer-yougile-loading' });

    try {
      const messages = await this.plugin.client.getMessages(this.currentChatId);
      msgContainer.empty();
      for (const msg of messages) {
        const msgEl = msgContainer.createDiv({ cls: 'mailer-yougile-task-item' });
        msgEl.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.getUserName(msg.fromUserId) });
        msgEl.createDiv({ cls: 'mailer-yougile-task-title', text: msg.text });
        if (msg.label) msgEl.createDiv({ cls: 'mailer-yougile-task-meta', text: `🏷 ${msg.label}` });
      }
    } catch (e: unknown) {
      msgContainer.empty();
      const msg = e instanceof Error ? e.message : String(e);
      msgContainer.createDiv({ text: `Ошибка: ${msg}`, cls: 'mailer-yougile-error' });
    }

    const inputRow = container.createDiv();
    inputRow.addClass('mailer-fullwidth');
    const inputEl = inputRow.createEl('textarea', { attr: { placeholder: 'Сообщение...', rows: '2' } });
    inputEl.addClass('mailer-textarea');
    const sendBtn = inputRow.createEl('button', { text: 'Отправить' });
    sendBtn.addEventListener('click', async () => {
      const text = inputEl.value.trim();
      if (!text) return;
      sendBtn.setText('⏳');
      try {
        await this.plugin.client.sendMessage(this.currentChatId, text);
        inputEl.value = '';
        this.renderMessages(container);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        new Notice(`YouGile: Ошибка — ${msg}`);
        sendBtn.setText('Отправить');
      }
    });
  }
}

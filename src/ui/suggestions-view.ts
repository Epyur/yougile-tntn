import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CreateTaskPayload } from '../types/yougile';
import { AssigneeSelector } from './assignee-selector';

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && e.message === 'Failed to fetch') return true;
  if (e instanceof Error && /network|fetch|offline|econnrefused|enotfound|dns|timeout/i.test(e.message)) return true;
  return false;
}

export const SUGGESTIONS_VIEW_TYPE = 'yougile-suggestions-view';

const SUGGESTION_PROJECT_TITLE = 'Развитие плагина';
const SUGGESTION_BOARD_TITLE = 'Предложения';
const SUGGESTION_COLUMN_TITLES = ['Предложения', 'Ошибки'];

interface SuggestionItem {
  taskId: string;
  title: string;
  columnId: string;
  columnTitle: string;
  description: string;
  problem: string;
  expectedEffect: string;
  priority: string;
  assigneeName: string;
  completed: boolean;
  taskRaw: string;
}

function parseSuggestion(task: { id: string; title: string; description: string; columnId: string; completed: boolean; assigned: string[] }): SuggestionItem | null {
  if (!task.description) return null;
  const desc = task.description.trim();
  if (!desc.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(desc);
    if (parsed && typeof parsed === 'object' && parsed.type === 'suggestion') {
      return {
        taskId: task.id,
        title: parsed.title || task.title,
        columnId: task.columnId,
        columnTitle: '',
        description: parsed.description || '',
        problem: parsed.problem || '',
        expectedEffect: parsed.expectedEffect || '',
        priority: parsed.priority || '',
        assigneeName: task.assigned.length > 0 ? task.assigned[0] : '',
        completed: task.completed,
        taskRaw: task.description,
      };
    }
  } catch {
    // not a valid suggestion JSON
  }
  return null;
}

export class SuggestionsView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private createViewActive = false;
  private editViewActive = false;
  private editingItem: SuggestionItem | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return SUGGESTIONS_VIEW_TYPE; }
  getDisplayText(): string { return 'Предложения'; }
  getIcon(): string { return 'lightbulb'; }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');
    this.containerElContent = container.createDiv();
    this.renderView();
  }

  onClose(): void {
    // no-op
  }

  private getBoardId(): string {
    const boards = this.plugin.db.getBoards();
    const board = boards.find(b => b.title === SUGGESTION_BOARD_TITLE);
    return board?.id || '';
  }

  private getColumnIds(): string[] {
    const boardId = this.getBoardId();
    if (!boardId) return [];
    const columns = this.plugin.db.getColumns().filter(c => c.boardId === boardId && SUGGESTION_COLUMN_TITLES.includes(c.title));
    return columns.map(c => c.id);
  }

  private getColumnTitle(columnId: string): string {
    const col = this.plugin.db.getColumns().find(c => c.id === columnId);
    return col?.title || columnId;
  }

  private getSuggestions(): SuggestionItem[] {
    const boardId = this.getBoardId();
    if (!boardId) return [];
    const tasks = this.plugin.db.getTasks().filter(t => t.boardId === boardId);
    const items: SuggestionItem[] = [];
    for (const t of tasks) {
      const parsed = parseSuggestion(t);
      if (parsed) {
        parsed.columnTitle = this.getColumnTitle(parsed.columnId);
        items.push(parsed);
      }
    }
    return items;
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;
    this.editViewActive = false;
    this.editingItem = null;

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '💡 Предложения по развитию плагина' });
    const refreshBtn = header.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());
    const createBtn = header.createEl('button', { text: '➕ Новое предложение', cls: 'mailer-yougile-refresh-btn' });
    createBtn.addEventListener('click', () => this.showCreateForm());

    const items = this.getSuggestions();
    if (items.length === 0) {
      container.createDiv({ text: 'Нет предложений', cls: 'mailer-yougile-empty' });
      return;
    }

    const table = container.createEl('table');
    table.addClass('mailer-table');

    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    const headers = ['Колонка', 'Суть предложения', 'Проблема', 'Ожидаемый эффект', 'Приоритет', 'Автор', 'Статус'];
    for (const h of headers) {
      const th = headRow.createEl('th');
      th.setText(h);
      th.addClass('mailer-th-sm');
    }

    const tbody = table.createEl('tbody');
    for (const item of items) {
      const row = tbody.createEl('tr');
      row.addClass('mailer-clickable');
      row.addEventListener('click', () => this.showDetailView(item));
      const cells = [
        item.columnTitle,
        item.title,
        item.problem,
        item.expectedEffect,
        item.priority,
        item.assigneeName,
        item.completed ? '✅ Завершено' : '🔄 В работе',
      ];
      for (const c of cells) {
        const td = row.createEl('td');
        td.setText(c);
        td.addClass('mailer-td-sm');
      }
    }
  }

  private showCreateForm(): void {
    this.createViewActive = true;
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: 'Новое предложение' });

    const columnIds = this.getColumnIds();
    const colLabel = container.createEl('label', { text: 'Колонка' });
    const colSelect = container.createEl('select');
    colSelect.addClass('mailer-select');
    for (const cid of columnIds) {
      const title = this.getColumnTitle(cid);
      colSelect.createEl('option', { value: cid, text: title });
    }

    const fieldDefs: Array<{ label: string; key: string; multiline: boolean }> = [
      { label: 'Суть предложения (ошибка)', key: 'title', multiline: false },
      { label: 'Проблема (Зачем?)', key: 'problem', multiline: true },
      { label: 'Ожидаемый эффект', key: 'expectedEffect', multiline: true },
    ];

    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
    for (const f of fieldDefs) {
      const label = container.createEl('label', { text: f.label });
      if (f.multiline) {
        const ta = container.createEl('textarea');
        ta.addClass('mailer-textarea');
        inputs[f.key] = ta;
      } else {
        const inp = container.createEl('input', { attr: { type: 'text' } });
        inp.addClass('mailer-input');
        inputs[f.key] = inp;
      }
    }

    const priorityLabel = container.createEl('label', { text: 'Приоритет' });
    const prioritySelect = container.createEl('select');
    prioritySelect.addClass('mailer-select');
    const priorityOptions = ['Критичный', 'Высокий', 'Средний', 'Просто идея'];
    for (const opt of priorityOptions) {
      const optEl = prioritySelect.createEl('option', { value: opt, text: opt });
      if (opt === 'Средний') optEl.selected = true;
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.addClass('mailer-mt-12');
    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    submitBtn.addEventListener('click', async () => {
      const title = (inputs.title as HTMLInputElement).value.trim();
      if (!title) { new Notice('Введите суть предложения'); return; }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const loginUser = this.plugin.db.getUsers().find(u => u.email === this.plugin.settings.login || u.name === this.plugin.settings.login);
      const assignedIds = loginUser ? [loginUser.id] : [];
      const description = JSON.stringify({
        type: 'suggestion',
        title,
        problem: (inputs.problem as HTMLTextAreaElement).value.trim(),
        expectedEffect: (inputs.expectedEffect as HTMLTextAreaElement).value.trim(),
        priority: prioritySelect.value,
      }, null, 2);

      try {
        const payload: CreateTaskPayload = {
          title,
          description,
          columnId: colSelect.value || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
        };
        await this.plugin.client.createTask(payload);
        new Notice('Предложение создано');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title,
              description,
              columnId: colSelect.value || undefined,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
            },
          });
          new Notice('Нет соединения. Предложение будет создано позже.');
          this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          submitBtn.setText('✅ Создать');
          submitBtn.removeAttribute('disabled');
          cancelBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private showDetailView(item: SuggestionItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;
    this.editViewActive = false;
    this.editingItem = item;

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `💡 ${item.title}` });

    const detailContainer = container.createDiv();
    detailContainer.addClass('mailer-detail-text');

    const fields: Array<{ label: string; value: string }> = [
      { label: 'Колонка', value: item.columnTitle },
      { label: 'Суть предложения', value: item.title },
      { label: 'Проблема (Зачем?)', value: item.problem },
      { label: 'Ожидаемый эффект', value: item.expectedEffect },
      { label: 'Приоритет', value: item.priority },
      { label: 'Автор', value: item.assigneeName },
      { label: 'Статус', value: item.completed ? '✅ Завершено' : '🔄 В работе' },
    ];
    for (const f of fields) {
      if (!f.value) continue;
      const row = detailContainer.createDiv();
      row.addClass('mailer-detail-row');
      row.createEl('strong', { text: `${f.label}: ` });
      row.createSpan({ text: f.value });
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.addClass('mailer-mt-12');

    const editBtn = btnRow.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addEventListener('click', () => this.showEditForm(item));

    const completeBtn = btnRow.createEl('button', {
      text: item.completed ? '🔄 Открыть заново' : '✅ Завершить',
      cls: 'mailer-yougile-refresh-btn',
    });
    completeBtn.addClass('mailer-btn-ml-8');
    completeBtn.addEventListener('click', async () => {
      completeBtn.setText('⏳');
      completeBtn.setAttr('disabled', 'true');
      editBtn.setAttr('disabled', 'true');
      try {
        await this.plugin.client.updateTaskRaw(item.taskId, {
          completed: !item.completed,
        });
        new Notice(item.completed ? 'Предложение открыто заново' : 'Предложение завершено');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'toggle-completed',
            payload: { id: item.taskId, completed: !item.completed },
          });
          new Notice('Нет соединения. Изменения будут сохранены позже.');
          this.syncAndRender();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          completeBtn.setText(item.completed ? '🔄 Открыть заново' : '✅ Завершить');
          completeBtn.removeAttribute('disabled');
          editBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private showEditForm(item: SuggestionItem): void {
    this.editViewActive = true;
    this.editingItem = item;
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `✏️ ${item.title}` });

    const columnIds = this.getColumnIds();
    const colLabel = container.createEl('label', { text: 'Колонка' });
    const colSelect = container.createEl('select');
    colSelect.addClass('mailer-select');
    for (const cid of columnIds) {
      const title = this.getColumnTitle(cid);
      const opt = colSelect.createEl('option', { value: cid, text: title });
      if (cid === item.columnId) opt.selected = true;
    }

    const fieldDefs: Array<{ label: string; key: string; multiline: boolean }> = [
      { label: 'Суть предложения (ошибка)', key: 'title', multiline: false },
      { label: 'Проблема (Зачем?)', key: 'problem', multiline: true },
      { label: 'Ожидаемый эффект', key: 'expectedEffect', multiline: true },
    ];

    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
    const prefill: Record<string, string> = {
      title: item.title,
      problem: item.problem,
      expectedEffect: item.expectedEffect,
    };

    for (const f of fieldDefs) {
      const label = container.createEl('label', { text: f.label });
      let el: HTMLInputElement | HTMLTextAreaElement;
      if (f.multiline) {
        const ta = container.createEl('textarea');
        ta.addClass('mailer-textarea');
        el = ta;
      } else {
        const inp = container.createEl('input', { attr: { type: 'text' } });
        inp.addClass('mailer-input');
        el = inp;
      }
      el.value = prefill[f.key] || '';
      inputs[f.key] = el;
    }

    const priorityLabel = container.createEl('label', { text: 'Приоритет' });
    const prioritySelect = container.createEl('select');
    prioritySelect.addClass('mailer-select');
    const priorityOptions = ['Критичный', 'Высокий', 'Средний', 'Просто идея'];
    for (const opt of priorityOptions) {
      const optEl = prioritySelect.createEl('option', { value: opt, text: opt });
      if (opt === (item.priority || 'Средний')) optEl.selected = true;
    }

    const assigneeSelector = new AssigneeSelector(container, 'Автор', () => this.plugin.db.getUsers(), item.assigneeName);

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.addClass('mailer-mt-12');
    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    saveBtn.addEventListener('click', async () => {
      const title = (inputs.title as HTMLInputElement).value.trim();
      if (!title) { new Notice('Введите суть предложения'); return; }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const assignedIds = assigneeSelector.getSelectedIds();
      const description = JSON.stringify({
        type: 'suggestion',
        title,
        problem: (inputs.problem as HTMLTextAreaElement).value.trim(),
        expectedEffect: (inputs.expectedEffect as HTMLTextAreaElement).value.trim(),
        priority: prioritySelect.value,
      }, null, 2);

      try {
        const response = await this.plugin.client.updateTaskRaw(item.taskId, {
          title,
          description,
          columnId: colSelect.value || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
        });
        // Show server response to user (only author/admin can edit)
        const responseStr = typeof response === 'string' ? response : JSON.stringify(response);
        new Notice(`Ответ сервера: ${responseStr}`);
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'update-task',
            payload: {
              id: item.taskId,
              title,
              description,
              columnId: colSelect.value || undefined,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
            },
          });
          new Notice('Нет соединения. Изменения будут сохранены позже.');
          this.syncAndRender();
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          new Notice(`Ответ сервера: ${msg}`);
          saveBtn.setText('💾 Сохранить');
          saveBtn.removeAttribute('disabled');
          cancelBtn.removeAttribute('disabled');
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
    this.renderView();
  }
}

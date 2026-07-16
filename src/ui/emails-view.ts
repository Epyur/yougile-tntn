import { ItemView, Notice, WorkspaceLeaf, Modal } from 'obsidian';
import type YouGilePlugin from '../main';
import type { MailItem } from '../types/emails';
import { DocumentService } from '../services/document-service';

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && e.message === 'Failed to fetch') return true;
  if (e instanceof Error && /network|fetch|offline|econnrefused|enotfound|dns|timeout/i.test(e.message)) return true;
  return false;
}

export const EMAILS_VIEW_TYPE = 'yougile-emails-view';

export class EmailsView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private selectedColumnIds: Set<string> = new Set();
  private createViewActive = false;
  private searchQuery = '';
  private searchTimeout: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return EMAILS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Письма';
  }

  getIcon(): string {
    return 'mail';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');
    this.containerElContent = container.createDiv();
    this.selectedColumnIds = new Set(this.plugin.settings.emailSelectedColumnIds.split(',').filter(Boolean));
    this.renderView();
  }

  private getBoardColumns(): Array<{ id: string; title: string }> {
    const boardId = this.plugin.settings.emailBoardId;
    if (!boardId) return [];
    return this.plugin.db.getColumns().filter(c => c.boardId === boardId);
  }

  private getDirectionMappings(): EmailDirectionMapping[] {
    try {
      return JSON.parse(this.plugin.settings.emailDirectionMappings || '[]');
    } catch {
      return [];
    }
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '📧 Письма' });
    const newBtn = header.createEl('button', { text: '➕ Новое письмо', cls: 'mailer-yougile-refresh-btn' });
    newBtn.addEventListener('click', () => this.showCreateForm());
    const refreshBtn = header.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());
    const chatBtn = header.createEl('button', { text: '🤖 Чат с AI', cls: 'mailer-yougile-refresh-btn' });
    chatBtn.addEventListener('click', () => {
      const modal = new ChatAIEmailModal(this.plugin);
      modal.open();
    });

    if (!this.plugin.settings.emailProjectId || !this.plugin.settings.emailBoardId) {
      container.createDiv({ text: 'Настройте проект и доску для писем в настройках плагина', cls: 'mailer-yougile-empty' });
      return;
    }

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по номеру, теме, тексту...' } });
    searchInput.style.width = '100%';
    searchInput.style.boxSizing = 'border-box';
    searchInput.style.marginBottom = '8px';
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.renderView();
      }, 300);
    });

    const columns = this.getBoardColumns();
    if (columns.length > 0) {
      const filterDiv = container.createDiv();
      filterDiv.style.marginBottom = '8px';
      filterDiv.createDiv({ text: 'Колонки:', cls: 'mailer-yougile-task-meta' });
      for (const col of columns) {
        const wrapper = filterDiv.createEl('label');
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
        cb.checked = this.selectedColumnIds.has(col.id);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            this.selectedColumnIds.add(col.id);
          } else {
            this.selectedColumnIds.delete(col.id);
          }
          this.plugin.settings.emailSelectedColumnIds = [...this.selectedColumnIds].join(',');
          this.plugin.saveSettings();
          this.renderView();
        });
        const dirName = this.getDirectionName(col.id);
        const span = wrapper.createEl('span');
        span.setText(' ' + dirName);
      }
    }

    const emails = this.plugin.emailDb.getAllEmails();
    const q = this.searchQuery.trim().toLowerCase();
    let filtered = emails;
    if (q) {
      filtered = emails.filter(e =>
        e.number.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.text.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q)
      );
    }
    if (this.selectedColumnIds.size > 0) {
      const selectedColIds = [...this.selectedColumnIds];
      filtered = filtered.filter(e => {
        const dir = this.plugin.emailDb.getDirectionName(e.direction_id);
        if (!dir) return false;
        return selectedColIds.some(colId => {
          const dirName = this.getDirectionName(colId);
          return dir === dirName;
        });
      });
    }

    filtered.sort((a, b) => b.id - a.id);

    if (filtered.length === 0) {
      container.createDiv({ text: 'Нет писем', cls: 'mailer-yougile-empty' });
      return;
    }

    const listDiv = container.createDiv();
    for (const email of filtered) {
      const item = listDiv.createDiv({ cls: 'mailer-yougile-task-item' });
      item.addEventListener('click', () => this.renderEmailDetail(email));

      const body = item.createDiv({ cls: 'mailer-yougile-task-body' });

      const titleDiv = body.createDiv({ cls: 'mailer-yougile-task-title' });
      titleDiv.setText(`${email.number} — ${email.subject}`);

      const metaDiv = body.createDiv({ cls: 'mailer-yougile-task-meta' });
      const dirName = this.plugin.emailDb.getDirectionName(email.direction_id);
      metaDiv.setText(`${email.author} | ${dirName} | ${new Date(email.date).toLocaleDateString()}`);

      if (email.text) {
        const preview = body.createDiv({ cls: 'mailer-yougile-task-meta' });
        preview.setText(email.text.slice(0, 100) + (email.text.length > 100 ? '...' : ''));
      }
    }
  }

  private getDirectionName(columnId: string): string {
    const mappings = this.getDirectionMappings();
    const mapping = mappings.find(m => m.columnId === columnId);
    return mapping ? mapping.directionName : (this.plugin.db.getColumns().find(c => c.id === columnId)?.title || columnId);
  }

  private renderEmailDetail(email: MailItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `${email.number} — ${email.subject}` });

    const metaDiv = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    metaDiv.style.marginBottom = '12px';
    const dirName = this.plugin.emailDb.getDirectionName(email.direction_id);
    metaDiv.createDiv({ text: `Автор: ${email.author}` });
    metaDiv.createDiv({ text: `Дата: ${new Date(email.date).toLocaleString()}` });
    metaDiv.createDiv({ text: `Направление: ${dirName}` });
    metaDiv.createDiv({ text: `Статус: ${email.sync_status === 'synced' ? '☁️ Синхронизировано' : '📝 Локально'}` });

    container.createEl('h4', { text: 'Содержимое письма' });
    const textDiv = container.createDiv();
    textDiv.style.whiteSpace = 'pre-wrap';
    textDiv.style.fontSize = 'var(--font-ui-small)';
    textDiv.setText(email.text);

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    const editBtn = btnRow.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addEventListener('click', () => this.showEditForm(email));

    if (email.images && email.images.length > 0) {
      const imgLabel = container.createEl('h4', { text: 'Изображения' });
      for (const imgPath of email.images) {
        try {
          const img = container.createEl('img', { attr: { src: imgPath } });
          img.style.maxWidth = '100%';
          img.style.maxHeight = '300px';
          img.style.marginTop = '8px';
        } catch {
          const link = container.createEl('a', { href: imgPath });
          link.setText(imgPath);
          container.createEl('br');
        }
      }
    }
  }

  private showEditForm(email: MailItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderEmailDetail(email));

    container.createEl('h3', { text: `✏️ Редактировать письмо ${email.number}` });

    const numberLabel = container.createEl('label', { text: 'Исходящий номер' });
    const numberInput = container.createEl('input', { attr: { type: 'text' } });
    numberInput.value = email.number;
    numberInput.style.width = '100%';
    numberInput.style.boxSizing = 'border-box';

    const subjectLabel = container.createEl('label', { text: 'Тема письма' });
    const subjectInput = container.createEl('input', { attr: { type: 'text' } });
    subjectInput.value = email.subject;
    subjectInput.style.width = '100%';
    subjectInput.style.boxSizing = 'border-box';

    const textLabel = container.createEl('label', { text: 'Содержимое письма' });
    const textInput = container.createEl('textarea');
    textInput.value = email.text;
    textInput.style.width = '100%';
    textInput.style.boxSizing = 'border-box';
    textInput.style.minHeight = '150px';

    const dirLabel = container.createEl('label', { text: 'Направление' });
    const dirSelect = container.createEl('select');
    dirSelect.style.width = '100%';
    dirSelect.style.boxSizing = 'border-box';
    dirSelect.style.marginBottom = '12px';

    const columns = this.getBoardColumns();
    const currentDirName = this.plugin.emailDb.getDirectionName(email.direction_id);
    for (const col of columns) {
      const name = this.getDirectionName(col.id);
      const opt = dirSelect.createEl('option', { value: col.id, text: name });
      if (name === currentDirName) opt.selected = true;
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить изменения', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderEmailDetail(email));

    saveBtn.addEventListener('click', async () => {
      const number = numberInput.value.trim();
      const subject = subjectInput.value.trim();
      const text = textInput.value.trim();
      const selectedColumnId = dirSelect.value;

      if (!number || !subject || !text || !selectedColumnId) {
        new Notice('Заполните все поля'); return;
      }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const now = new Date().toISOString();
      const dirName = this.getDirectionName(selectedColumnId);
      let directionId = email.direction_id;
      const existingDir = this.plugin.emailDb.getDirections().find(d => d.name === dirName);
      if (existingDir) {
        directionId = existingDir.id;
      } else {
        directionId = Date.now() + Math.floor(Math.random() * 100);
        this.plugin.emailDb.addDirection({
          id: directionId,
          name: dirName,
          description: '',
          created_at: now,
        });
      }

      const descriptionJSON = JSON.stringify({
        type: 'email',
        emailId: email.id,
        number,
        subject,
        text,
        author: email.author,
        date: email.date,
        direction_id: directionId,
        directionName: dirName,
      }, null, 2);

      try {
        if (email.taskId) {
          await this.plugin.client.updateTask(email.taskId, {
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
          });
        } else {
          const task = await this.plugin.client.createTask({
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
          });
          await this.plugin.client.updateTask(task.id, { completed: true });
          email.taskId = task.id;
        }
        email.number = number;
        email.subject = subject;
        email.text = text;
        email.direction_id = directionId;
        email.lastSyncTime = now;
        email.sync_status = 'synced';
        this.plugin.emailDb.addEmail(email);
        new Notice('Письмо сохранено');
        this.renderEmailDetail(email);
      } catch (e) {
        if (isNetworkError(e)) {
          email.number = number;
          email.subject = subject;
          email.text = text;
          email.direction_id = directionId;
          this.plugin.emailDb.addEmail(email);
          const payload: Record<string, unknown> = {
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
            completed: true,
            _emailId: email.id,
          };
          if (email.taskId) {
            this.plugin.db.addToOfflineQueue({
              type: 'update-task',
              payload: { id: email.taskId, ...payload },
            });
          } else {
            this.plugin.db.addToOfflineQueue({
              type: 'create-task',
              payload,
            });
          }
          new Notice('Нет соединения. Изменения сохранены локально.');
          this.renderEmailDetail(email);
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          saveBtn.setText('💾 Сохранить изменения');
          saveBtn.removeAttribute('disabled');
          cancelBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private showCreateForm(initialSubject = '', initialText = ''): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: '✉️ Новое письмо' });

    const numberLabel = container.createEl('label', { text: 'Исходящий номер' });
    const numberInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Например: 009' } });
    numberInput.style.width = '100%';
    numberInput.style.boxSizing = 'border-box';

    const subjectLabel = container.createEl('label', { text: 'Тема письма' });
    const subjectInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Тема' } });
    subjectInput.value = initialSubject;
    subjectInput.style.width = '100%';
    subjectInput.style.boxSizing = 'border-box';

    const textLabel = container.createEl('label', { text: 'Содержимое письма' });
    const textInput = container.createEl('textarea');
    textInput.value = initialText;
    textInput.style.width = '100%';
    textInput.style.boxSizing = 'border-box';
    textInput.style.minHeight = '100px';

    const dirLabel = container.createEl('label', { text: 'Направление' });
    const dirSelect = container.createEl('select');
    dirSelect.style.width = '100%';
    dirSelect.style.boxSizing = 'border-box';
    dirSelect.style.marginBottom = '12px';

    const columns = this.getBoardColumns();
    const mappings = this.getDirectionMappings();
    for (const col of columns) {
      const mapping = mappings.find(m => m.columnId === col.id);
      const name = mapping ? mapping.directionName : col.title;
      dirSelect.createEl('option', { value: col.id, text: name });
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    saveBtn.addEventListener('click', async () => {
      const number = numberInput.value.trim();
      const subject = subjectInput.value.trim();
      const text = textInput.value.trim();
      const selectedColumnId = dirSelect.value;

      if (!number || !subject || !text || !selectedColumnId) {
        new Notice('Заполните все поля'); return;
      }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const now = new Date();
      const emailId = Date.now() + Math.floor(Math.random() * 1000);
      const author = this.plugin.settings.login || 'Неизвестно';

      const mapping = mappings.find(m => m.columnId === selectedColumnId);
      const dirName = mapping ? mapping.directionName : (this.plugin.db.getColumns().find(c => c.id === selectedColumnId)?.title || selectedColumnId);
      let directionId = 0;
      const existingDir = this.plugin.emailDb.getDirections().find(d => d.name === dirName);
      if (existingDir) {
        directionId = existingDir.id;
      } else {
        directionId = Date.now() + Math.floor(Math.random() * 100);
        this.plugin.emailDb.addDirection({
          id: directionId,
          name: dirName,
          description: '',
          created_at: now.toISOString(),
        });
      }

      const emailItem: MailItem = {
        id: emailId,
        number,
        subject,
        text,
        author,
        date: now.toISOString(),
        direction_id: directionId,
        images: [],
        mdFilePath: '',
        mdFileHash: '',
        lastSyncTime: now.toISOString(),
        sync_status: 'local',
        created_at: now.toISOString(),
      };

      const descriptionJSON = JSON.stringify({
        type: 'email',
        emailId,
        number,
        subject,
        text,
        author,
        date: now.toISOString(),
        direction_id: directionId,
        directionName: dirName,
      }, null, 2);

      try {
        const task = await this.plugin.client.createTask({
          title: `[Письмо] ${number} — ${subject}`,
          description: descriptionJSON,
          columnId: selectedColumnId,
        });
        await this.plugin.client.updateTask(task.id, { completed: true });
        emailItem.taskId = task.id;
        emailItem.sync_status = 'synced';
        emailItem.lastSyncTime = new Date().toISOString();
        this.plugin.emailDb.addEmail(emailItem);
        new Notice('Письмо сохранено и отправлено на сервер');
        this.renderView();
      } catch (e) {
        if (isNetworkError(e)) {
          this.plugin.emailDb.addEmail(emailItem);
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title: `[Письмо] ${number} — ${subject}`,
              description: descriptionJSON,
              columnId: selectedColumnId,
              completed: true,
              _emailId: emailId,
            },
          });
          new Notice('Нет соединения. Письмо сохранено локально, будет отправлено позже.');
          this.renderView();
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
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
    await this.plugin.db.sync();
    this.plugin.emailDb.syncFromTasks(this.plugin.db.getTasks());
    await this.plugin.emailDb.init();
    this.renderView();
  }
}

class ChatAIEmailModal extends Modal {
  plugin: YouGilePlugin;
  messages: { role: 'user' | 'assistant'; content: string }[] = [];
  uploadedFiles: { name: string; content: string }[] = [];
  chatContainer!: HTMLElement;
  inputArea!: HTMLTextAreaElement;
  isProcessing = false;
  lastAnswer = '';
  lastQuestion = '';
  createBtn!: HTMLButtonElement;

  constructor(plugin: YouGilePlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mailer-yougile-container');

    const header = contentEl.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '🤖 Чат с AI помощником' });

    const infoBar = contentEl.createDiv({ cls: 'mailer-yougile-sync-indicator' });
    const allEmails = this.plugin.emailDb.getAllEmails();
    infoBar.setText(`📊 База знаний: ${allEmails.length} писем | Загруженных файлов: ${this.uploadedFiles.length}`);

    this.chatContainer = contentEl.createDiv();
    this.chatContainer.style.maxHeight = '400px';
    this.chatContainer.style.overflowY = 'auto';
    this.chatContainer.style.marginBottom = '8px';

    const welcome = this.chatContainer.createDiv({ cls: 'mailer-yougile-sync-indicator' });
    welcome.setText('👋 Здравствуйте! Задайте мне вопрос по базе писем или загрузите документ для анализа.');

    const fileArea = contentEl.createDiv();
    fileArea.style.marginBottom = '8px';

    const fileInput = fileArea.createEl('input', { attr: { type: 'file', multiple: 'true' } });
    fileInput.style.display = 'none';
    fileInput.accept = '.txt,.json,.md,.csv';

    const uploadBtn = fileArea.createEl('button', { text: '📎 Загрузить документ', cls: 'mailer-yougile-refresh-btn' });
    uploadBtn.addEventListener('click', () => fileInput.click());

    const fileList = fileArea.createDiv();
    fileList.style.fontSize = 'var(--font-smaller)';

    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      for (const file of Array.from(files)) {
        try {
          const content = await file.text();
          this.uploadedFiles.push({ name: file.name, content });
          const tag = fileList.createEl('span');
          tag.style.marginRight = '8px';
          tag.setText(`📄 ${file.name}`);
          infoBar.setText(`📊 База знаний: ${allEmails.length} писем | Загруженных файлов: ${this.uploadedFiles.length}`);
          new Notice(`✅ Загружен: ${file.name}`);
        } catch (error: unknown) {
          new Notice(`❌ Ошибка загрузки: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      fileInput.value = '';
    });

    this.inputArea = contentEl.createEl('textarea', { attr: { placeholder: 'Введите вопрос... (Enter для отправки, Shift+Enter для переноса)' } });
    this.inputArea.style.width = '100%';
    this.inputArea.style.boxSizing = 'border-box';
    this.inputArea.style.minHeight = '60px';
    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '8px';

    const sendBtn = btnRow.createEl('button', { text: '✉️ Отправить', cls: 'mailer-yougile-refresh-btn' });
    sendBtn.addEventListener('click', () => this.sendMessage());

    this.createBtn = btnRow.createEl('button', { text: '📝 Создать письмо', cls: 'mailer-yougile-refresh-btn' });
    this.createBtn.style.display = 'none';
    this.createBtn.addEventListener('click', () => {
      const allLeaves = this.plugin.app.workspace.getLeavesOfType(EMAILS_VIEW_TYPE);
      const view = allLeaves.first()?.view;
      if (view instanceof EmailsView && !view.createViewActive) {
        const shortQ = this.lastQuestion.length > 50 ? this.lastQuestion.substring(0, 50) + '...' : this.lastQuestion;
        const content = `**Вопрос пользователя:**\n${this.lastQuestion}\n\n**Ответ AI помощника:**\n\n${this.lastAnswer}`;
        this.close();
        view.showCreateForm(`Ответ AI: ${shortQ}`, content);
      } else {
        new Notice('Сначала откройте панель писем');
      }
    });

    const clearBtn = btnRow.createEl('button', { text: '🗑️ Очистить', cls: 'mailer-yougile-refresh-btn' });
    clearBtn.addEventListener('click', () => {
      this.messages = [];
      this.uploadedFiles = [];
      this.lastAnswer = '';
      this.lastQuestion = '';
      this.createBtn.style.display = 'none';
      this.chatContainer.empty();
      const w = this.chatContainer.createDiv({ cls: 'mailer-yougile-sync-indicator' });
      w.setText('👋 Здравствуйте! Задайте мне вопрос по базе писем или загрузите документ для анализа.');
      infoBar.setText(`📊 База знаний: ${allEmails.length} писем | Загруженных файлов: 0`);
    });
  }

  async sendMessage(): Promise<void> {
    const question = this.inputArea.value.trim();
    if (!question || this.isProcessing) return;

    this.addMessage('user', question);
    this.inputArea.value = '';
    this.isProcessing = true;

    try {
      let fileContext = '';
      if (this.uploadedFiles.length > 0) {
        fileContext = '\n\n## ЗАГРУЖЕННЫЕ ДОКУМЕНТЫ:\n';
        for (const f of this.uploadedFiles) {
          fileContext += `\n--- ${f.name} ---\n${f.content}\n`;
        }
      }

      let historyContext = '';
      if (this.messages.length > 0) {
        historyContext = '\n\n## ИСТОРИЯ ЧАТА:\n';
        for (const msg of this.messages.slice(-6)) {
          historyContext += `\n${msg.role === 'user' ? '👤 Пользователь' : '🤖 AI'}: ${msg.content.substring(0, 300)}...\n`;
        }
      }

      const answer = await this.plugin.llmService.ask(question, fileContext, historyContext);
      this.lastQuestion = question;
      this.lastAnswer = answer;
      this.createBtn.style.display = '';
      this.addMessage('assistant', answer);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`❌ Ошибка: ${msg}`);
      this.addMessage('assistant', `❌ Ошибка: ${msg}`);
    }

    this.isProcessing = false;
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
    const msgEl = this.chatContainer.createDiv();
    msgEl.style.padding = '6px 8px';
    msgEl.style.marginBottom = '4px';
    msgEl.style.borderRadius = '4px';
    msgEl.style.backgroundColor = role === 'user' ? 'var(--background-modifier-hover)' : 'var(--background-primary-alt)';
    msgEl.style.whiteSpace = 'pre-wrap';
    msgEl.style.fontSize = 'var(--font-smaller)';
    const label = msgEl.createDiv();
    label.style.fontWeight = 'bold';
    label.style.marginBottom = '2px';
    label.setText(role === 'user' ? '👤 Вы' : '🤖 AI');
    msgEl.createDiv().setText(content);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

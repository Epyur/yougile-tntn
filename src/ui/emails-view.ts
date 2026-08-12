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
  private filterDateFrom = '';
  private filterDateTo = '';
  private filterAuthor = '';

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
    await this.syncAndRender();
  }

  private getAssignedUserId(): string[] {
    const login = this.plugin.settings.login;
    if (!login) return [];
    const users = this.plugin.db.getUsers();
    const user = users.find(u => u.email === login || u.name === login);
    return user ? [user.id] : [];
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
    const exportBtn = header.createEl('button', { text: '📄 Экспорт HTML', cls: 'mailer-yougile-refresh-btn' });
    exportBtn.addEventListener('click', () => this.exportHtml());

    if (!this.plugin.settings.emailProjectId || !this.plugin.settings.emailBoardId) {
      container.createDiv({ text: 'Настройте проект и доску для писем в настройках плагина', cls: 'mailer-yougile-empty' });
      return;
    }

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по номеру, теме, тексту...' } });
    searchInput.addClass('mailer-mb-8');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.renderView();
      }, 3000);
    });

    const columns = this.getBoardColumns();
    if (columns.length > 0) {
      const filterDiv = container.createDiv({ cls: 'mailer-mb-8' });
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

    const filterRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap mailer-mb-8' });

    let dateFilterTimeout: number | null = null;

    filterRow.createSpan({ text: 'Дата:' });
    const dateFromInput = filterRow.createEl('input', { attr: { type: 'date' } });
    dateFromInput.style.width = '140px';
    dateFromInput.value = this.filterDateFrom;
    dateFromInput.addEventListener('input', () => {
      this.filterDateFrom = dateFromInput.value;
      if (dateFilterTimeout) clearTimeout(dateFilterTimeout);
      dateFilterTimeout = window.setTimeout(() => this.renderView(), 1000);
    });
    filterRow.createSpan({ text: '—' });
    const dateToInput = filterRow.createEl('input', { attr: { type: 'date' } });
    dateToInput.style.width = '140px';
    dateToInput.value = this.filterDateTo;
    dateToInput.addEventListener('input', () => {
      this.filterDateTo = dateToInput.value;
      if (dateFilterTimeout) clearTimeout(dateFilterTimeout);
      dateFilterTimeout = window.setTimeout(() => this.renderView(), 1000);
    });

    filterRow.createSpan({ text: 'Автор:' });
    const authorSelect = filterRow.createEl('select');
    authorSelect.style.width = '160px';
    const allAuthors = [...new Set(this.plugin.emailDb.getAllEmails().map(e => e.author).filter(Boolean))].sort();
    authorSelect.createEl('option', { value: '', text: '— все —' });
    for (const a of allAuthors) {
      authorSelect.createEl('option', { value: a, text: a });
    }
    authorSelect.value = this.filterAuthor;
    authorSelect.addEventListener('change', () => {
      this.filterAuthor = authorSelect.value;
      this.renderView();
    });

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
        const dir = e.direction_name || this.plugin.emailDb.getDirectionName(e.direction_id);
        if (!dir) return false;
        return selectedColIds.some(colId => {
          const dirName = this.getDirectionName(colId);
          return dir === dirName;
        });
      });
    }
    if (this.filterDateFrom) {
      const from = new Date(this.filterDateFrom);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter(e => new Date(e.date) >= from);
    }
    if (this.filterDateTo) {
      const to = new Date(this.filterDateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(e => new Date(e.date) <= to);
    }
    if (this.filterAuthor) {
      filtered = filtered.filter(e => e.author === this.filterAuthor);
    }

    filtered.sort((a, b) => b.id - a.id);

    const table = container.createEl('table', { cls: 'mailer-table' });

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    const headers = ['№ п/п', 'Номер письма', 'Дата письма', 'Тема письма', 'Автор'];
    for (const h of headers) {
      const th = headerRow.createEl('th', { cls: 'mailer-th' });
      th.setText(h);
    }

    const tbody = table.createEl('tbody');

    if (filtered.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td', { cls: 'mailer-text-center mailer-p-24' });
      td.setAttr('colspan', '5');
      td.setText('Нет писем');
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      const email = filtered[i];
      const row = tbody.createEl('tr', { cls: 'mailer-clickable mailer-row-hover' });
      row.addEventListener('click', () => this.renderEmailDetail(email));

      const numCell = row.createEl('td', { cls: 'mailer-td' });
      numCell.setText(String(i + 1));

      const numberCell = row.createEl('td', { cls: 'mailer-td' });
      numberCell.setText(email.number);

      const dateCell = row.createEl('td', { cls: 'mailer-td' });
      dateCell.style.whiteSpace = 'nowrap';
      dateCell.setText(new Date(email.date).toLocaleDateString());

      const subjectCell = row.createEl('td', { cls: 'mailer-td' });
      subjectCell.setText(email.subject);

      const authorCell = row.createEl('td', { cls: 'mailer-td' });
      authorCell.setText(email.author);
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

    const metaDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-mb-12' });
    const dirName = email.direction_name || this.plugin.emailDb.getDirectionName(email.direction_id);
    metaDiv.createDiv({ text: `Автор: ${email.author}` });
    metaDiv.createDiv({ text: `Дата: ${new Date(email.date).toLocaleString()}` });
    metaDiv.createDiv({ text: `Направление: ${dirName}` });
    metaDiv.createDiv({ text: `Статус: ${email.sync_status === 'synced' ? '☁️ Синхронизировано' : '📝 Локально'}` });

    container.createEl('h4', { text: 'Содержимое письма' });
    const textDiv = container.createDiv();
    textDiv.style.whiteSpace = 'pre-wrap';
    textDiv.style.fontSize = 'var(--font-ui-small)';
    textDiv.setText(email.text);

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const editBtn = btnRow.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addEventListener('click', () => this.showEditForm(email));

    const exportBtn = btnRow.createEl('button', { text: '📥 Экспорт в Word', cls: 'mailer-yougile-refresh-btn' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.setText('⏳');
      exportBtn.setAttr('disabled', 'true');
      try {
        const svc = new DocumentService(this.plugin.app);
        await svc.exportToDocx(
          {
            number: email.number,
            subject: email.subject,
            text: email.text,
            date: email.date,
            author: email.author,
            images: email.images,
          },
          this.plugin.settings.docxTemplatePath,
          this.plugin.settings.docxExportFolder,
        );
      } catch {
        // error handled in service
      } finally {
        exportBtn.setText('📥 Экспорт в Word');
        exportBtn.removeAttribute('disabled');
      }
    });

    if (email.images && email.images.length > 0) {
      const filesLabel = container.createEl('h4', { text: 'Прикреплённые файлы' });
      for (const url of email.images) {
        const name = url.split('/').pop() || url;
        const tag = container.createEl('span');
        tag.style.display = 'inline-block';
        tag.style.marginRight = '8px';
        tag.style.marginBottom = '4px';
        tag.style.padding = '2px 6px';
        tag.style.backgroundColor = 'var(--background-modifier-hover)';
        tag.style.borderRadius = '4px';
        tag.style.fontSize = 'var(--font-smaller)';
        tag.style.cursor = url.startsWith('http') ? 'pointer' : 'default';
        tag.style.textDecoration = url.startsWith('http') ? 'underline' : 'none';
        tag.setText(`📎 ${name}`);
        if (url.startsWith('http')) {
          tag.addEventListener('click', () => {
            window.open(url, '_blank');
          });
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

    const subjectLabel = container.createEl('label', { text: 'Тема письма' });
    const subjectInput = container.createEl('input', { attr: { type: 'text' } });
    subjectInput.value = email.subject;

    const textLabel = container.createEl('label', { text: 'Содержимое письма' });
    const textInput = container.createEl('textarea');
    textInput.value = email.text;
    textInput.style.minHeight = '150px';

    const filesLabel = container.createEl('label', { text: 'Прикреплённые файлы' });
    const filesDiv = container.createDiv({ cls: 'mailer-mb-8' });

    const fileInput = container.createEl('input', { attr: { type: 'file', multiple: 'true' } });
    fileInput.style.display = 'none';
    const attachBtn = filesDiv.createEl('button', { text: '📎 Прикрепить файл', cls: 'mailer-yougile-refresh-btn' });
    attachBtn.addEventListener('click', () => fileInput.click());

    const attachedFiles: { name: string; url: string }[] = (email.images || []).map(url => ({ name: url.split('/').pop() || url, url }));
    const fileListDiv = filesDiv.createDiv();
    fileListDiv.style.marginTop = '4px';
    fileListDiv.style.fontSize = 'var(--font-smaller)';
    const renderFiles = () => {
      this.renderAttachedFiles(fileListDiv, attachedFiles, (url) => {
        const idx = attachedFiles.findIndex(f => f.url === url);
        if (idx !== -1) attachedFiles.splice(idx, 1);
        renderFiles();
      });
    };
    renderFiles();

    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      for (const file of Array.from(files)) {
        try {
          const buffer = await file.arrayBuffer();
          const result = await this.plugin.client.uploadFile(buffer, file.name);
          const url = result.url || '';
          attachedFiles.push({ name: file.name, url });
          renderFiles();
          new Notice(`✅ Файл прикреплён: ${file.name}`);
        } catch {
          attachedFiles.push({ name: file.name, url: file.name });
          renderFiles();
          new Notice(`📎 Файл добавлен локально: ${file.name}`);
        }
      }
      fileInput.value = '';
    });

    const dirLabel = container.createEl('label', { text: 'Направление' });
    const dirSelect = container.createEl('select', { cls: 'mailer-mb-12' });

    const columns = this.getBoardColumns();
    const currentDirName = email.direction_name || this.plugin.emailDb.getDirectionName(email.direction_id);
    for (const col of columns) {
      const name = this.getDirectionName(col.id);
      const opt = dirSelect.createEl('option', { value: col.id, text: name });
      if (name === currentDirName) opt.selected = true;
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

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
        direction_name: dirName,
      }, null, 2);

      try {
        if (email.taskId) {
          await this.plugin.client.updateTask(email.taskId, {
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
            assigned: this.getAssignedUserId(),
          });
        } else {
          const task = await this.plugin.client.createTask({
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
            assigned: this.getAssignedUserId(),
          });
          await this.plugin.client.updateTask(task.id, { completed: true });
          email.taskId = task.id;
        }
        email.number = number;
        email.subject = subject;
        email.text = text;
        email.direction_id = directionId;
        email.direction_name = dirName;
        email.images = attachedFiles.map(f => f.url);
        email.lastSyncTime = now;
        email.sync_status = 'synced';
        this.plugin.emailDb.addEmail(email);
        new Notice('Письмо сохранено');
        this.renderEmailDetail(email);
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          email.number = number;
          email.subject = subject;
          email.text = text;
          email.direction_id = directionId;
          email.direction_name = dirName;
          this.plugin.emailDb.addEmail(email);
          const payload: Record<string, unknown> = {
            title: `[Письмо] ${number} — ${subject}`,
            description: descriptionJSON,
            columnId: selectedColumnId,
            completed: true,
            assigned: this.getAssignedUserId(),
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

    const subjectLabel = container.createEl('label', { text: 'Тема письма' });
    const subjectInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Тема' } });
    subjectInput.value = initialSubject;

    const textLabel = container.createEl('label', { text: 'Содержимое письма' });
    const textInput = container.createEl('textarea');
    textInput.value = initialText;
    textInput.style.minHeight = '100px';

    const filesLabel = container.createEl('label', { text: 'Прикреплённые файлы' });
    const filesDiv = container.createDiv({ cls: 'mailer-mb-8' });

    const fileInput = container.createEl('input', { attr: { type: 'file', multiple: 'true' } });
    fileInput.style.display = 'none';
    const attachBtn = filesDiv.createEl('button', { text: '📎 Прикрепить файл', cls: 'mailer-yougile-refresh-btn' });
    attachBtn.addEventListener('click', () => fileInput.click());

    const attachedFiles: { name: string; url: string }[] = [];

    const fileListDiv = filesDiv.createDiv();
    fileListDiv.style.marginTop = '4px';
    fileListDiv.style.fontSize = 'var(--font-smaller)';
    const renderFiles = () => {
      this.renderAttachedFiles(fileListDiv, attachedFiles, (url) => {
        const idx = attachedFiles.findIndex(f => f.url === url);
        if (idx !== -1) attachedFiles.splice(idx, 1);
        renderFiles();
      });
    };
    renderFiles();

    fileInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      for (const file of Array.from(files)) {
        try {
          const buffer = await file.arrayBuffer();
          const result = await this.plugin.client.uploadFile(buffer, file.name);
          const url = result.url || '';
          attachedFiles.push({ name: file.name, url });
          this.renderAttachedFiles(fileListDiv, attachedFiles);
          new Notice(`✅ Файл прикреплён: ${file.name}`);
        } catch {
          attachedFiles.push({ name: file.name, url: file.name });
          this.renderAttachedFiles(fileListDiv, attachedFiles);
          new Notice(`📎 Файл добавлен локально: ${file.name}`);
        }
      }
      fileInput.value = '';
    });

    const dirLabel = container.createEl('label', { text: 'Направление' });
    const dirSelect = container.createEl('select', { cls: 'mailer-mb-12' });

    const columns = this.getBoardColumns();
    const mappings = this.getDirectionMappings();
    for (const col of columns) {
      const mapping = mappings.find(m => m.columnId === col.id);
      const name = mapping ? mapping.directionName : col.title;
      dirSelect.createEl('option', { value: col.id, text: name });
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

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
      const author = this.plugin.settings.emailDefaultAuthor || 'Кравченко А.А.';

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
        direction_name: dirName,
        images: attachedFiles.map(f => f.url),
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
        direction_name: dirName,
      }, null, 2);

      try {
        const task = await this.plugin.client.createTask({
          title: `[Письмо] ${number} — ${subject}`,
          description: descriptionJSON,
          columnId: selectedColumnId,
          assigned: this.getAssignedUserId(),
        });
        await this.plugin.client.updateTask(task.id, { completed: true });
        emailItem.taskId = task.id;
        emailItem.sync_status = 'synced';
        emailItem.lastSyncTime = new Date().toISOString();
        this.plugin.emailDb.addEmail(emailItem);
        new Notice('Письмо сохранено и отправлено на сервер');
        this.renderView();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.emailDb.addEmail(emailItem);
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title: `[Письмо] ${number} — ${subject}`,
              description: descriptionJSON,
              columnId: selectedColumnId,
              completed: true,
              assigned: this.getAssignedUserId(),
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

  private renderAttachedFiles(container: HTMLElement, files: { name: string; url: string }[], onRemove?: (index: number) => void): void {
    container.empty();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const tag = container.createEl('span');
      tag.style.display = 'inline-flex';
      tag.style.alignItems = 'center';
      tag.style.marginRight = '8px';
      tag.style.marginBottom = '4px';
      tag.style.padding = '2px 6px';
      tag.style.backgroundColor = 'var(--background-modifier-hover)';
      tag.style.borderRadius = '4px';
      tag.style.fontSize = 'var(--font-smaller)';
      tag.setText(`📎 ${f.name}`);
      if (onRemove) {
        const removeBtn = tag.createEl('span', { cls: 'mailer-clickable mailer-bold' });
        removeBtn.setText(' ×');
        removeBtn.style.marginLeft = '4px';
        removeBtn.style.color = 'var(--text-error)';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onRemove(i);
        });
      }
    }
  }

  private async exportHtml(): Promise<void> {
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
        const dir = e.direction_name || this.plugin.emailDb.getDirectionName(e.direction_id);
        if (!dir) return false;
        return selectedColIds.some(colId => {
          const dirName = this.getDirectionName(colId);
          return dir === dirName;
        });
      });
    }
    if (this.filterDateFrom) {
      const from = new Date(this.filterDateFrom);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter(e => new Date(e.date) >= from);
    }
    if (this.filterDateTo) {
      const to = new Date(this.filterDateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(e => new Date(e.date) <= to);
    }
    if (this.filterAuthor) {
      filtered = filtered.filter(e => e.author === this.filterAuthor);
    }
    filtered.sort((a, b) => b.id - a.id);

    let html = '';
    for (const e of filtered) {
      const d = new Date(e.date);
      const dateStr = d.toLocaleDateString('ru-RU');
      const numDate = `${e.number} от ${dateStr}`;
      const attachments = (e.images || []).map(url => url.split('/').pop() || url).join('; ');
      html += `<tr>
<td style="text-align: center;">${this.escapeHtml(numDate)}</td>
<td style="text-align: center;">${this.escapeHtml(attachments)}</td>
<td style="text-align: center;"><h1 style="font-weight: normal; font-size: 12pt;">${this.escapeHtml(e.subject)}</h1></td>
<td style="text-align: center;"></td>
</tr>\n`;
    }

    try {
      await navigator.clipboard.writeText(html);
      new Notice(`✅ Скопировано ${filtered.length} строк в буфер обмена`);
    } catch {
      new Notice('❌ Не удалось скопировать в буфер');
    }
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    await this.plugin.emailDb.syncFromTasks(this.plugin.db.getTasks());
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
  selectedModel = '';

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

    const modelRow = contentEl.createDiv({ cls: 'mailer-yougile-header mailer-mb-8' });
    modelRow.createSpan({ text: '🤖 Модель:' })
      .style.cssText = 'font-size:12px;color:var(--text-muted);margin-right:6px;';
    const modelSel = modelRow.createEl('select');
    modelSel.addClass('dropdown');
    modelSel.style.cssText = 'max-width:260px;font-size:12px;';
    modelSel.createEl('option', { value: '', text: 'По умолчанию' });
    for (const m of (this.plugin.settings.llmModels || [])) {
      if (m && m.trim()) modelSel.createEl('option', { value: m.trim(), text: m.trim() });
    }
    modelSel.value = this.selectedModel;
    modelSel.addEventListener('change', () => { this.selectedModel = modelSel.value; });

    const infoBar = contentEl.createDiv({ cls: 'mailer-yougile-sync-indicator' });
    const allEmails = this.plugin.emailDb.getAllEmails();
    infoBar.setText(`📊 База знаний: ${allEmails.length} писем | Загруженных файлов: ${this.uploadedFiles.length}`);

    this.chatContainer = contentEl.createDiv({ cls: 'mailer-mb-8' });
    this.chatContainer.style.maxHeight = '400px';
    this.chatContainer.style.overflowY = 'auto';

    const welcome = this.chatContainer.createDiv({ cls: 'mailer-yougile-sync-indicator' });
    welcome.setText('👋 Здравствуйте! Задайте мне вопрос по базе писем или загрузите документ для анализа.');

    const fileArea = contentEl.createDiv({ cls: 'mailer-mb-8' });

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

    this.inputArea = contentEl.createEl('textarea', { attr: { placeholder: 'Введите вопрос... (Enter для отправки, Shift+Enter для переноса)' }, cls: 'mailer-textarea' });
    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const btnRow = contentEl.createDiv({ cls: 'mailer-yougile-header mailer-mt-8' });

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

      const answer = await this.plugin.llmService.ask(question, fileContext, historyContext, this.selectedModel);
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
    const label = msgEl.createDiv({ cls: 'mailer-bold mailer-mb-2' });
    label.setText(role === 'user' ? '👤 Вы' : '🤖 AI');
    msgEl.createDiv().setText(content);
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

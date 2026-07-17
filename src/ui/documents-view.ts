import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CreateTaskPayload } from '../types/yougile';
import { AssigneeSelector } from './assignee-selector';

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && e.message === 'Failed to fetch') return true;
  if (e instanceof Error && /network|fetch|offline|econnrefused|enotfound|dns|timeout/i.test(e.message)) return true;
  return false;
}

export const DOCUMENTS_VIEW_TYPE = 'yougile-documents-view';

interface RemarkFile {
  name: string;
  url: string;
}

interface RemarkItem {
  elementNumber: string;
  currentEdition: string;
  proposedEdition: string;
  justification: string;
  files: RemarkFile[];
  authorEmail: string;
}

interface DocumentItem {
  taskId: string;
  title: string;
  docType: string;
  docTypeId: string;
  curatorName: string;
  curatorEmail: string;
  deadline: number;
  linkUrl: string;
  linkFileName: string;
  completed: boolean;
  parentId: string;
  remarks: RemarkItem[];
}

function parseDocument(task: { id: string; title: string; description: string; columnId: string; completed: boolean; assigned: string[]; deadline?: number }): DocumentItem | null {
  if (!task.description) return null;
  const desc = task.description.trim();
  if (!desc.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(desc);
    if (parsed && typeof parsed === 'object' && parsed.type === 'document') {
      return {
        taskId: task.id,
        title: task.title,
        docType: '',
        docTypeId: task.columnId,
        curatorName: task.assigned.length > 0 ? task.assigned[0] : '',
        curatorEmail: parsed.curatorEmail || '',
        deadline: task.deadline || 0,
        linkUrl: parsed.link || '',
        linkFileName: parsed.fileName || parsed.link || '',
        completed: task.completed,
        parentId: parsed.parentId || '',
        remarks: Array.isArray(parsed.remarks) ? parsed.remarks : [],
      };
    }
  } catch {
    // not a valid document JSON
  }
  return null;
}

export class DocumentsView extends ItemView {
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
    return DOCUMENTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Документы';
  }

  getIcon(): string {
    return 'file-text';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');

    this.containerElContent = container.createDiv();
    this.selectedColumnIds = new Set(this.plugin.settings.docsSelectedColumnIds.split(',').filter(Boolean));
    this.renderView();
  }

  private getBoardColumns(): Array<{ id: string; title: string }> {
    const boardId = this.plugin.settings.docsBoardId;
    if (!boardId) return [];
    const columns = this.plugin.db.getColumns().filter(c => c.boardId === boardId);
    columns.sort((a, b) => a.title.localeCompare(b.title));
    return columns;
  }

  private resolveDocDisplay(doc: DocumentItem): void {
    const col = this.plugin.db.getColumns().find(c => c.id === doc.docTypeId);
    doc.docType = col?.title || doc.docTypeId;
    const assigneeName = doc.curatorName ? this.plugin.db.getUserName(doc.curatorName) : '';
    doc.curatorName = assigneeName || doc.curatorEmail;
  }

  private getDocuments(): DocumentItem[] {
    const tasks = this.plugin.db.getTasks();
    const projectId = this.plugin.settings.docsProjectId;
    const boardId = this.plugin.settings.docsBoardId;

    let filtered = tasks;
    if (projectId) filtered = filtered.filter(t => t.projectId === projectId);
    if (boardId) filtered = filtered.filter(t => t.boardId === boardId);
    if (this.selectedColumnIds.size > 0) {
      filtered = filtered.filter(t => this.selectedColumnIds.has(t.columnId));
    }

    const docs: DocumentItem[] = [];
    for (const t of filtered) {
      const doc = parseDocument(t);
      if (doc && !doc.parentId) {
        this.resolveDocDisplay(doc);
        docs.push(doc);
      }
    }
    docs.sort((a, b) => (b.deadline || 0) - (a.deadline || 0));
    return docs;
  }

  private getFilteredDocuments(): DocumentItem[] {
    const docs = this.getDocuments();
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(d => d.title.toLowerCase().includes(q));
  }

  private getRelatedDocuments(parentId: string): DocumentItem[] {
    const allTasks = this.plugin.db.getTasks();
    const related: DocumentItem[] = [];
    for (const t of allTasks) {
      const doc = parseDocument(t);
      if (doc && doc.parentId === parentId) {
        this.resolveDocDisplay(doc);
        related.push(doc);
      }
    }
    related.sort((a, b) => (b.deadline || 0) - (a.deadline || 0));
    return related;
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;

    const headerEl = container.createDiv({ cls: 'mailer-yougile-header' });
    headerEl.style.justifyContent = 'space-between';

    const titleEl = headerEl.createEl('h3', { text: 'Документы' });
    titleEl.style.margin = '0';

    const actionRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mb-8' });

    const createBtn = actionRow.createEl('button', { text: '➕ Добавить документ', cls: 'mailer-yougile-refresh-btn' });
    const syncBtn = actionRow.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    const exportHtmlBtn = actionRow.createEl('button', { text: '📄 Экспорт HTML', cls: 'mailer-yougile-refresh-btn' });
    const exportCsvBtn = actionRow.createEl('button', { text: '📊 Экспорт CSV', cls: 'mailer-yougile-refresh-btn' });

    createBtn.addEventListener('click', () => this.showCreateForm());
    syncBtn.addEventListener('click', () => this.syncAndRender());
    exportHtmlBtn.addEventListener('click', () => this.exportHtml());
    exportCsvBtn.addEventListener('click', () => this.exportCsv());

    const syncStatus = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано' });

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по названию...' }, cls: 'mailer-input' });
    searchInput.classList.add('mailer-mb-8');
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
          this.plugin.settings.docsSelectedColumnIds = Array.from(this.selectedColumnIds).join(',');
          this.plugin.saveSettings();
          this.renderView();
        });
      }
    }

    const docs = this.getFilteredDocuments();

    const table = container.createEl('table', { cls: 'mailer-table' });

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    const headers = ['Наименование', 'Тип документа', 'Куратор', 'Срок действия', 'Ссылка'];
    for (const h of headers) {
      headerRow.createEl('th', { cls: 'mailer-th', text: h });
    }

    const tbody = table.createEl('tbody');

    if (docs.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td');
      td.setAttr('colspan', '5');
      td.setText('Нет документов');
      td.style.textAlign = 'center';
      td.style.padding = '24px';
      td.style.color = 'var(--text-muted)';
    }

    for (const doc of docs) {
      const row = tbody.createEl('tr');
      row.addClass('mailer-clickable');
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = 'var(--background-modifier-hover)'; });
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = ''; });

      const titleCell = row.createEl('td', { cls: 'mailer-td', text: doc.title });

      const typeCell = row.createEl('td', { cls: 'mailer-td', text: doc.docType });

      const curatorCell = row.createEl('td', { cls: 'mailer-td', text: doc.curatorName || '—' });

      const deadlineCell = row.createEl('td', { cls: 'mailer-td' });
      if (doc.deadline) {
        const d = new Date(doc.deadline);
        deadlineCell.setText(d.toLocaleDateString());
        const now = Date.now();
        const diff = doc.deadline - now;
        const daysLeft = Math.ceil(diff / 86400000);
        if (doc.completed) {
          deadlineCell.style.color = 'var(--color-green)';
        } else if (daysLeft < 0) {
          deadlineCell.style.color = 'var(--color-red)';
          deadlineCell.style.fontWeight = 'bold';
        } else if (daysLeft <= 7) {
          deadlineCell.style.color = 'var(--color-orange)';
        } else {
          deadlineCell.style.color = 'var(--color-green)';
        }
      } else {
        deadlineCell.setText('—');
      }

      const linkCell = row.createEl('td', { cls: 'mailer-td' });
      if (doc.linkUrl) {
        const a = linkCell.createEl('a', { href: doc.linkUrl });
        a.setText(doc.linkFileName || 'Ссылка');
        a.addClass('mailer-word-break');
      } else {
        linkCell.setText('—');
      }

      row.addEventListener('click', () => this.renderDocumentDetail(doc));
    }
  }

  private renderDocumentDetail(doc: DocumentItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: doc.title });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    const lines: string[] = [
      `📂 Тип документа: ${doc.docType}`,
      `👤 Куратор: ${doc.curatorName || '—'}`,
    ];
    if (doc.deadline) {
      const d = new Date(doc.deadline);
      lines.push(`📅 Срок действия: ${d.toLocaleDateString()}`);
    }
    lines.push(`✅ Статус: ${doc.completed ? 'Завершён' : 'Активен'}`);
    for (const l of lines) {
      meta.createDiv({ text: l });
    }

    if (doc.linkUrl) {
      const linkDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-section-divider' });
      linkDiv.createDiv({ text: 'Ссылка на документ:' });
      const a = linkDiv.createEl('a', { href: doc.linkUrl });
      a.setText(doc.linkFileName || doc.linkUrl);
      const ext = doc.linkFileName.toLowerCase().split('.').pop() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
      if (isImage && doc.linkUrl.startsWith('http')) {
        linkDiv.createEl('br');
        const img = linkDiv.createEl('img', { attr: { src: doc.linkUrl, alt: doc.linkFileName } });
        img.style.maxWidth = '100%';
        img.style.maxHeight = '300px';
        img.style.marginTop = '8px';
      }
    }

    if (doc.remarks.length > 0) {
      const remarksDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-section-divider' });
      remarksDiv.createDiv({ text: `📝 Замечания (${doc.remarks.length}):` });

      const remTable = remarksDiv.createEl('table', { cls: 'mailer-table' });
      remTable.style.marginTop = '4px';

      const remThead = remTable.createEl('thead');
      const remHeaderRow = remThead.createEl('tr');
      const remHeaders = ['№ п/п', 'Номер структурного элемента', 'Текущая редакция', 'Предлагаемая редакция', 'Обоснование изменений', 'Файлы', 'Автор'];
      for (const rh of remHeaders) {
        remHeaderRow.createEl('th', { cls: 'mailer-th-sm', text: rh });
      }

      const remTbody = remTable.createEl('tbody');
      for (let i = 0; i < doc.remarks.length; i++) {
        const r = doc.remarks[i];
        const row = remTbody.createEl('tr');

        const numCell = row.createEl('td', { cls: 'mailer-td-sm' });
        numCell.setText(String(i + 1));

        const elemCell = row.createEl('td', { cls: 'mailer-td-sm' });
        elemCell.setText(r.elementNumber || '—');

        const curCell = row.createEl('td', { cls: 'mailer-td-sm' });
        curCell.setText(r.currentEdition || '—');

        const propCell = row.createEl('td', { cls: 'mailer-td-sm' });
        propCell.setText(r.proposedEdition || '—');

        const justCell = row.createEl('td', { cls: 'mailer-td-sm' });
        justCell.setText(r.justification || '—');

        const fileCell = row.createEl('td', { cls: 'mailer-td-sm' });
        if (r.files && r.files.length > 0) {
          for (const f of r.files) {
            const a = fileCell.createEl('a', { href: f.url });
            a.setText(f.name);
            fileCell.createEl('br');
          }
        } else {
          fileCell.setText('—');
        }

        const authorCell = row.createEl('td', { cls: 'mailer-td-sm' });
        authorCell.setText(r.authorEmail || '—');
      }
    }

    const relatedDocs = this.getRelatedDocuments(doc.taskId);
    if (relatedDocs.length > 0) {
      const relatedDiv = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-section-divider' });
      relatedDiv.createDiv({ text: `📎 Связанные документы (${relatedDocs.length}):` });
      for (const rd of relatedDocs) {
        const rdRow = relatedDiv.createDiv({ cls: 'mailer-clickable' });
        rdRow.style.marginTop = '4px';
        rdRow.addEventListener('click', () => this.renderDocumentDetail(rd));
        const rdTitle = rdRow.createEl('span');
        rdTitle.setText(rd.title);
        rdTitle.style.fontWeight = 'bold';
        if (rd.linkUrl) {
          rdRow.createEl('br');
          const rdLink = rdRow.createEl('a', { href: rd.linkUrl });
          rdLink.setText(rd.linkFileName || 'Ссылка');
          rdLink.addClass('mailer-word-break');
          const ext = rd.linkFileName.toLowerCase().split('.').pop() || '';
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
          if (isImage && rd.linkUrl.startsWith('http')) {
            rdRow.createEl('br');
            const img = rdRow.createEl('img', { attr: { src: rd.linkUrl, alt: rd.linkFileName } });
            img.style.maxWidth = '100%';
            img.style.maxHeight = '150px';
            img.style.marginTop = '4px';
          }
        }
        if (rd.curatorName) {
          rdRow.createEl('br');
          rdRow.createEl('span', { text: `👤 ${rd.curatorName}` }).style.fontSize = 'var(--font-smallest)';
        }
      }
    }

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const relatedBtn = btnRow.createEl('button', { text: '🔗 Создать связанный документ', cls: 'mailer-yougile-refresh-btn' });
    relatedBtn.addEventListener('click', () => this.showCreateRelatedForm(doc));

    const remarkBtn = btnRow.createEl('button', { text: '📝 Добавить замечания к документу', cls: 'mailer-yougile-refresh-btn' });
    remarkBtn.addEventListener('click', () => this.showRemarkForm(doc));

    if (doc.remarks.length > 0) {
      const exportBtn = btnRow.createEl('button', { text: '📥 Сохранить замечания в csv', cls: 'mailer-yougile-refresh-btn' });
      exportBtn.addEventListener('click', () => this.exportRemarksToXlsx(doc));
    }

    if (doc.completed) {
      const reopenBtn = btnRow.createEl('button', { text: '🔄 Возобновить', cls: 'mailer-yougile-refresh-btn' });
      reopenBtn.addEventListener('click', async () => {
        try {
          await this.plugin.client.updateTask(doc.taskId, { completed: false });
          new Notice('Документ возобновлён');
          this.syncAndRender();
        } catch (e: unknown) {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    } else {
      const completeBtn = btnRow.createEl('button', { text: '✅ Завершить', cls: 'mailer-yougile-refresh-btn' });
      completeBtn.addEventListener('click', async () => {
        try {
          await this.plugin.client.updateTask(doc.taskId, { completed: true });
          new Notice('Документ завершён');
          this.syncAndRender();
        } catch (e: unknown) {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    }
  }

  showCreateForm(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: 'Новый документ' });

    const projectId = this.plugin.settings.docsProjectId;
    const boardId = this.plugin.settings.docsBoardId;
    const pTitle = this.plugin.db.getProjects().find(p => p.id === projectId)?.title || '—';
    const bTitle = this.plugin.db.getBoards().find(b => b.id === boardId)?.title || '—';
    container.createDiv({ cls: 'mailer-yougile-task-meta', text: `Проект: ${pTitle} · Доска: ${bTitle}` });

    const titleInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Введите наименование документа' }, cls: 'mailer-input' });

    const typeLabel = container.createEl('label', { text: 'Тип документа' });
    const typeSelect = container.createEl('select', { cls: 'mailer-select' });
    const columns = this.getBoardColumns();
    for (const col of columns) {
      typeSelect.createEl('option', { value: col.id, text: col.title });
    }

    const curatorSelector = new AssigneeSelector(container, 'Куратор', () => this.plugin.db.getUsers());

    const deadlineLabel = container.createEl('label', { text: 'Срок действия' });
    const deadlineInput = container.createEl('input', { attr: { type: 'date' }, cls: 'mailer-input' });
    deadlineInput.value = new Date().toISOString().slice(0, 10);

    const linkLabel = container.createEl('label', { text: 'Ссылка на документ (только https://kb.tn.ru/file или https://www.kb.tn.ru/file)' });
    const linkUrlInput = container.createEl('input', { attr: { type: 'url', placeholder: 'https://kb.tn.ru/file/...' }, cls: 'mailer-input' });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { new Notice('Введите наименование документа'); return; }
      const deadlineVal = deadlineInput.value;
      if (!deadlineVal) { new Notice('Укажите срок действия'); return; }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const assignedIds = curatorSelector.getSelectedIds();
      const curatorEmail = (() => {
        const users = this.plugin.db.getUsers();
        for (const id of assignedIds) {
          const u = users.find(u2 => u2.id === id);
          if (u?.email) return u.email;
        }
        return '';
      })();

      const linkUrl = linkUrlInput.value.trim();
      if (!linkUrl) {
        new Notice('Укажите ссылку на документ');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }
      if (!linkUrl.startsWith('https://kb.tn.ru/file') && !linkUrl.startsWith('https://www.kb.tn.ru/file')) {
        new Notice('Ссылка должна начинаться с https://kb.tn.ru/file или https://www.kb.tn.ru/file');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }

      const description = JSON.stringify({
        type: 'document',
        link: linkUrl,
        fileName: linkUrl,
        curatorEmail: curatorEmail,
      }, null, 2);

      const selectedColumnId = typeSelect.value;
      const deadlineMs = new Date(`${deadlineVal}T23:59:59`).getTime();

      try {
        const payload: CreateTaskPayload = {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        await this.plugin.client.createTask(payload);
        new Notice('Документ создан');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title,
              description,
              columnId: selectedColumnId || undefined,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
              deadline: { deadline: deadlineMs, withTime: true },
            },
          });
          new Notice('Нет соединения. Документ будет создан позже.');
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

  private showCreateRelatedForm(parentDoc: DocumentItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderDocumentDetail(parentDoc));

    container.createEl('h3', { text: `Связанный документ: ${parentDoc.title}` });

    const pTitle = this.plugin.db.getProjects().find(p => p.id === this.plugin.settings.docsProjectId)?.title || '—';
    const bTitle = this.plugin.db.getBoards().find(b => b.id === this.plugin.settings.docsBoardId)?.title || '—';
    container.createDiv({ cls: 'mailer-yougile-task-meta', text: `Проект: ${pTitle} · Доска: ${bTitle}` });

    const titleInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Введите наименование документа' }, cls: 'mailer-input' });

    const relatedCuratorSelector = new AssigneeSelector(container, 'Куратор', () => this.plugin.db.getUsers());

    const inheritInfo = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-mb-8' });
    if (parentDoc.deadline) {
      const d = new Date(parentDoc.deadline);
      inheritInfo.setText(`📅 Срок действия наследуется от родителя: ${d.toLocaleDateString()}`);
    } else {
      inheritInfo.setText('📅 Срок действия не задан у родителя');
    }

    const linkLabel = container.createEl('label', { text: 'Ссылка на документ (только https://kb.tn.ru/file или https://www.kb.tn.ru/file)' });
    const linkUrlInput = container.createEl('input', { attr: { type: 'url', placeholder: 'https://kb.tn.ru/file/...' }, cls: 'mailer-input' });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderDocumentDetail(parentDoc));

    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { new Notice('Введите наименование документа'); return; }
      const deadlineMs = parentDoc.deadline || Date.now() + 365 * 86400000;

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const assignedIds = relatedCuratorSelector.getSelectedIds();
      const curatorEmail = (() => {
        const users = this.plugin.db.getUsers();
        for (const id of assignedIds) {
          const u = users.find(u2 => u2.id === id);
          if (u?.email) return u.email;
        }
        return '';
      })();

      const linkUrl = linkUrlInput.value.trim();
      if (!linkUrl) {
        new Notice('Укажите ссылку на документ');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }
      if (!linkUrl.startsWith('https://kb.tn.ru/file') && !linkUrl.startsWith('https://www.kb.tn.ru/file')) {
        new Notice('Ссылка должна начинаться с https://kb.tn.ru/file или https://www.kb.tn.ru/file');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }

      const description = JSON.stringify({
        type: 'document',
        parentId: parentDoc.taskId,
        link: linkUrl,
        fileName: linkUrl,
        curatorEmail: curatorEmail,
      }, null, 2);

      const selectedColumnId = parentDoc.docTypeId;

      try {
        const payload: CreateTaskPayload = {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        await this.plugin.client.createTask(payload);
        new Notice('Связанный документ создан');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title,
              description,
              columnId: selectedColumnId || undefined,
              assigned: assignedIds.length > 0 ? assignedIds : undefined,
              deadline: { deadline: deadlineMs, withTime: true },
            },
          });
          new Notice('Нет соединения. Связанный документ будет создан позже.');
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

  private showRemarkForm(doc: DocumentItem): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = true;

    const backBtn = container.createEl('button', { text: '← Назад', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderDocumentDetail(doc));

    container.createEl('h3', { text: `Замечания к документу: ${doc.title}` });

    const elemLabel = container.createEl('label', { text: 'Номер структурного элемента документа' });
    const elemInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Например: 1.2.3' }, cls: 'mailer-input' });

    const curLabel = container.createEl('label', { text: 'Текущая редакция' });
    const curInput = container.createEl('textarea', { cls: 'mailer-textarea' });

    const propLabel = container.createEl('label', { text: 'Предлагаемая редакция' });
    const propInput = container.createEl('textarea', { cls: 'mailer-textarea' });

    const justLabel = container.createEl('label', { text: 'Обоснование изменений' });
    const justInput = container.createEl('textarea', { cls: 'mailer-textarea' });

    const fileLabel = container.createEl('label', { text: 'Прикрепить файл к замечанию' });
    const fileInput = container.createEl('input', { attr: { type: 'file' }, cls: 'mailer-mb-8' });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mt-12' });

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить замечание', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderDocumentDetail(doc));

    saveBtn.addEventListener('click', async () => {
      const elementNumber = elemInput.value.trim();
      const currentEdition = curInput.value.trim();
      const proposedEdition = propInput.value.trim();
      const justification = justInput.value.trim();
      if (!elementNumber && !currentEdition && !proposedEdition && !justification) {
        new Notice('Заполните хотя бы одно поле'); return;
      }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const remarkFiles: RemarkFile[] = [];
      if (fileInput.files?.[0]) {
        const file = fileInput.files[0];
        try {
          const buffer = await file.arrayBuffer();
          const result = await this.plugin.client.uploadFile(buffer, file.name);
          remarkFiles.push({ name: file.name, url: result.fullUrl });
        } catch (e: unknown) {
          if (!isNetworkError(e)) {
            new Notice(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
            saveBtn.setText('💾 Сохранить замечание');
            saveBtn.removeAttribute('disabled');
            cancelBtn.removeAttribute('disabled');
            return;
          }
        }
      }

      const newRemark: RemarkItem = {
        elementNumber,
        currentEdition,
        proposedEdition,
        justification,
        files: remarkFiles,
        authorEmail: this.plugin.settings.login,
      };

      // get current description JSON, append remark
      const task = this.plugin.db.getTasks().find(t => t.id === doc.taskId);
      let descriptionObj: Record<string, unknown> = {
        type: 'document',
        link: doc.linkUrl,
        fileName: doc.linkFileName,
        curatorEmail: doc.curatorEmail,
        parentId: doc.parentId,
      };
      if (task && task.description) {
        try {
          const parsed = JSON.parse(task.description);
          if (parsed && typeof parsed === 'object') {
            descriptionObj = parsed;
          }
        } catch { /* keep default */ }
      }
      const existingRemarks: RemarkItem[] = Array.isArray(descriptionObj.remarks) ? descriptionObj.remarks : [];
      existingRemarks.push(newRemark);
      descriptionObj.remarks = existingRemarks;

      try {
        await this.plugin.client.updateTask(doc.taskId, {
          description: JSON.stringify(descriptionObj, null, 2),
        });
        new Notice('Замечание сохранено');
        doc.remarks.push(newRemark);
        elemInput.value = '';
        curInput.value = '';
        propInput.value = '';
        justInput.value = '';
        fileInput.value = '';
        saveBtn.setText('💾 Сохранить замечание');
        saveBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.db.addToOfflineQueue({
            type: 'update-task',
            payload: {
              id: doc.taskId,
              description: JSON.stringify(descriptionObj, null, 2),
            },
          });
          new Notice('Нет соединения. Замечание будет сохранено позже.');
          this.renderDocumentDetail(doc);
        } else {
          new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
          saveBtn.setText('💾 Сохранить замечание');
          saveBtn.removeAttribute('disabled');
          cancelBtn.removeAttribute('disabled');
        }
      }
    });
  }

  private async exportRemarksToXlsx(doc: DocumentItem): Promise<void> {
    if (doc.remarks.length === 0) { new Notice('Нет замечаний для экспорта'); return; }

    const sep = ';';
    const csvEsc = (s: string | undefined | null): string => {
      const v = s || '';
      if (v.includes(sep) || v.includes('"') || v.includes('\n') || v.includes('\r')) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    const headers = ['№ п/п', 'Номер структурного элемента', 'Текущая редакция', 'Предлагаемая редакция', 'Обоснование изменений', 'Файлы', 'Автор'];
    const csvRows: string[] = [headers.join(sep)];
    for (let i = 0; i < doc.remarks.length; i++) {
      const r = doc.remarks[i];
      const filesStr = r.files.map(f => f.url ? f.name + ' (' + f.url + ')' : f.name).join('; ');
      csvRows.push([
        String(i + 1),
        csvEsc(r.elementNumber),
        csvEsc(r.currentEdition),
        csvEsc(r.proposedEdition),
        csvEsc(r.justification),
        csvEsc(filesStr),
        csvEsc(r.authorEmail),
      ].join(sep));
    }

    const safeTitle = (doc.title || 'документ').replace(/[<>:"/\\|?*]/g, '_');
    const fileName = `Замечания_${safeTitle}.csv`;
    try {
      const data = new TextEncoder().encode('\uFEFF' + csvRows.join('\r\n'));
      const existing = this.plugin.app.vault.getFileByPath(fileName);
      if (existing) {
        await this.plugin.app.vault.modifyBinary(existing, data);
      } else {
        await this.plugin.app.vault.createBinary(fileName, data);
      }
      const file = this.plugin.app.vault.getFileByPath(fileName)!;
      this.plugin.app.workspace.openLinkText(file.path, '');
      new Notice(`Файл "${fileName}" открыт`);
    } catch (e: unknown) {
      new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async exportHtml(): Promise<void> {
    const docs = this.getFilteredDocuments();
    let html = `<table style="width: 724px; border-collapse: collapse;" border="1" cellpadding="5">
<colgroup>
<col style="width: 40px;">
<col style="width: 180px;">
<col style="width: 120px;">
<col style="width: 100px;">
<col style="width: 100px;">
<col style="width: 100px;">
<col style="width: 84px;">
</colgroup>
<tbody>
<tr style="background-color: rgb(248, 202, 198);">
<td style="text-align: center;">№ п/п</td>
<td style="text-align: center;">Название документа</td>
<td style="text-align: center;">Тип документа</td>
<td style="text-align: center;">Срок действия</td>
<td style="text-align: center;">Куратор</td>
<td style="text-align: center;">Ссылка на документ</td>
<td style="text-align: center;">Ссылка на связанные документы</td>
</tr>\n`;
    let idx = 0;
    for (const doc of docs) {
      idx++;
      const deadlineStr = doc.deadline ? new Date(doc.deadline).toLocaleDateString() : '';
      const linkDoc = doc.linkUrl ? `<a href="${doc.linkUrl}">${doc.linkFileName || 'Ссылка'}</a>` : '';
      const related = this.getRelatedDocuments(doc.taskId);
      const relatedLinks = related.map(r => r.linkUrl ? `<a href="${r.linkUrl}">${r.linkFileName || 'Ссылка'}</a>` : '').filter(Boolean).join('<br>');
      html += `<tr>
<td style="text-align: center;">${idx}</td>
<td>${this.escapeHtmlCsv(doc.title)}</td>
<td>${this.escapeHtmlCsv(doc.docType)}</td>
<td style="text-align: center;">${deadlineStr}</td>
<td>${this.escapeHtmlCsv(doc.curatorName)}</td>
<td style="text-align: center;">${linkDoc}</td>
<td style="text-align: center;">${relatedLinks}</td>
</tr>\n`;
    }
    html += '</tbody></table>';
    try {
      await navigator.clipboard.writeText(html);
      new Notice(`✅ Скопировано ${docs.length} строк в буфер обмена`);
    } catch {
      new Notice('❌ Не удалось скопировать в буфер');
    }
  }

  private async exportCsv(): Promise<void> {
    const docs = this.getFilteredDocuments();
    const sep = ';';
    const csvEsc = (s: string | undefined | null): string => {
      if (!s) return '';
      const str = String(s);
      if (str.includes(sep) || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const headers = ['№ п/п', 'Название документа', 'Тип документа', 'Срок действия', 'Куратор', 'Ссылка на документ', 'Ссылка на связанные документы'];
    const csvRows: string[] = [headers.join(sep)];
    let idx = 0;
    for (const doc of docs) {
      idx++;
      const deadlineStr = doc.deadline ? new Date(doc.deadline).toLocaleDateString() : '';
      const related = this.getRelatedDocuments(doc.taskId);
      const relatedLinks = related.map(r => r.linkUrl || r.title).join('; ');
      csvRows.push([
        String(idx),
        csvEsc(doc.title),
        csvEsc(doc.docType),
        csvEsc(deadlineStr),
        csvEsc(doc.curatorName),
        csvEsc(doc.linkUrl || ''),
        csvEsc(relatedLinks),
      ].join(sep));
    }
    const safeName = 'Документы_' + new Date().toISOString().slice(0, 10);
    const fileName = `${safeName}.csv`;
    const folderPath = 'Экспорт';
    const adapter = this.plugin.app.vault.adapter;
    if (!await adapter.exists(folderPath)) {
      await this.plugin.app.vault.createFolder(folderPath);
    }
    let filePath = `${folderPath}/${fileName}`;
    let counter = 1;
    while (await adapter.exists(filePath)) {
      filePath = `${folderPath}/${safeName}_${counter}.csv`;
      counter++;
    }
    const data = new TextEncoder().encode('\uFEFF' + csvRows.join('\r\n'));
    await adapter.writeBinary(filePath, data.buffer as ArrayBuffer);
    new Notice(`✅ CSV экспорт: ${filePath}`);
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      await this.plugin.app.workspace.getLeaf().openFile(file);
    }
  }

  private escapeHtmlCsv(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

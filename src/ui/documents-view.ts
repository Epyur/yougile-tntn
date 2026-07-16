import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';

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

    const actionRow = container.createDiv({ cls: 'mailer-yougile-header' });
    actionRow.style.marginBottom = '8px';

    const createBtn = actionRow.createEl('button', { text: '➕ Добавить документ', cls: 'mailer-yougile-refresh-btn' });
    const syncBtn = actionRow.createEl('button', { text: 'Обновить', cls: 'mailer-yougile-refresh-btn' });

    createBtn.addEventListener('click', () => this.showCreateForm());
    syncBtn.addEventListener('click', () => this.syncAndRender());

    const syncStatus = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано' });

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по названию...' } });
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

    const table = container.createEl('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = 'var(--font-smaller)';

    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    const headers = ['Наименование', 'Тип документа', 'Куратор', 'Срок действия', 'Ссылка'];
    for (const h of headers) {
      const th = headerRow.createEl('th');
      th.setText(h);
      th.style.textAlign = 'left';
      th.style.padding = '6px 8px';
      th.style.borderBottom = '2px solid var(--background-modifier-border)';
      th.style.fontWeight = 'bold';
      th.style.whiteSpace = 'nowrap';
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
      row.style.cursor = 'pointer';
      row.style.borderBottom = '1px solid var(--background-modifier-border)';
      row.addEventListener('mouseenter', () => { row.style.backgroundColor = 'var(--background-modifier-hover)'; });
      row.addEventListener('mouseleave', () => { row.style.backgroundColor = ''; });

      const titleCell = row.createEl('td');
      titleCell.style.padding = '6px 8px';
      titleCell.setText(doc.title);

      const typeCell = row.createEl('td');
      typeCell.style.padding = '6px 8px';
      typeCell.setText(doc.docType);

      const curatorCell = row.createEl('td');
      curatorCell.style.padding = '6px 8px';
      curatorCell.setText(doc.curatorName || '—');

      const deadlineCell = row.createEl('td');
      deadlineCell.style.padding = '6px 8px';
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

      const linkCell = row.createEl('td');
      linkCell.style.padding = '6px 8px';
      if (doc.linkUrl) {
        const a = linkCell.createEl('a', { href: doc.linkUrl });
        a.setText(doc.linkFileName || 'Ссылка');
        a.style.wordBreak = 'break-all';
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
      const linkDiv = container.createDiv({ cls: 'mailer-yougile-task-meta' });
      linkDiv.style.marginTop = '12px';
      linkDiv.style.borderTop = '1px solid var(--background-modifier-border)';
      linkDiv.style.paddingTop = '8px';
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
      const remarksDiv = container.createDiv({ cls: 'mailer-yougile-task-meta' });
      remarksDiv.style.marginTop = '12px';
      remarksDiv.style.borderTop = '1px solid var(--background-modifier-border)';
      remarksDiv.style.paddingTop = '8px';
      remarksDiv.createDiv({ text: `📝 Замечания (${doc.remarks.length}):` });

      const remTable = remarksDiv.createEl('table');
      remTable.style.width = '100%';
      remTable.style.borderCollapse = 'collapse';
      remTable.style.fontSize = 'var(--font-smaller)';
      remTable.style.marginTop = '4px';

      const remThead = remTable.createEl('thead');
      const remHeaderRow = remThead.createEl('tr');
      const remHeaders = ['№ п/п', 'Номер структурного элемента', 'Текущая редакция', 'Предлагаемая редакция', 'Обоснование изменений', 'Файлы', 'Автор'];
      for (const rh of remHeaders) {
        const th = remHeaderRow.createEl('th');
        th.setText(rh);
        th.style.textAlign = 'left';
        th.style.padding = '4px 6px';
        th.style.borderBottom = '1px solid var(--background-modifier-border)';
        th.style.fontWeight = 'bold';
        th.style.whiteSpace = 'nowrap';
      }

      const remTbody = remTable.createEl('tbody');
      for (let i = 0; i < doc.remarks.length; i++) {
        const r = doc.remarks[i];
        const row = remTbody.createEl('tr');
        row.style.borderBottom = '1px solid var(--background-modifier-border)';

        const numCell = row.createEl('td');
        numCell.style.padding = '4px 6px';
        numCell.setText(String(i + 1));

        const elemCell = row.createEl('td');
        elemCell.style.padding = '4px 6px';
        elemCell.setText(r.elementNumber || '—');

        const curCell = row.createEl('td');
        curCell.style.padding = '4px 6px';
        curCell.setText(r.currentEdition || '—');

        const propCell = row.createEl('td');
        propCell.style.padding = '4px 6px';
        propCell.setText(r.proposedEdition || '—');

        const justCell = row.createEl('td');
        justCell.style.padding = '4px 6px';
        justCell.setText(r.justification || '—');

        const fileCell = row.createEl('td');
        fileCell.style.padding = '4px 6px';
        if (r.files && r.files.length > 0) {
          for (const f of r.files) {
            const a = fileCell.createEl('a', { href: f.url });
            a.setText(f.name);
            fileCell.createEl('br');
          }
        } else {
          fileCell.setText('—');
        }

        const authorCell = row.createEl('td');
        authorCell.style.padding = '4px 6px';
        authorCell.setText(r.authorEmail || '—');
      }
    }

    const relatedDocs = this.getRelatedDocuments(doc.taskId);
    if (relatedDocs.length > 0) {
      const relatedDiv = container.createDiv({ cls: 'mailer-yougile-task-meta' });
      relatedDiv.style.marginTop = '12px';
      relatedDiv.style.borderTop = '1px solid var(--background-modifier-border)';
      relatedDiv.style.paddingTop = '8px';
      relatedDiv.createDiv({ text: `📎 Связанные документы (${relatedDocs.length}):` });
      for (const rd of relatedDocs) {
        const rdRow = relatedDiv.createDiv();
        rdRow.style.marginTop = '4px';
        rdRow.style.cursor = 'pointer';
        rdRow.addEventListener('click', () => this.renderDocumentDetail(rd));
        const rdTitle = rdRow.createEl('span');
        rdTitle.setText(rd.title);
        rdTitle.style.fontWeight = 'bold';
        if (rd.linkUrl) {
          rdRow.createEl('br');
          const rdLink = rdRow.createEl('a', { href: rd.linkUrl });
          rdLink.setText(rd.linkFileName || 'Ссылка');
          rdLink.style.wordBreak = 'break-all';
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

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

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
        } catch (e) {
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
        } catch (e) {
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

    const titleInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Введите наименование документа' } });
    titleInput.style.width = '100%';
    titleInput.style.boxSizing = 'border-box';

    const typeLabel = container.createEl('label', { text: 'Тип документа' });
    const typeSelect = container.createEl('select');
    typeSelect.style.width = '100%';
    typeSelect.style.boxSizing = 'border-box';
    typeSelect.style.marginBottom = '8px';
    const columns = this.getBoardColumns();
    for (const col of columns) {
      typeSelect.createEl('option', { value: col.id, text: col.title });
    }

    const curatorLabel = container.createEl('label', { text: 'Куратор (email)' });
    const curatorInput = container.createEl('input', { attr: { type: 'text', placeholder: 'user@example.com' } });
    curatorInput.style.width = '100%';
    curatorInput.style.boxSizing = 'border-box';

    const deadlineLabel = container.createEl('label', { text: 'Срок действия' });
    const deadlineInput = container.createEl('input', { attr: { type: 'date' } });
    deadlineInput.style.width = '100%';
    deadlineInput.style.boxSizing = 'border-box';
    deadlineInput.value = new Date().toISOString().slice(0, 10);

    const linkLabel = container.createEl('label', { text: 'Ссылка на документ' });
    const linkTypeRow = container.createDiv({ cls: 'mailer-yougile-header' });
    linkTypeRow.style.marginBottom = '4px';
    const urlRadio = linkTypeRow.createEl('label');
    urlRadio.style.fontSize = 'var(--font-smaller)';
    urlRadio.style.display = 'inline-flex';
    urlRadio.style.alignItems = 'center';
    urlRadio.style.marginRight = '12px';
    const urlRadioBtn = urlRadio.createEl('input', { attr: { type: 'radio', name: 'linkType', value: 'url' } });
    urlRadioBtn.checked = true;
    urlRadio.append(' URL');

    const fileRadio = linkTypeRow.createEl('label');
    fileRadio.style.fontSize = 'var(--font-smaller)';
    fileRadio.style.display = 'inline-flex';
    fileRadio.style.alignItems = 'center';
    const fileRadioBtn = fileRadio.createEl('input', { attr: { type: 'radio', name: 'linkType', value: 'file' } });
    fileRadio.append(' Файл');

    const linkUrlInput = container.createEl('input', { attr: { type: 'url', placeholder: 'https://...' } });
    linkUrlInput.style.width = '100%';
    linkUrlInput.style.boxSizing = 'border-box';

    const fileInput = container.createEl('input', { attr: { type: 'file' } });
    fileInput.style.display = 'none';

    urlRadioBtn.addEventListener('change', () => {
      linkUrlInput.style.display = '';
      fileInput.style.display = 'none';
    });
    fileRadioBtn.addEventListener('change', () => {
      linkUrlInput.style.display = 'none';
      fileInput.style.display = '';
    });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { new Notice('Введите наименование документа'); return; }
      const curatorEmail = curatorInput.value.trim();
      const deadlineVal = deadlineInput.value;
      if (!deadlineVal) { new Notice('Укажите срок действия'); return; }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      let linkUrl = linkUrlInput.value.trim();
      let fileName = '';

      if (fileRadioBtn.checked && fileInput.files?.[0]) {
        const file = fileInput.files[0];
        try {
          const buffer = await file.arrayBuffer();
          const result = await this.plugin.client.uploadFile(buffer, file.name);
          linkUrl = result.fullUrl;
          fileName = file.name;
        } catch (e) {
          if (!isNetworkError(e)) {
            new Notice(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
            submitBtn.setText('✅ Создать');
            submitBtn.removeAttribute('disabled');
            cancelBtn.removeAttribute('disabled');
            return;
          }
        }
      } else if (urlRadioBtn.checked && linkUrl) {
        fileName = linkUrl;
      }

      if (!linkUrl) {
        new Notice('Укажите ссылку на документ или прикрепите файл');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }

      const description = JSON.stringify({
        type: 'document',
        link: linkUrl,
        fileName: fileName,
        curatorEmail: curatorEmail,
      }, null, 2);

      const selectedColumnId = typeSelect.value;
      const deadlineMs = new Date(`${deadlineVal}T23:59:59`).getTime();

      let assignedIds: string[] = [];
      if (curatorEmail) {
        const users = this.plugin.db.getUsers();
        const emailToId = new Map(users.map(u => [u.email || u.name || u.id, u.id]));
        const uid = emailToId.get(curatorEmail);
        if (uid) assignedIds = [uid];
      }

      try {
        const payload: Record<string, unknown> = {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        await this.plugin.client.createTask(payload as any);
        new Notice('Документ создан');
        this.syncAndRender();
      } catch (e) {
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

    const titleInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Введите наименование документа' } });
    titleInput.style.width = '100%';
    titleInput.style.boxSizing = 'border-box';

    const curatorLabel = container.createEl('label', { text: 'Куратор (email)' });
    const curatorInput = container.createEl('input', { attr: { type: 'text', placeholder: 'user@example.com' } });
    curatorInput.style.width = '100%';
    curatorInput.style.boxSizing = 'border-box';

    const inheritInfo = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    if (parentDoc.deadline) {
      const d = new Date(parentDoc.deadline);
      inheritInfo.setText(`📅 Срок действия наследуется от родителя: ${d.toLocaleDateString()}`);
    } else {
      inheritInfo.setText('📅 Срок действия не задан у родителя');
    }
    inheritInfo.style.marginBottom = '8px';

    const linkLabel = container.createEl('label', { text: 'Ссылка на документ' });
    const linkTypeRow = container.createDiv({ cls: 'mailer-yougile-header' });
    linkTypeRow.style.marginBottom = '4px';
    const urlRadio = linkTypeRow.createEl('label');
    urlRadio.style.fontSize = 'var(--font-smaller)';
    urlRadio.style.display = 'inline-flex';
    urlRadio.style.alignItems = 'center';
    urlRadio.style.marginRight = '12px';
    const urlRadioBtn = urlRadio.createEl('input', { attr: { type: 'radio', name: 'linkTypeRel', value: 'url' } });
    urlRadioBtn.checked = true;
    urlRadio.append(' URL');

    const fileRadio = linkTypeRow.createEl('label');
    fileRadio.style.fontSize = 'var(--font-smaller)';
    fileRadio.style.display = 'inline-flex';
    fileRadio.style.alignItems = 'center';
    const fileRadioBtn = fileRadio.createEl('input', { attr: { type: 'radio', name: 'linkTypeRel', value: 'file' } });
    fileRadio.append(' Файл');

    const linkUrlInput = container.createEl('input', { attr: { type: 'url', placeholder: 'https://...' } });
    linkUrlInput.style.width = '100%';
    linkUrlInput.style.boxSizing = 'border-box';

    const fileInput = container.createEl('input', { attr: { type: 'file' } });
    fileInput.style.display = 'none';

    urlRadioBtn.addEventListener('change', () => {
      linkUrlInput.style.display = '';
      fileInput.style.display = 'none';
    });
    fileRadioBtn.addEventListener('change', () => {
      linkUrlInput.style.display = 'none';
      fileInput.style.display = '';
    });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderDocumentDetail(parentDoc));

    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      if (!title) { new Notice('Введите наименование документа'); return; }
      const curatorEmail = curatorInput.value.trim();
      const deadlineMs = parentDoc.deadline || Date.now() + 365 * 86400000;

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      let linkUrl = linkUrlInput.value.trim();
      let fileName = '';

      if (fileRadioBtn.checked && fileInput.files?.[0]) {
        const file = fileInput.files[0];
        try {
          const buffer = await file.arrayBuffer();
          const result = await this.plugin.client.uploadFile(buffer, file.name);
          linkUrl = result.fullUrl;
          fileName = file.name;
        } catch (e) {
          if (!isNetworkError(e)) {
            new Notice(`Ошибка загрузки: ${e instanceof Error ? e.message : String(e)}`);
            submitBtn.setText('✅ Создать');
            submitBtn.removeAttribute('disabled');
            cancelBtn.removeAttribute('disabled');
            return;
          }
        }
      } else if (urlRadioBtn.checked && linkUrl) {
        fileName = linkUrl;
      }

      if (!linkUrl) {
        new Notice('Укажите ссылку на документ или прикрепите файл');
        submitBtn.setText('✅ Создать');
        submitBtn.removeAttribute('disabled');
        cancelBtn.removeAttribute('disabled');
        return;
      }

      const description = JSON.stringify({
        type: 'document',
        parentId: parentDoc.taskId,
        link: linkUrl,
        fileName: fileName,
        curatorEmail: curatorEmail,
      }, null, 2);

      const selectedColumnId = parentDoc.docTypeId;

      let assignedIds: string[] = [];
      if (curatorEmail) {
        const users = this.plugin.db.getUsers();
        const emailToId = new Map(users.map(u => [u.email || u.name || u.id, u.id]));
        const uid = emailToId.get(curatorEmail);
        if (uid) assignedIds = [uid];
      }

      try {
        const payload: Record<string, unknown> = {
          title,
          description,
          columnId: selectedColumnId || undefined,
          assigned: assignedIds.length > 0 ? assignedIds : undefined,
          deadline: { deadline: deadlineMs, withTime: true },
        };
        await this.plugin.client.createTask(payload as any);
        new Notice('Связанный документ создан');
        this.syncAndRender();
      } catch (e) {
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
    const elemInput = container.createEl('input', { attr: { type: 'text', placeholder: 'Например: 1.2.3' } });
    elemInput.style.width = '100%';
    elemInput.style.boxSizing = 'border-box';

    const curLabel = container.createEl('label', { text: 'Текущая редакция' });
    const curInput = container.createEl('textarea');
    curInput.style.width = '100%';
    curInput.style.boxSizing = 'border-box';
    curInput.style.minHeight = '50px';

    const propLabel = container.createEl('label', { text: 'Предлагаемая редакция' });
    const propInput = container.createEl('textarea');
    propInput.style.width = '100%';
    propInput.style.boxSizing = 'border-box';
    propInput.style.minHeight = '50px';

    const justLabel = container.createEl('label', { text: 'Обоснование изменений' });
    const justInput = container.createEl('textarea');
    justInput.style.width = '100%';
    justInput.style.boxSizing = 'border-box';
    justInput.style.minHeight = '50px';

    const fileLabel = container.createEl('label', { text: 'Прикрепить файл к замечанию' });
    const fileInput = container.createEl('input', { attr: { type: 'file' } });
    fileInput.style.marginBottom = '8px';

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';

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
        } catch (e) {
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
      } catch (e) {
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
    } catch (e) {
      new Notice(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
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

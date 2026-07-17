import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { ContactItem } from '../types/contacts';
import type { CreateTaskPayload } from '../types/yougile';
import QRCode from 'qrcode';

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError && e.message === 'Failed to fetch') return true;
  if (e instanceof Error && /network|fetch|offline|econnrefused|enotfound|dns|timeout/i.test(e.message)) return true;
  return false;
}

export const CONTACTS_VIEW_TYPE = 'yougile-contacts-view';

let nextContactId = 1;
function generateContactId(): number {
  return nextContactId++;
}

export class ContactsView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private createViewActive = false;
  private detailViewActive = false;
  private viewingContact: ContactItem | null = null;
  private searchQuery = '';
  private searchTimeout: number | null = null;
  private selectedColumnIds: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return CONTACTS_VIEW_TYPE; }
  getDisplayText(): string { return 'Контакты'; }
  getIcon(): string { return 'user'; }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');
    this.containerElContent = container.createDiv();
    this.selectedColumnIds = new Set(this.plugin.settings.contactSelectedColumnIds.split(',').filter(Boolean));
    await this.syncAndRender();
  }

  onClose(): void {
    // no-op
  }

  private getColumnTitle(columnId: string): string {
    const col = this.plugin.db.getColumns().find(c => c.id === columnId);
    return col ? col.title : columnId;
  }

  private getContacts(filter?: boolean): ContactItem[] {
    let contacts = this.plugin.contactDb.getAllContacts();
    if (filter) {
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        contacts = contacts.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.organization.toLowerCase().includes(q)
        );
      }
      if (this.selectedColumnIds.size > 0) {
        contacts = contacts.filter(c => this.selectedColumnIds.has(c.orgType));
      }
    }
    return contacts;
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();
    this.createViewActive = false;
    this.detailViewActive = false;
    this.viewingContact = null;

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '👤 Контакты' });
    const refreshBtn = header.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());
    const createBtn = header.createEl('button', { text: '➕ Новый контакт', cls: 'mailer-yougile-refresh-btn' });
    createBtn.addEventListener('click', () => this.showCreateForm());

    const syncStatus = container.createDiv({ cls: 'mailer-yougile-task-meta', text: this.plugin.db.hasUnsynchronizedActions() ? '⚠ Не синхронизировано' : '✅ Синхронизировано' });

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по имени, телефону, email...' } });
    searchInput.addClass('mailer-input');
    searchInput.addClass('mailer-mb-8');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => this.renderView(), 300);
    });

    const contactBoardId = this.plugin.settings.contactBoardId;
    const columns = this.plugin.db.getColumns().filter(c => !contactBoardId || c.boardId === contactBoardId);
    if (columns.length > 0) {
      const filterDiv = container.createDiv({ cls: 'mailer-mb-8' });
      filterDiv.createDiv({ text: 'Тип организации:', cls: 'mailer-yougile-task-meta' });
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
          this.plugin.settings.contactSelectedColumnIds = Array.from(this.selectedColumnIds).join(',');
          this.plugin.saveSettings();
          this.renderView();
        });
      }
    }

    let contacts = this.getContacts(true);
    if (contacts.length === 0) {
      container.createDiv({ text: 'Нет контактов', cls: 'mailer-yougile-empty' });
      return;
    }

    const table = container.createEl('table');
    table.addClass('mailer-table');

    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    const headers = ['Имя', 'Телефон', 'Email', 'Организация', 'Должность', 'Тип организации'];
    for (const h of headers) {
      const th = headRow.createEl('th');
      th.setText(h);
      th.addClass('mailer-th');
    }

    const tbody = table.createEl('tbody');
    for (const c of contacts) {
      const row = tbody.createEl('tr');
      row.addClass('mailer-clickable');
      row.addEventListener('click', () => this.showDetailView(c));
      const cells = [c.name, c.phone, c.email, c.organization, c.position, this.getColumnTitle(c.orgType)];
      for (const cell of cells) {
        const td = row.createEl('td');
        td.setText(cell);
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

    container.createEl('h3', { text: 'Новый контакт' });

    const typeLabel = container.createEl('label', { text: 'Тип организации' });
    const typeSelect = container.createEl('select');
    typeSelect.addClass('mailer-select');
    const boardCols = this.plugin.db.getColumns().filter(c => c.boardId === this.plugin.settings.contactBoardId);
    for (const col of boardCols) {
      typeSelect.createEl('option', { value: col.id, text: col.title });
    }

    const fields: Array<{ label: string; key: keyof ContactItem; placeholder: string }> = [
      { label: 'Имя', key: 'name', placeholder: 'ФИО' },
      { label: 'Телефон', key: 'phone', placeholder: '+7 (999) 123-45-67' },
      { label: 'Email', key: 'email', placeholder: 'email@example.com' },
      { label: 'Организация', key: 'organization', placeholder: 'Название организации' },
      { label: 'Должность', key: 'position', placeholder: 'Должность' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};
    for (const f of fields) {
      const label = container.createEl('label', { text: f.label });
      const inp = container.createEl('input', { attr: { type: 'text', placeholder: f.placeholder } });
      inp.addClass('mailer-input');
      inputs[f.key] = inp;
    }

    const notesLabel = container.createEl('label', { text: 'Примечание' });
    const notesInput = container.createEl('textarea');
    notesInput.addClass('mailer-textarea');

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.addClass('mailer-mt-12');
    const submitBtn = btnRow.createEl('button', { text: '✅ Создать', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.renderView());

    submitBtn.addEventListener('click', async () => {
      const name = inputs.name.value.trim();
      if (!name) { new Notice('Введите имя контакта'); return; }

      submitBtn.setText('⏳');
      submitBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const now = new Date().toISOString();
      const orgType = typeSelect.value;
      const contact: ContactItem = {
        id: generateContactId(),
        name,
        phone: inputs.phone.value.trim(),
        email: inputs.email.value.trim(),
        organization: inputs.organization.value.trim(),
        position: inputs.position.value.trim(),
        orgType,
        notes: notesInput.value.trim(),
        createdAt: now,
        updatedAt: now,
        sync_status: 'local',
      };

      const description = JSON.stringify({
        type: 'contact',
        contactId: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        organization: contact.organization,
        position: contact.position,
        orgType: contact.orgType,
        notes: contact.notes,
      }, null, 2);

      try {
        const columnId = typeSelect.value || '';
        const result = await this.plugin.client.createTask({
          title: name,
          description,
          columnId: columnId || undefined,
          completed: true,
        } as CreateTaskPayload);
        contact.taskId = result.id;
        contact.sync_status = 'synced';
        this.plugin.contactDb.addContact(contact);
        new Notice('Контакт создан');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.contactDb.addContact(contact);
          this.plugin.db.addToOfflineQueue({
            type: 'create-task',
            payload: {
              title: name,
              description,
              columnId: typeSelect.value || undefined,
              completed: true,
            },
          });
          new Notice('Нет соединения. Контакт сохранён локально, будет синхронизирован позже.');
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

  private showDetailView(contact: ContactItem): void {
    this.detailViewActive = true;
    this.viewingContact = contact;
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `👤 ${contact.name}` });

    const editBtn = container.createEl('button', { text: '✏️ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    editBtn.addClass('mailer-mb-8');
    editBtn.addEventListener('click', () => this.showEditForm(contact));

    const detailContainer = container.createDiv();
    detailContainer.addClass('mailer-detail-text');

    const fields: Array<{ label: string; value: string }> = [
      { label: 'Телефон', value: contact.phone },
      { label: 'Email', value: contact.email },
      { label: 'Организация', value: contact.organization },
      { label: 'Должность', value: contact.position },
      { label: 'Тип организации', value: this.getColumnTitle(contact.orgType) },
      { label: 'Примечание', value: contact.notes },
    ];
    for (const f of fields) {
      if (!f.value) continue;
      const row = detailContainer.createDiv({ cls: 'mailer-yougile-header' });
      row.addClass('mailer-detail-row');
      const label = row.createEl('strong');
      label.setText(`${f.label}: `);
      row.createSpan({ text: f.value });
    }

    // QR code
    const qrContainer = container.createDiv();
    qrContainer.addClass('mailer-text-center', 'mailer-mt-12');
    const qrLabel = qrContainer.createEl('label', { text: 'QR-код контакта' });
    qrLabel.style.cssText = 'display:block;font-weight:bold';
    qrLabel.addClass('mailer-mb-8');
    const qrCanvas = qrContainer.createEl('canvas', { attr: { width: 250, height: 250 } });
    qrCanvas.style.cssText = 'width:250px;height:250px;margin:0 auto';

    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${contact.name}`,
      `TEL:${contact.phone}`,
      `EMAIL:${contact.email}`,
      `ORG:${contact.organization}`,
      `TITLE:${contact.position}`,
      `NOTE:${contact.notes}`,
      'END:VCARD',
    ].join('\n');

    QRCode.toCanvas(qrCanvas, vcard, {
      width: 250,
      margin: 2,
      color: {
        dark: '#FF0000',
        light: '#FFFFFF',
      },
    }).catch(() => {
      // silent
    });
  }

  private showEditForm(contact: ContactItem): void {
    this.detailViewActive = true;
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `✏️ ${contact.name}` });

    const typeLabel = container.createEl('label', { text: 'Тип организации' });
    const typeSelect = container.createEl('select');
    typeSelect.addClass('mailer-select');
    const boardCols = this.plugin.db.getColumns().filter(c => c.boardId === this.plugin.settings.contactBoardId);
    for (const col of boardCols) {
      const opt = typeSelect.createEl('option', { value: col.id, text: col.title });
      if (col.id === contact.orgType) opt.selected = true;
    }

    const fields: Array<{ label: string; key: keyof ContactItem; placeholder: string }> = [
      { label: 'Имя', key: 'name', placeholder: 'ФИО' },
      { label: 'Телефон', key: 'phone', placeholder: '+7 (999) 123-45-67' },
      { label: 'Email', key: 'email', placeholder: 'email@example.com' },
      { label: 'Организация', key: 'organization', placeholder: 'Название организации' },
      { label: 'Должность', key: 'position', placeholder: 'Должность' },
    ];

    const inputs: Record<string, HTMLInputElement> = {};
    const prefill: Record<string, string> = {
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      organization: contact.organization,
      position: contact.position,
    };

    for (const f of fields) {
      const label = container.createEl('label', { text: f.label });
      const inp = container.createEl('input', { attr: { type: 'text', placeholder: f.placeholder } });
      inp.addClass('mailer-input');
      inp.value = prefill[f.key] || '';
      inputs[f.key] = inp;
    }

    const notesLabel = container.createEl('label', { text: 'Примечание' });
    const notesInput = container.createEl('textarea');
    notesInput.addClass('mailer-textarea');
    notesInput.value = contact.notes;

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.addClass('mailer-mt-12');
    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.showDetailView(contact));

    saveBtn.addEventListener('click', async () => {
      const name = inputs.name.value.trim();
      if (!name) { new Notice('Введите имя контакта'); return; }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const orgType = typeSelect.value;
      const now = new Date().toISOString();
      const updated: Partial<ContactItem> = {
        name,
        phone: inputs.phone.value.trim(),
        email: inputs.email.value.trim(),
        organization: inputs.organization.value.trim(),
        position: inputs.position.value.trim(),
        orgType,
        notes: notesInput.value.trim(),
        updatedAt: now,
      };
      const description = JSON.stringify({
        type: 'contact',
        contactId: contact.id,
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        organization: updated.organization,
        position: updated.position,
        orgType,
        notes: updated.notes,
      }, null, 2);

      try {
        if (contact.taskId) {
          await this.plugin.client.updateTaskRaw(contact.taskId, {
            title: name,
            description,
            columnId: typeSelect.value || undefined,
          });
        }
        this.plugin.contactDb.updateContact(contact.id, updated);
        new Notice('Контакт обновлён');
        this.syncAndRender();
      } catch (e: unknown) {
        if (isNetworkError(e)) {
          this.plugin.contactDb.updateContact(contact.id, updated);
          if (contact.taskId) {
            this.plugin.db.addToOfflineQueue({
              type: 'update-task',
              payload: {
                id: contact.taskId,
                title: name,
                description,
                columnId: typeSelect.value || undefined,
              },
            });
          }
          new Notice('Нет соединения. Изменения сохранены локально.');
          this.syncAndRender();
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
    try {
      await this.plugin.db.sync();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`YouGile: Ошибка синхронизации — ${msg}`);
    }
    this.plugin.contactDb.syncFromTasks(this.plugin.db.getTasks());
    this.selectedColumnIds = new Set(this.plugin.settings.contactSelectedColumnIds.split(',').filter(Boolean));
    this.renderView();
  }
}

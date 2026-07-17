import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { ContactItem } from '../types/contacts';
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
    await this.syncAndRender();
  }

  onClose(): void {
    // no-op
  }

  private getContacts(): ContactItem[] {
    return this.plugin.contactDb.getAllContacts();
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

    const contacts = this.getContacts();
    if (contacts.length === 0) {
      container.createDiv({ text: 'Нет контактов', cls: 'mailer-yougile-empty' });
      return;
    }

    const table = container.createEl('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:var(--font-smaller)';

    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    const headers = ['Имя', 'Телефон', 'Email', 'Организация', 'Должность'];
    for (const h of headers) {
      const th = headRow.createEl('th');
      th.setText(h);
      th.style.cssText = 'text-align:left;padding:4px 8px;border-bottom:2px solid var(--background-modifier-border);white-space:nowrap';
    }

    const tbody = table.createEl('tbody');
    for (const c of contacts) {
      const row = tbody.createEl('tr');
      row.style.cssText = 'cursor:pointer';
      row.addEventListener('click', () => this.showDetailView(c));
      const cells = [c.name, c.phone, c.email, c.organization, c.position];
      for (const cell of cells) {
        const td = row.createEl('td');
        td.setText(cell);
        td.style.cssText = 'padding:4px 8px;border-bottom:1px solid var(--background-modifier-border)';
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
    typeSelect.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px';
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
      inp.style.cssText = 'width:100%;box-sizing:border-box';
      inputs[f.key] = inp;
    }

    const notesLabel = container.createEl('label', { text: 'Примечание' });
    const notesInput = container.createEl('textarea');
    notesInput.style.cssText = 'width:100%;box-sizing:border-box;min-height:60px';

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';
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
      const contact: ContactItem = {
        id: generateContactId(),
        name,
        phone: inputs.phone.value.trim(),
        email: inputs.email.value.trim(),
        organization: inputs.organization.value.trim(),
        position: inputs.position.value.trim(),
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
        notes: contact.notes,
      }, null, 2);

      try {
        const columnId = typeSelect.value || '';
        const result = await this.plugin.client.createTask({
          title: name,
          description,
          columnId: columnId || undefined,
          completed: true,
        });
        contact.taskId = result.id;
        contact.sync_status = 'synced';
        this.plugin.contactDb.addContact(contact);
        new Notice('Контакт создан');
        this.syncAndRender();
      } catch (e) {
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
    editBtn.style.marginBottom = '12px';
    editBtn.addEventListener('click', () => this.showEditForm(contact));

    const detailContainer = container.createDiv();
    detailContainer.style.cssText = 'font-size:var(--font-smaller);line-height:1.6';

    const fields: Array<{ label: string; value: string }> = [
      { label: 'Телефон', value: contact.phone },
      { label: 'Email', value: contact.email },
      { label: 'Организация', value: contact.organization },
      { label: 'Должность', value: contact.position },
      { label: 'Примечание', value: contact.notes },
    ];
    for (const f of fields) {
      if (!f.value) continue;
      const row = detailContainer.createDiv({ cls: 'mailer-yougile-header' });
      row.style.cssText = 'padding:2px 0';
      const label = row.createEl('strong');
      label.setText(`${f.label}: `);
      row.createSpan({ text: f.value });
    }

    // QR code
    const qrContainer = container.createDiv();
    qrContainer.style.cssText = 'margin-top:16px;text-align:center';
    const qrLabel = qrContainer.createEl('label', { text: 'QR-код контакта' });
    qrLabel.style.cssText = 'display:block;margin-bottom:8px;font-weight:bold';
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
    } as any).catch(() => {
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
    typeSelect.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px';
    const boardCols = this.plugin.db.getColumns().filter(c => c.boardId === this.plugin.settings.contactBoardId);
    const currentCol = this.plugin.db.getTasks().find(t => t.id === contact.taskId)?.columnId;
    for (const col of boardCols) {
      const opt = typeSelect.createEl('option', { value: col.id, text: col.title });
      if (col.id === currentCol) opt.selected = true;
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
      inp.style.cssText = 'width:100%;box-sizing:border-box';
      inp.value = prefill[f.key] || '';
      inputs[f.key] = inp;
    }

    const notesLabel = container.createEl('label', { text: 'Примечание' });
    const notesInput = container.createEl('textarea');
    notesInput.style.cssText = 'width:100%;box-sizing:border-box;min-height:60px';
    notesInput.value = contact.notes;

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header' });
    btnRow.style.marginTop = '12px';
    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.showDetailView(contact));

    saveBtn.addEventListener('click', async () => {
      const name = inputs.name.value.trim();
      if (!name) { new Notice('Введите имя контакта'); return; }

      saveBtn.setText('⏳');
      saveBtn.setAttr('disabled', 'true');
      cancelBtn.setAttr('disabled', 'true');

      const now = new Date().toISOString();
      const updated: Partial<ContactItem> = {
        name,
        phone: inputs.phone.value.trim(),
        email: inputs.email.value.trim(),
        organization: inputs.organization.value.trim(),
        position: inputs.position.value.trim(),
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
      } catch (e) {
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
    this.renderView();
  }
}

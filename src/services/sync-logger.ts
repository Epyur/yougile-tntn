import { App, Modal, Setting, ButtonComponent, TextComponent } from 'obsidian';

export interface SyncLogEntry {
  timestamp: string;
  module: string;
  direction: 'to-yougile' | 'from-yougile' | 'local';
  action: string;
  itemId: string;
  itemTitle?: string;
  status: 'success' | 'error' | 'skipped';
  details?: string;
  error?: string;
}

interface SyncLogData {
  entries: SyncLogEntry[];
}

const LOG_PATH = 'yourbase/sync_log.json';
const MAX_ENTRIES = 2000;

export class SyncLogger {
  private app: App;
  private data: SyncLogData = { entries: [] };
  private initialized = false;

  constructor(app: App) {
    this.app = app;
  }

  async init(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(LOG_PATH);
      if (exists) {
        const content = await adapter.read(LOG_PATH);
        const parsed = JSON.parse(content);
        this.data = {
          entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        };
      }
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  async log(entry: Omit<SyncLogEntry, 'timestamp'>): Promise<void> {
    const fullEntry: SyncLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.data.entries.unshift(fullEntry);
    if (this.data.entries.length > MAX_ENTRIES) {
      this.data.entries = this.data.entries.slice(0, MAX_ENTRIES);
    }
    await this.save();
  }

  getAll(): SyncLogEntry[] {
    return this.data.entries;
  }

  async clear(): Promise<void> {
    this.data.entries = [];
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.initialized) return;
    try {
      await this.app.vault.adapter.write(LOG_PATH, JSON.stringify(this.data, null, 2));
    } catch {
      console.error('YouGile: failed to save sync log');
    }
  }
}

export class SyncLogModal extends Modal {
  private logger: SyncLogger;
  private filterModule = '';
  private filterDirection = '';
  private filterStatus = '';

  constructor(app: App, logger: SyncLogger) {
    super(app);
    this.logger = logger;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '📋 Журнал синхронизации' });

    const all = this.logger.getAll();
    const filtered = all.filter(e => {
      if (this.filterModule && e.module !== this.filterModule) return false;
      if (this.filterDirection && e.direction !== this.filterDirection) return false;
      if (this.filterStatus && e.status !== this.filterStatus) return false;
      return true;
    });

    const filterRow = contentEl.createDiv({ cls: 'mailer-filter-row' });
    filterRow.style.display = 'flex';
    filterRow.style.gap = '8px';
    filterRow.style.marginBottom = '12px';
    filterRow.style.flexWrap = 'wrap';
    filterRow.style.alignItems = 'center';

    const modules = [...new Set(all.map(e => e.module))].sort();
    const moduleSel = filterRow.createEl('select');
    moduleSel.createEl('option', { text: 'Все модули', value: '' });
    for (const m of modules) {
      moduleSel.createEl('option', { text: m, value: m });
    }
    moduleSel.value = this.filterModule;
    moduleSel.addEventListener('change', () => {
      this.filterModule = moduleSel.value;
      this.render();
    });

    const dirSel = filterRow.createEl('select');
    dirSel.createEl('option', { text: 'Все направления', value: '' });
    dirSel.createEl('option', { text: '→ YouGile', value: 'to-yougile' });
    dirSel.createEl('option', { text: '← YouGile', value: 'from-yougile' });
    dirSel.createEl('option', { text: 'Локально', value: 'local' });
    dirSel.value = this.filterDirection;
    dirSel.addEventListener('change', () => {
      this.filterDirection = dirSel.value;
      this.render();
    });

    const statusSel = filterRow.createEl('select');
    statusSel.createEl('option', { text: 'Все статусы', value: '' });
    statusSel.createEl('option', { text: '✅ Успех', value: 'success' });
    statusSel.createEl('option', { text: '❌ Ошибка', value: 'error' });
    statusSel.createEl('option', { text: '⏭ Пропущено', value: 'skipped' });
    statusSel.value = this.filterStatus;
    statusSel.addEventListener('change', () => {
      this.filterStatus = statusSel.value;
      this.render();
    });

    const clearBtn = filterRow.createEl('button', { text: '🗑 Очистить журнал' });
    clearBtn.style.marginLeft = 'auto';
    clearBtn.addEventListener('click', async () => {
      await this.logger.clear();
      this.render();
    });

    const info = contentEl.createDiv();
    info.style.marginBottom = '8px';
    info.style.color = 'var(--text-muted)';
    info.style.fontSize = '12px';
    info.textContent = `Всего записей: ${all.length} | Отфильтровано: ${filtered.length}`;

    if (filtered.length === 0) {
      contentEl.createEl('p', { text: 'Нет записей синхронизации.' });
      return;
    }

    const table = contentEl.createEl('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '11px';

    const thead = table.createEl('thead');
    const hr = thead.createEl('tr');
    for (const h of ['Время', 'Модуль', 'Напр.', 'Действие', 'ID', 'Название', 'Статус', 'Детали']) {
      hr.createEl('th', { text: h }).style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:4px 6px;text-align:left;white-space:nowrap;';
    }

    const tbody = table.createEl('tbody');
    for (const entry of filtered) {
      const row = tbody.createEl('tr');
      const timeStr = new Date(entry.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const dirLabel = entry.direction === 'to-yougile' ? '↑' : entry.direction === 'from-yougile' ? '↓' : '↻';
      const statusLabel = entry.status === 'success' ? '✅' : entry.status === 'error' ? '❌' : '⏭';

      row.createEl('td', { text: timeStr }).style.cssText = 'padding:2px 6px;white-space:nowrap;';
      row.createEl('td', { text: entry.module }).style.cssText = 'padding:2px 6px;white-space:nowrap;';
      const dirTd = row.createEl('td');
      dirTd.textContent = dirLabel;
      dirTd.style.cssText = 'padding:2px 6px;text-align:center;';
      dirTd.title = entry.direction === 'to-yougile' ? 'В YouGile' : entry.direction === 'from-yougile' ? 'Из YouGile' : 'Локально';
      row.createEl('td', { text: entry.action }).style.cssText = 'padding:2px 6px;white-space:nowrap;';
      row.createEl('td', { text: entry.itemId }).style.cssText = 'padding:2px 6px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;';
      row.createEl('td', { text: entry.itemTitle || '' }).style.cssText = 'padding:2px 6px;max-width:200px;overflow:hidden;text-overflow:ellipsis;';
      row.createEl('td', { text: statusLabel }).style.cssText = 'padding:2px 6px;text-align:center;';
      const detailTd = row.createEl('td');
      detailTd.textContent = entry.details || entry.error || '';
      detailTd.style.cssText = 'padding:2px 6px;max-width:300px;overflow:hidden;text-overflow:ellipsis;';
      if (entry.status === 'error') {
        detailTd.style.color = 'var(--text-error)';
      }
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

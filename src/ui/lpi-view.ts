import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type YouGilePlugin from '../main';
import type { LpiItem } from '../types/lpi';
import { DEFAULT_CONFIG, type LpiViewConfig } from '../types/lpi-config';
import { LpiSchemaService } from '../services/lpi-schema-service';
import { LpiSchemaModal } from './lpi-schema-modal';
import { LpiSync } from './lpi-sync';
import { LpiDashboard } from './lpi-dashboard';
import { LpiDetail } from './lpi-detail';
import { YougileSyncModal } from './lpi-modals';
import { isCompleted, statusDisplay, getProtocolDate, getMethodDisplayName } from './lpi-utils';
import fs from 'fs';

const CONFIG_PATH = 'yourbase/lpi_view_config.json';

export const LPI_VIEW_TYPE = 'yougile-lpi-view';

type ViewMode = 'table' | 'dashboard';

export class LpiView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  items: LpiItem[] = [];
  private searchQuery = '';
  private searchTimeout: number | null = null;
  viewConfig: LpiViewConfig = DEFAULT_CONFIG;
  schemaService = new LpiSchemaService();
  sync: LpiSync;
  private dashboard: LpiDashboard;
  private detail: LpiDetail;
  private mode: ViewMode = 'table';
  selectedProducts: Set<string> = new Set();
  selectedMethods: Set<string> = new Set();
  appDateFrom = '';
  appDateTo = '';
  protocolDateFrom = '';
  protocolDateTo = '';
  serialOnly = false;
  experimentalOnly = false;

  // Table filters
  private tableDateFrom = '';
  private tableDateTo = '';
  private tableStatusFilter = 'all';

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.sync = new LpiSync(this);
    this.dashboard = new LpiDashboard(this);
    this.detail = new LpiDetail(this);
  }

  getViewType(): string {
    return LPI_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Лаборатория пожарных испытаний';
  }

  getIcon(): string {
    return 'flame';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');
    this.containerElContent = container.createDiv();
    this.items = await this.sync.loadData();
    await this.loadViewConfig();
    // Ensure reference data (projects, boards, columns) is loaded
    try { await this.plugin.db.sync(); } catch {}
    const syncResult = await this.sync.syncFromTasks(this.items);
    console.log(`YouGile LPI onOpen: hasChanges=${syncResult.hasChanges}, items=${this.items.length}`);
    if (syncResult.hasChanges) {
      this.items = syncResult.items;
      await this.saveData();
      console.log(`YouGile LPI saved: items=${this.items.length}, with taskId=${this.items.filter(i => i.taskId).length}`);
    }
    this.renderView();
  }

  async saveData(): Promise<void> {
    await this.sync.saveData(this.items);
  }

  async loadViewConfig(): Promise<void> {
    try {
      if (this.plugin.settings.lpiViewConfigSource === 'default') {
        this.viewConfig = DEFAULT_CONFIG;
        return;
      }
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(CONFIG_PATH);
      if (exists) {
        const content = await adapter.read(CONFIG_PATH);
        const parsed = JSON.parse(content) as LpiViewConfig;
        this.viewConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          loadQuery: DEFAULT_CONFIG.loadQuery,
          detailSections: parsed.detailSections || DEFAULT_CONFIG.detailSections,
          colorRules: parsed.colorRules || DEFAULT_CONFIG.colorRules,
        };
      } else {
        this.viewConfig = DEFAULT_CONFIG;
        await adapter.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      }
    } catch {
      this.viewConfig = DEFAULT_CONFIG;
    }
  }

  applyFilters(items: LpiItem[]): LpiItem[] {
    let filtered = items;
    if (this.selectedProducts.size > 0) {
      filtered = filtered.filter(item => this.selectedProducts.has(item.product_name));
    }
    if (this.appDateFrom) {
      filtered = filtered.filter(item => item.application_created_at >= this.appDateFrom);
    }
    if (this.appDateTo) {
      filtered = filtered.filter(item => item.application_created_at <= this.appDateTo);
    }
    if (this.protocolDateFrom) {
      filtered = filtered.filter(item => item.protocol_date && item.protocol_date >= this.protocolDateFrom);
    }
    if (this.protocolDateTo) {
      filtered = filtered.filter(item => item.protocol_date && item.protocol_date <= this.protocolDateTo);
    }
    if (this.serialOnly) {
      filtered = filtered.filter(item => item.ekn && /^\d+$/.test(item.ekn));
    }
    if (this.experimentalOnly) {
      filtered = filtered.filter(item => !item.ekn || !/^\d+$/.test(item.ekn));
    }
    if (this.selectedMethods.size > 0) {
      filtered = filtered.filter(item => item.method_abbreviation && this.selectedMethods.has(item.method_abbreviation));
    }
    return filtered;
  }

  buildFullJson(item: LpiItem): Record<string, unknown> {
    return {
      type: 'lpi_data',
      aggregate_id: item.aggregate_id,
      application_external_id: item.application_external_id,
      application_created_at: item.application_created_at,
      product_name: item.product_name,
      protocol_date: item.protocol_date,
      agg_gen_group_complience: item.agg_gen_group_complience,
      customer_name: item.customer_name,
      customer_mail: item.customer_mail,
      organization: item.organization,
      customer_phone: item.customer_phone,
      customer_address: item.customer_address,
      ekn: item.ekn,
      thickness: item.thickness,
      color: item.color,
      batch_number: item.batch_number,
      sample_number: item.sample_number,
      object_name: item.object_name,
      standard: item.standard,
      target_comb_group: item.target_comb_group,
      target_flam_group: item.target_flam_group,
      target_prop_group: item.target_prop_group,
      method_abbreviation: item.method_abbreviation,
      method_name: item.method_name,
      method_standard: item.method_standard,
      agg_avg_smog_temp: item.agg_avg_smog_temp,
      agg_smog_group: item.agg_smog_group,
      agg_smog_complience: item.agg_smog_complience,
      agg_mass_loss: item.agg_mass_loss,
      agg_comb_time: item.agg_comb_time,
      agg_dam_length: item.agg_dam_length,
      agg_comb_bulb: item.agg_comb_bulb,
      agg_group_by_mass: item.agg_group_by_mass,
      agg_group_by_length: item.agg_group_by_length,
      agg_croup_by_comb_time: item.agg_croup_by_comb_time,
      agg_group_by_bulbe: item.agg_group_by_bulbe,
      agg_gen_group: item.agg_gen_group,
      agg_mass_complience: item.agg_mass_complience,
      agg_complience_by_length: item.agg_complience_by_length,
      agg_complience_by_comb_time: item.agg_complience_by_comb_time,
      agg_complience_by_bulbe: item.agg_complience_by_bulbe,
      agg_additional_info_1: item.agg_additional_info_1,
      updated_at: item.updatedAt,
      updated_by: item.updatedBy,
    };
  }

  getLpiColumnId(): string | undefined {
    const cols = this.plugin.db.getColumns();
    const boardId = this.plugin.settings.lpiBoardId;
    const colTitle = this.plugin.settings.lpiColumnTitle;
    if (boardId && colTitle) {
      const match = cols.find(c => c.boardId === boardId && c.title === colTitle);
      if (match) return match.id;
    }
    return undefined;
  }

  getLpiProjectId(): string | undefined {
    const projects = this.plugin.db.getProjects();
    const projectTitle = this.plugin.settings.lpiProjectId;
    if (projectTitle) {
      const match = projects.find(p => p.title === projectTitle || p.id === projectTitle);
      if (match) return match.id;
    }
    return undefined;
  }

  renderView(): void {
    const container = this.containerElContent;
    this.dashboard.destroy();
    container.empty();

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '🧪 Лаборатория пожарных испытаний' });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mb-8' });
    const tableBtn = btnRow.createEl('button', {
      text: '📋 Таблица',
      cls: 'mailer-yougile-refresh-btn',
    });
    tableBtn.addEventListener('click', () => { this.mode = 'table'; this.renderView(); });

    const sqlConnected = !!this.plugin.settings.lpiDbPath && fs.existsSync(this.plugin.settings.lpiDbPath);

    const sqlBtn = btnRow.createEl('button', {
      text: '📥 SQL → Локально',
      cls: 'mailer-yougile-refresh-btn',
    });
    sqlBtn.title = 'Загрузить только новые заявки из SQL (отсутствующие в плагине и YouGile)';
    sqlBtn.addEventListener('click', async () => {
      if (!sqlConnected) {
        new Notice('Укажите путь к SQLite БД в настройках LPI');
        return;
      }
      sqlBtn.disabled = true;
      sqlBtn.textContent = '⏳ Загрузка...';
      try {
        const result = await this.sync.loadNewFromSqlite(this.items);
        if (result.added > 0) {
          this.items = result.items;
          await this.saveData();
          new Notice(`LPI: добавлено ${result.added} новых заявок из SQL`);
        } else {
          new Notice('Новых заявок не найдено');
        }
      } catch (e: any) {
        new Notice('Ошибка: ' + e.message);
      }
      sqlBtn.disabled = false;
      sqlBtn.textContent = '📥 SQL → Локально';
      this.renderView();
    });

    const syncBtn = btnRow.createEl('button', {
      text: '🔄 Синхронизация YouGile',
      cls: 'mailer-yougile-refresh-btn',
    });
    syncBtn.addEventListener('click', async () => {
      if (!sqlConnected) {
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ Загрузка из YouGile...';
        const result = await this.sync.syncFromTasks(this.items);
        if (result.hasChanges) {
          this.items = result.items;
          await this.saveData();
        }
        this.renderView();
        new Notice('Данные загружены из YouGile');
      } else {
        new YougileSyncModal(this.app, this.plugin, this).open();
      }
    });

    const dashBtn = btnRow.createEl('button', {
      text: '📊 Дашборд',
      cls: 'mailer-yougile-refresh-btn',
    });
    dashBtn.addEventListener('click', () => { this.mode = 'dashboard'; this.renderView(); });

    const schemaBtn = btnRow.createEl('button', {
      text: '📐 Схема БД',
      cls: 'mailer-yougile-refresh-btn',
    });
    schemaBtn.addEventListener('click', () => {
      const dbPath = this.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
      if (!dbPath || !fs.existsSync(dbPath)) {
        new Notice('Укажите путь к SQLite БД в настройках LPI');
        return;
      }
      new LpiSchemaModal(this.app, this.schemaService, dbPath).open();
    });

    if (this.mode === 'dashboard') {
      this.dashboard.render(container, this.items);
    } else {
      this.renderTable(container);
    }
  }

  private renderTable(container: HTMLElement): void {
    // Search
    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по № заявки, названию материала...' } });
    searchInput.addClass('mailer-mb-8');
    searchInput.value = this.searchQuery;
    const searchHandler = () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => { this.renderView(); }, 100);
    };
    searchInput.addEventListener('input', searchHandler);
    searchInput.addEventListener('keyup', searchHandler);
    if (this.searchQuery) searchInput.focus();

    // Filter row
    const filterRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap mailer-mb-8' });
    filterRow.style.alignItems = 'end';
    filterRow.style.gap = '8px';

    const addDateFilter = (label: string, value: string, onChange: (v: string) => void) => {
      const group = filterRow.createDiv();
      const lbl = group.createEl('label');
      lbl.setText(label);
      lbl.style.fontSize = 'var(--font-smaller)';
      lbl.style.marginRight = '4px';
      const inp = group.createEl('input', { attr: { type: 'date' } });
      inp.style.fontSize = 'var(--font-smaller)';
      inp.style.padding = '2px 4px';
      inp.value = value;
      inp.addEventListener('change', () => { onChange(inp.value); this.renderView(); });
      return inp;
    };
    addDateFilter('Дата создания с', this.tableDateFrom, v => this.tableDateFrom = v);
    addDateFilter('по', this.tableDateTo, v => this.tableDateTo = v);

    const statusGroup = filterRow.createDiv();
    const statusLabel = statusGroup.createEl('label');
    statusLabel.setText('Статус');
    statusLabel.style.fontSize = 'var(--font-smaller)';
    statusLabel.style.marginRight = '4px';
    const statusSelect = statusGroup.createEl('select');
    statusSelect.style.fontSize = 'var(--font-smaller)';
    statusSelect.style.padding = '2px 4px';
    statusSelect.createEl('option', { text: 'Все', value: 'all' });
    statusSelect.createEl('option', { text: 'Активные', value: 'active' });
    statusSelect.createEl('option', { text: 'Завершённые', value: 'completed' });
    statusSelect.value = this.tableStatusFilter;
    statusSelect.addEventListener('change', () => { this.tableStatusFilter = statusSelect.value; this.renderView(); });

    const q = this.searchQuery.trim().toLowerCase();
    let filtered = this.items;
    if (q) {
      filtered = filtered.filter(item =>
        (item.application_external_id || '').toLowerCase().includes(q) ||
        (item.product_name || '').toLowerCase().includes(q)
      );
    }

    // Apply table date filters
    if (this.tableDateFrom) {
      filtered = filtered.filter(item => item.application_created_at >= this.tableDateFrom);
    }
    if (this.tableDateTo) {
      filtered = filtered.filter(item => item.application_created_at <= this.tableDateTo);
    }

    // Apply table status filter
    if (this.tableStatusFilter === 'active') {
      filtered = filtered.filter(item => !isCompleted(item));
    } else if (this.tableStatusFilter === 'completed') {
      filtered = filtered.filter(item => isCompleted(item));
    }

    filtered.sort((a, b) => {
      const idA = a.application_external_id || '';
      const idB = b.application_external_id || '';
      const numA = parseInt(idA, 10);
      const numB = parseInt(idB, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
      return idB.localeCompare(idA);
    });

    const table = container.createEl('table', { cls: 'mailer-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    const headers = ['', '№ заявки', 'Название материала', 'Дата создания', 'Статус', 'Дата протокола', 'Результат испытания', 'Оценка соответствия', 'Действия'];
    for (const h of headers) {
      const th = headerRow.createEl('th', { cls: 'mailer-th' });
      th.setText(h);
    }

    const tbody = table.createEl('tbody');
    if (filtered.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td', { cls: 'mailer-text-center mailer-p-24' });
      td.setAttr('colspan', '9');
      td.setText('Нет данных');
      return;
    }

    const sqlConnected = !!this.plugin.settings.lpiDbPath && fs.existsSync(this.plugin.settings.lpiDbPath);

    for (const item of filtered) {
      const row = tbody.createEl('tr', { cls: 'mailer-clickable mailer-row-hover' });
      const rowClick = () => { this.detail.render(this.containerElContent, item); };
      row.addEventListener('click', rowClick);
      const dotCell = row.createEl('td', { cls: 'mailer-td' });
      dotCell.style.width = '24px';
      dotCell.style.textAlign = 'center';
      const dot = dotCell.createEl('span');
      dot.style.display = 'inline-block';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = item.taskId ? 'var(--text-success)' : 'var(--text-muted)';
      dot.style.flexShrink = '0';
      row.createEl('td', { cls: 'mailer-td' }).setText(item.application_external_id);
      row.createEl('td', { cls: 'mailer-td' }).setText(item.product_name);
      row.createEl('td', { cls: 'mailer-td' }).setText(item.application_created_at);
      const statusCell = row.createEl('td', { cls: 'mailer-td' });
      statusCell.style.color = isCompleted(item) ? 'var(--text-success)' : 'var(--text-warning)';
      statusCell.setText(statusDisplay(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(getProtocolDate(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group || '');
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
      const actionsCell = row.createEl('td', { cls: 'mailer-td' });
      actionsCell.style.whiteSpace = 'nowrap';

      // Sync from SQL (individual update)
      const rowSqlBtn = actionsCell.createEl('button', {
        text: '📥',
        cls: 'mailer-yougile-refresh-btn',
      });
      rowSqlBtn.title = 'Обновить данные заявки из SQLite';
      rowSqlBtn.style.fontSize = 'var(--font-smaller)';
      rowSqlBtn.style.padding = '2px 6px';
      rowSqlBtn.disabled = !sqlConnected;
      if (!sqlConnected) rowSqlBtn.title = 'Укажите путь к SQLite БД в настройках LPI';
      rowSqlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        rowSqlBtn.disabled = true;
        rowSqlBtn.textContent = '⏳';
        const ok = await this.sync.syncItemFromSqlite(item);
        if (ok) await this.saveData();
        rowSqlBtn.disabled = false;
        rowSqlBtn.textContent = '📥';
        this.renderView();
      });

      // Send to YouGile
      const rowSendBtn = actionsCell.createEl('button', {
        text: '📤',
        cls: 'mailer-yougile-refresh-btn',
      });
      rowSendBtn.title = 'Отправить в YouGile';
      rowSendBtn.style.fontSize = 'var(--font-smaller)';
      rowSendBtn.style.padding = '2px 6px';
      rowSendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!this.plugin.client) {
          new Notice('Нет подключения к YouGile');
          return;
        }
        rowSendBtn.disabled = true;
        rowSendBtn.textContent = '⏳';
        try {
          await this.sync.syncItemToYougile(item);
          await this.saveData();
          new Notice(`Заявка №${item.application_external_id} отправлена в YouGile`);
        } catch (e: any) {
          new Notice('Ошибка: ' + e.message);
        }
        rowSendBtn.disabled = false;
        rowSendBtn.textContent = '📤';
        this.renderView();
      });
    }
  }
}

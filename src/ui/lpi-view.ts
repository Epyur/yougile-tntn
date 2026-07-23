import { ItemView, WorkspaceLeaf, Modal, App, Notice, requestUrl, Setting } from 'obsidian';
import type YouGilePlugin from '../main';
import type { LpiItem } from '../types/lpi';
import { DEFAULT_CONFIG, type LpiViewConfig, type DetailSectionDef, type FieldSectionDef, type SubquerySectionDef, type ColorRuleSet } from '../types/lpi-config';
import { LpiSchemaService } from '../services/lpi-schema-service';
import { LpiSchemaModal } from './lpi-schema-modal';
import ApexCharts from 'apexcharts';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = 'yourbase/lpi_data.json';
const CONFIG_PATH = 'yourbase/lpi_view_config.json';

export const LPI_VIEW_TYPE = 'yougile-lpi-view';

type ViewMode = 'table' | 'dashboard';

export class LpiView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private items: LpiItem[] = [];
  private searchQuery = '';
  private searchTimeout: number | null = null;
  viewConfig: LpiViewConfig = DEFAULT_CONFIG;
  schemaService = new LpiSchemaService();
  private mode: ViewMode = 'table';
  private charts: ApexCharts[] = [];
  private dashboardTimer: number | null = null;
  private selectedProducts: Set<string> = new Set();
  private selectedMethods: Set<string> = new Set();
  private appDateFrom = '';
  private appDateTo = '';
  private protocolDateFrom = '';
  private protocolDateTo = '';
  private yougileTasksByExtId: Map<string, any> = new Map();
  private serialOnly = false;
  private experimentalOnly = false;

  private static METHOD_NAMES: Record<string, string> = {
    'method1': 'Группа горючести',
    'method2': 'Группа воспламеняемости',
    'method3': 'Группа распространения пламени',
    'method4': 'Кислородный индекс',
    'g56027': 'Малое пламя',
    'g56927': 'Малое пламя',
  };

  private static getMethodDisplayName(abbr: string): string {
    return LpiView.METHOD_NAMES[abbr] || abbr;
  }

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
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
    await this.loadData();
    await this.loadViewConfig();
    await this.syncFromTasks();
    this.renderView();
  }

  private async loadData(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(DB_PATH);
      if (exists) {
        const content = await this.app.vault.adapter.read(DB_PATH);
        this.items = JSON.parse(content);
      }
    } catch {
      this.items = [];
    }
  }

  private async saveData(): Promise<void> {
    try {
      await this.app.vault.adapter.write(DB_PATH, JSON.stringify(this.items, null, 2));
    } catch {}
  }

  private async syncFromTasks(): Promise<void> {
    try {
      if (!this.plugin.client) return;
      const tasks: any[] = await this.plugin.client.getTasks();
      const lpiTasks = tasks.filter((t: any) => {
        try {
          const desc = JSON.parse(t.description || '{}');
          return desc.type === 'lpi_completed' || desc.type === 'lpi_data';
        } catch { return false; }
      });
      this.yougileTasksByExtId.clear();
      for (const task of lpiTasks) {
        const desc = JSON.parse(task.description || '{}');
        if (desc.application_external_id) {
          this.yougileTasksByExtId.set(desc.application_external_id, task);
        }
      }
      let changed = false;
      let updated = 0;
      for (const task of lpiTasks) {
        const desc = JSON.parse(task.description || '{}');
        let existing = this.items.find(i => i.aggregate_id === desc.aggregate_id);
        if (!existing && desc.application_external_id) {
          existing = this.items.find(i => i.application_external_id === desc.application_external_id);
        }
        if (!existing) {
          await this.plugin.syncLogger.log({
            module: 'lpi',
            direction: 'from-yougile',
            action: 'skip',
            itemId: desc.application_external_id || desc.aggregate_id || '',
            itemTitle: task.title,
            status: 'skipped',
            details: 'Заявка не найдена в локальных данных',
          });
          continue;
        }
        if (existing.taskId && task.completed && !existing.completedLocally) {
          existing.completedLocally = true;
          existing.completedAt = desc.completedAt || '';
          changed = true;
          updated++;
          await this.plugin.syncLogger.log({
            module: 'lpi',
            direction: 'from-yougile',
            action: 'complete',
            itemId: desc.application_external_id || existing.aggregate_id,
            itemTitle: existing.product_name,
            status: 'success',
            details: 'Статус "Завершена" получен из YouGile',
          });
        }
      }
      if (changed) await this.saveData();
      if (lpiTasks.length > 0) {
        await this.plugin.syncLogger.log({
          module: 'lpi',
          direction: 'from-yougile',
          action: 'sync-complete',
          itemId: '',
          status: 'success',
          details: `Обработано задач YouGile: ${lpiTasks.length}, обновлено: ${updated}`,
        });
      }
    } catch {}
  }

  private static TERMINAL_STATUSES = new Set(['completed', 'received']);

  private static isStatusActive(status: string): boolean {
    return !LpiView.TERMINAL_STATUSES.has(status);
  }

  private static statusDisplay(status: string): string {
    if (LpiView.TERMINAL_STATUSES.has(status)) return 'Завершена';
    if (status === 'new') return 'Новая';
    return 'Активна';
  }

  private isEffectivelyActive(item: LpiItem): boolean {
    if (item.completedLocally) return false;
    return LpiView.isStatusActive(item.application_status);
  }

  private getProtocolDate(item: LpiItem): string {
    if (this.isEffectivelyActive(item)) return '—';
    return item.protocol_date || '';
  }

  private renderView(): void {
    const container = this.containerElContent;
    if (this.dashboardTimer) { clearTimeout(this.dashboardTimer); this.dashboardTimer = null; }
    for (const c of this.charts) { try { c.destroy(); } catch {} }
    this.charts = [];
    container.empty();

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '🧪 Лаборатория пожарных испытаний' });

    const btnRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mb-8' });
    const tableBtn = btnRow.createEl('button', {
      text: '📋 Таблица',
      cls: 'mailer-yougile-refresh-btn',
    });
    tableBtn.addEventListener('click', () => { this.mode = 'table'; this.renderView(); });

    const sqlBtn = btnRow.createEl('button', {
      text: '📥 SQL → Локально',
      cls: 'mailer-yougile-refresh-btn',
    });
    sqlBtn.addEventListener('click', async () => {
      sqlBtn.disabled = true;
      sqlBtn.textContent = '⏳ Загрузка...';
      await this.loadFromSqliteToLocal();
      sqlBtn.disabled = false;
      sqlBtn.textContent = '📥 SQL → Локально';
    });

    const syncBtn = btnRow.createEl('button', {
      text: '🔄 Синхронизация YouGile',
      cls: 'mailer-yougile-refresh-btn',
    });
    syncBtn.addEventListener('click', async () => {
      const sqlConnected = !!this.plugin.settings.lpiDbPath && fs.existsSync(this.plugin.settings.lpiDbPath);
      if (!sqlConnected) {
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ Загрузка из YouGile...';
        await this.syncFromTasks();
        await this.saveData();
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
      this.renderDashboard(container);
    } else {
      this.renderTable(container);
    }
  }

  private renderTable(container: HTMLElement): void {
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

    const q = this.searchQuery.trim().toLowerCase();
    let filtered = this.items;
    if (q) {
      filtered = this.items.filter(item =>
        (item.application_external_id || '').toLowerCase().includes(q) ||
        (item.product_name || '').toLowerCase().includes(q)
      );
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
      const rowClick = () => { this.renderDetail(item); };
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
      statusCell.style.color = this.isEffectivelyActive(item) ? 'var(--text-warning)' : 'var(--text-success)';
      statusCell.setText(LpiView.statusDisplay(item.application_status));
      row.createEl('td', { cls: 'mailer-td' }).setText(this.getProtocolDate(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group || '');
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
      const actionsCell = row.createEl('td', { cls: 'mailer-td' });
      const rowSendBtn = actionsCell.createEl('button', {
        text: '📤',
        cls: 'mailer-yougile-refresh-btn',
      });
      rowSendBtn.style.fontSize = 'var(--font-smaller)';
      rowSendBtn.style.padding = '2px 6px';
      rowSendBtn.disabled = !sqlConnected;
      if (!sqlConnected) rowSendBtn.title = 'Укажите путь к SQLite БД в настройках LPI';
      rowSendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!this.plugin.client) {
          new Notice('Нет подключения к YouGile');
          return;
        }
        rowSendBtn.disabled = true;
        rowSendBtn.textContent = '⏳';
        try {
          await this.syncItemToYougile(item, this.isEffectivelyActive(item));
          await this.saveData();
          new Notice(`Заявка №${item.application_external_id} отправлена в YouGile`);
        } catch (e: any) {
          new Notice('Ошибка: ' + e.message);
        }
        rowSendBtn.disabled = false;
        rowSendBtn.textContent = '📤';
      });
    }
  }

  private wasmBinary: ArrayBuffer | null = null;

  private async getWasmBinary(): Promise<ArrayBuffer> {
    if (this.wasmBinary) return this.wasmBinary;
    const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
    try {
      const buf = fs.readFileSync(wasmPath);
      this.wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return this.wasmBinary;
    } catch {
      // fallback: скачиваем с GitHub (для пользователей updater)
      const url = 'https://raw.githubusercontent.com/Epyur/yougile-tntn/main/sql-wasm.wasm';
      const resp = await requestUrl({ url });
      this.wasmBinary = resp.arrayBuffer;
      // сохраняем локально для следующих запусков
      try { fs.writeFileSync(wasmPath, Buffer.from(resp.arrayBuffer)); } catch {}
      return this.wasmBinary;
    }
  }

  private async loadFromSqliteToLocal(): Promise<void> {
    try {
      let dbPath = this.plugin.settings.lpiDbPath;
      if (!dbPath) {
        new Notice('Укажите путь к SQLite БД в настройках LPI');
        return;
      }
      dbPath = dbPath.replace(/\\/g, '/');
      if (!fs.existsSync(dbPath)) {
        new Notice('Файл БД не найден: ' + dbPath);
        return;
      }
      const wasmBinary = await this.getWasmBinary();
      const SQL = await initSqlJs({ wasmBinary: wasmBinary.slice(0) });
      const dbBuf = fs.readFileSync(dbPath);
      const db = new SQL.Database(new Uint8Array(dbBuf));
      await this.loadViewConfig();
      const sql = this.viewConfig.loadQuery;
      const stmt = db.prepare(sql);
      const sqliteItems: LpiItem[] = [];
      while (stmt.step()) {
        const obj = stmt.getAsObject();
        obj.thickness = obj.thickness !== null ? Number(obj.thickness) : null;
        obj.source_series_count = null;
        obj.source_series_range = null;
        obj.calculation_type = null;
        obj.result_data = null;
        sqliteItems.push(obj as LpiItem);
      }
      stmt.free();
      db.close();

      let added = 0;
      let updated = 0;
      let syncedToYougile = 0;
      const sqliteIds = new Set(sqliteItems.map(i => i.aggregate_id));

      for (const item of sqliteItems) {
        const existing = this.items.find(i => i.aggregate_id === item.aggregate_id);
        if (existing) {
          const wasActive = this.isEffectivelyActive(existing);
          const hadTaskId = !!existing.taskId;
          const { completedLocally, completedAt, taskId } = existing;
          const dataChanged = existing.application_status !== item.application_status
            || existing.protocol_date !== item.protocol_date
            || existing.agg_gen_group_complience !== item.agg_gen_group_complience
            || existing.agg_gen_group !== item.agg_gen_group;
          Object.assign(existing, item);
          existing.completedLocally = completedLocally;
          existing.completedAt = completedAt;
          existing.taskId = taskId;

          if (dataChanged) updated++;
          if (!hadTaskId && this.plugin.client && !this.isBeforeCutoff(existing)) {
            if (await this.syncItemToYougile(existing, wasActive)) syncedToYougile++;
          }
        } else {
          this.items.push(item);
          added++;
          if (this.plugin.client && !this.isBeforeCutoff(item)) {
            try {
              if (await this.syncItemToYougile(item, true)) syncedToYougile++;
            } catch {}
          }
        }
      }

      const before = this.items.length;
      this.items = this.items.filter(i => sqliteIds.has(i.aggregate_id));
      const removed = before - this.items.length;

      await this.saveData();
      await this.plugin.syncLogger.log({
        module: 'lpi',
        direction: 'local',
        action: 'load-sql',
        itemId: '',
        status: 'success',
        details: `SQLite → локально. Добавлено: ${added}, обновлено: ${updated}, удалено: ${removed}, синхр. с YouGile: ${syncedToYougile}`,
      });
      new Notice(`LPI: обновлено. Добавлено: ${added}, обновлено: ${updated}, синхронизировано с YouGile: ${syncedToYougile}, удалено: ${removed}`);
      this.renderView();
    } catch (e: any) {
      await this.plugin.syncLogger.log({
        module: 'lpi',
        direction: 'local',
        action: 'load-sql',
        itemId: '',
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      new Notice('Ошибка обновления из SQLite: ' + e.message);
    }
  }

  private static YG_MIN_EXT_ID = 642;

  private isBeforeCutoff(item: LpiItem): boolean {
    const id = parseInt(item.application_external_id, 10);
    return !isNaN(id) && id < LpiView.YG_MIN_EXT_ID;
  }

  private async loadViewConfig(): Promise<void> {
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
        this.viewConfig = { ...DEFAULT_CONFIG, ...parsed, detailSections: parsed.detailSections || DEFAULT_CONFIG.detailSections, colorRules: parsed.colorRules || DEFAULT_CONFIG.colorRules };
      } else {
        this.viewConfig = DEFAULT_CONFIG;
        await adapter.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      }
    } catch {
      this.viewConfig = DEFAULT_CONFIG;
    }
  }

  private async syncItemToYougile(item: LpiItem, wasActive: boolean): Promise<boolean> {
    const isTerminal = !this.isEffectivelyActive(item);
    const fullJson = this.buildFullJson(item);
    const desc = JSON.stringify(fullJson);
    const itemId = item.application_external_id || item.aggregate_id;
    const itemTitle = item.product_name;

    if (item.taskId) {
      const payload: Record<string, unknown> = { description: desc };
      if (isTerminal && wasActive) {
        payload.completed = true;
      }
      try {
        await this.plugin.client!.updateTask(item.taskId, payload);
        if (isTerminal && !item.completedLocally) {
          item.completedLocally = true;
          item.completedAt = item.protocol_date || new Date().toISOString().split('T')[0];
        }
        await this.plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'update',
          itemId,
          itemTitle,
          status: 'success',
          details: isTerminal && wasActive ? 'Задача завершена' : 'Описание обновлено',
        });
        return true;
      } catch (e: unknown) {
        await this.plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'update',
          itemId,
          itemTitle,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    } else {
      const statusTerminal = !LpiView.isStatusActive(item.application_status);
      try {
        const result: any = await this.plugin.client!.createTask({
          title: `LPI: ${item.application_external_id} — ${item.product_name}`,
          description: desc,
          columnId: this.getLpiColumnId(),
        } as any);
        if (result?.id) {
          item.taskId = result.id;
          if (statusTerminal) {
            item.completedLocally = true;
            item.completedAt = item.protocol_date || new Date().toISOString().split('T')[0];
            await this.plugin.client!.updateTask(result.id, {
              completed: true,
            });
          }
          await this.plugin.syncLogger.log({
            module: 'lpi',
            direction: 'to-yougile',
            action: 'create',
            itemId,
            itemTitle,
            status: 'success',
            details: `taskId: ${result.id}${statusTerminal ? ', завершена' : ''}`,
          });
          return true;
        }
        return false;
      } catch (e: unknown) {
        await this.plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'create',
          itemId,
          itemTitle,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    }
  }

  private buildFullJson(item: LpiItem): Record<string, unknown> {
    return {
      type: 'lpi_data',
      aggregate_id: item.aggregate_id,
      application_external_id: item.application_external_id,
      application_created_at: item.application_created_at,
      application_status: item.application_status,
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
    };
  }

  private getLpiColumnId(): string | undefined {
    const cols = this.plugin.db.getColumns();
    const boardId = this.plugin.settings.lpiBoardId;
    const colTitle = this.plugin.settings.lpiColumnTitle;
    if (boardId && colTitle) {
      const match = cols.find(c => c.boardId === boardId && c.title === colTitle);
      if (match) return match.id;
    }
    return undefined;
  }

  private async completeEntry(item: LpiItem): Promise<void> {
    try {
      const now = new Date().toISOString().split('T')[0];
      item.completedLocally = true;
      item.completedAt = now;
      await this.saveData();
      try {
        if (this.plugin.client) {
          const desc = JSON.stringify({ type: 'lpi_completed', aggregate_id: item.aggregate_id, application_external_id: item.application_external_id, product_name: item.product_name, completedAt: now, protocol_date: item.protocol_date || now, agg_gen_group_complience: item.agg_gen_group_complience || '', customer_name: item.customer_name || '', customer_mail: item.customer_mail || '', organization: item.organization || '', ekn: item.ekn || '' });
          const result: any = await this.plugin.client.createTask({
            title: `LPI: ${item.application_external_id} — ${item.product_name}`,
            description: desc,
            columnId: this.getLpiColumnId(),
          } as any);
          if (result?.id) {
            await this.plugin.client.updateTask(result.id, { completed: true });
            item.taskId = result.id;
            await this.saveData();
          }
        }
      } catch {}
      new Notice(`Заявка №${item.application_external_id} завершена`);
      this.renderView();
    } catch (e: any) {
      new Notice('Ошибка: ' + e.message);
    }
  }

  private applyFilters(items: LpiItem[]): LpiItem[] {
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

  private renderDashboard(container: HTMLElement): void {
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
    addDateFilter('Дата создания с', this.appDateFrom, v => this.appDateFrom = v);
    addDateFilter('по', this.appDateTo, v => this.appDateTo = v);
    addDateFilter('Дата протокола с', this.protocolDateFrom, v => this.protocolDateFrom = v);
    addDateFilter('по', this.protocolDateTo, v => this.protocolDateTo = v);

    const addCb = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
      const group = filterRow.createDiv({ attr: { style: 'display:flex;align-items:center;margin-left:8px' } });
      const cb = group.createEl('input', { attr: { type: 'checkbox' } });
      cb.style.width = '16px';
      cb.style.height = '16px';
      cb.style.margin = '0 4px 0 0';
      cb.checked = checked;
      cb.addEventListener('change', () => { onChange(cb.checked); this.renderView(); });
      const lbl = group.createEl('label', { text: label });
      lbl.style.fontSize = 'var(--font-smaller)';
    };
    addCb('Серийная продукция', this.serialOnly, v => this.serialOnly = v);
    addCb('Опытная продукция', this.experimentalOnly, v => this.experimentalOnly = v);

    const allFiltered = this.applyFilters(this.items);

    // available products from full unfiltered list for the filter modal
    const allProducts = [...new Set(this.items.map(i => i.product_name))].sort();
    // remove selected that no longer exist in full list
    for (const p of this.selectedProducts) {
      if (!allProducts.includes(p)) this.selectedProducts.delete(p);
    }
    // available methods from filtered items for the method filter
    const filteredMethods = [...new Set(allFiltered.filter(i => i.method_abbreviation).map(i => i.method_abbreviation!))].sort();
    // available methods from full list for the method filter modal
    const allMethods = [...new Set(this.items.filter(i => i.method_abbreviation).map(i => i.method_abbreviation!))].sort();
    for (const m of this.selectedMethods) {
      if (!allMethods.includes(m)) this.selectedMethods.delete(m);
    }

    const methodBtn = container.createEl('button', {
      text: this.selectedMethods.size > 0 ? `🔬 ${[...this.selectedMethods].map(m => LpiView.getMethodDisplayName(m)).join(', ')}` : '🔬 Подтверждаемый показатель',
      cls: 'mailer-yougile-refresh-btn',
    });
    methodBtn.style.marginLeft = '8px';
    methodBtn.addEventListener('click', () => {
      const modal = new MethodFilterModal(this.app, allMethods, this.selectedMethods, (selected) => {
        this.selectedMethods = selected;
        this.renderView();
      });
      modal.open();
    });
    if (this.selectedMethods.size > 0) {
      const clearM = container.createEl('button', { text: '✕', cls: 'mailer-yougile-refresh-btn' });
      clearM.style.marginLeft = '4px';
      clearM.addEventListener('click', () => {
        this.selectedMethods.clear();
        this.renderView();
      });
    }

    const productBtn = container.createEl('button', {
      text: this.selectedProducts.size > 0 ? `🔽 Продукты (${this.selectedProducts.size})` : '🔽 Выбрать продукты',
      cls: 'mailer-yougile-refresh-btn',
    });
    productBtn.style.marginLeft = '8px';
    productBtn.addEventListener('click', () => {
      const modal = new ProductFilterModal(this.app, allProducts, this.selectedProducts, (selected) => {
        this.selectedProducts = selected;
        this.renderView();
      });
      modal.open();
    });

    if (this.selectedProducts.size > 0) {
      const clearBtn = container.createEl('button', { text: '✕ Сбросить', cls: 'mailer-yougile-refresh-btn' });
      clearBtn.style.marginLeft = '8px';
      clearBtn.addEventListener('click', () => {
        this.selectedProducts.clear();
        this.renderView();
      });
    }

    let filtered = allFiltered;
    if (this.selectedProducts.size > 0) {
      filtered = filtered.filter(item => this.selectedProducts.has(item.product_name));
    }

    const total = filtered.length;
    const active = filtered.filter(i => this.isEffectivelyActive(i)).length;
    const completed = filtered.filter(i => !this.isEffectivelyActive(i)).length;
    const withProtocol = filtered.filter(i => i.protocol_date).length;

    const metricsRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap mailer-mb-8' });
    const metricStyle = 'min-width:120px;padding:8px 12px;margin:4px;background:var(--background-modifier-hover);border-radius:6px;text-align:center';
    const addMetric = (label: string, value: string | number) => {
      const div = metricsRow.createDiv({ attr: { style: metricStyle } });
      div.createDiv({ attr: { style: 'font-size:var(--font-ui-smaller);opacity:.7' }, text: label });
      div.createDiv({ attr: { style: 'font-size:var(--font-ui-large);font-weight:700' }, text: String(value) });
    };
    addMetric('Всего заявок', total);
    addMetric('Активно', active);
    addMetric('Завершено', completed);
    addMetric('С протоколом', withProtocol);

    const chartRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    const c1 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c1.createEl('h4', { text: 'Статус заявок' });
    this.createChart(c1, this.buildStatusSeries(filtered));

    const c2 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c2.createEl('h4', { text: 'Поступление заявок по месяцам' });
    this.createChart(c2, this.buildIncomingMonthlySeries(filtered));

    const chartRow2 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    const c3 = chartRow2.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c3.createEl('h4', { text: 'Завершение заявок по месяцам' });
    this.createChart(c3, this.buildCompletedMonthlySeries(filtered));

    const c4 = chartRow2.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c4.createEl('h4', { text: 'Общая оценка соответствия' });
    this.createChart(c4, this.buildComplianceSeries(filtered));

    const chartRow3 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    if (this.selectedProducts.size > 1) {
      const c5 = chartRow3.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
      c5.createEl('h4', { text: 'Оценка по продуктам' });
      const perProductWrap = c5.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
      const c6 = chartRow3.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
      c6.createEl('h4', { text: 'Результаты испытаний по продуктам' });
      const perProductTestWrap = c6.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
      const products = [...this.selectedProducts].sort();
      for (const product of products) {
        const productItems = filtered.filter(i => i.product_name === product);
        if (productItems.length === 0) continue;
        const card = perProductWrap.createDiv({ attr: { style: 'width:45%;min-width:160px;margin:2%' } });
        const title = card.createEl('h5', { text: product });
        title.style.fontSize = 'var(--font-smaller)';
        title.style.whiteSpace = 'normal';
        title.style.wordBreak = 'break-word';
        title.style.margin = '4px 0';
        this.createChart(card, this.buildComplianceSeries(productItems, true));
        const testCard = perProductTestWrap.createDiv({ attr: { style: 'width:45%;min-width:160px;margin:2%' } });
        const testTitle = testCard.createEl('h5', { text: product });
        testTitle.style.fontSize = 'var(--font-smaller)';
        testTitle.style.whiteSpace = 'normal';
        testTitle.style.wordBreak = 'break-word';
        testTitle.style.margin = '4px 0';
        this.createChart(testCard, this.buildTestResultSeries(productItems, true));
      }
    } else {
      const c5 = chartRow3.createDiv({ attr: { style: 'width:98%;min-width:280px;margin:1%' } });
      c5.createEl('h4', { text: 'Топ продуктов по заявкам' });
      this.createChart(c5, this.buildTopProductsSeries(filtered));
    }

    const chartRow4 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
    const c6 = chartRow4.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c6.createEl('h4', { text: 'Результаты испытания' });
    this.createChart(c6, this.buildTestResultSeries(filtered));

    this.dashboardTimer = window.setTimeout(() => {
      for (const chart of this.charts) {
        try { chart.render(); } catch {}
      }
    }, 100);
  }

  private createChart(container: HTMLElement, options: Record<string, unknown>): ApexCharts {
    const chart = new ApexCharts(container, options as any);
    this.charts.push(chart);
    return chart;
  }

  private buildStatusSeries(items: LpiItem[]): Record<string, unknown> {
    const active = items.filter(i => this.isEffectivelyActive(i)).length;
    const completed = items.filter(i => !this.isEffectivelyActive(i)).length;
    return {
      chart: { type: 'donut' },
      labels: ['Активно', 'Завершено'],
      series: [active, completed],
      colors: ['#f59e0b', '#10b981'],
      plotOptions: { pie: { donut: { size: '60%' } } },
      tooltip: { enabled: true },
      legend: { position: 'bottom', fontSize: '12px' },
    };
  }

  private buildIncomingMonthlySeries(items: LpiItem[]): Record<string, unknown> {
    const months: Record<string, number> = {};
    for (const item of items) {
      if (!item.application_created_at) continue;
      const month = item.application_created_at.substring(0, 7);
      months[month] = (months[month] || 0) + 1;
    }
    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      chart: { type: 'bar' },
      xaxis: {
        categories: sorted.map(([m]) => m),
        labels: { rotate: -45, style: { fontSize: '10px' } },
      },
      series: [{ name: 'Поступило', data: sorted.map(([, c]) => c) }],
      colors: ['#3b82f6'],
      plotOptions: { bar: { borderRadius: 3 } },
      tooltip: { enabled: true },
      legend: { show: false },
    };
  }

  private buildCompletedMonthlySeries(items: LpiItem[]): Record<string, unknown> {
    const months: Record<string, number> = {};
    for (const item of items) {
      if (!item.protocol_date) continue;
      const month = item.protocol_date.substring(0, 7);
      months[month] = (months[month] || 0) + 1;
    }
    const sorted = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      chart: { type: 'bar' },
      xaxis: {
        categories: sorted.map(([m]) => m),
        labels: { rotate: -45, style: { fontSize: '10px' } },
      },
      series: [{ name: 'Завершено', data: sorted.map(([, c]) => c) }],
      colors: ['#10b981'],
      plotOptions: { bar: { borderRadius: 3 } },
      tooltip: { enabled: true },
      legend: { show: false },
    };
  }

  private buildComplianceSeries(items: LpiItem[], small = false): Record<string, unknown> {
    const counts: Record<string, number> = { 'Соответствует': 0, 'Не соответствует': 0, 'Не оценивается': 0, 'Нет данных': 0 };
    for (const item of items) {
      const val = item.agg_gen_group_complience;
      if (!val) { counts['Нет данных']++; }
      else if (counts[val] !== undefined) { counts[val]++; }
      else { counts['Нет данных']++; }
    }
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    const opts: Record<string, unknown> = {
      chart: { type: 'donut' },
      labels,
      series: data,
      colors: ['#10b981', '#ef4444', '#f59e0b', '#6b7280'],
      plotOptions: { pie: { donut: { size: '60%' } } },
      tooltip: { enabled: true },
      legend: { position: 'bottom', fontSize: '12px' },
    };
    if (small) {
      opts.dataLabels = { enabled: false };
      opts.legend = { show: false };
    }
    return opts;
  }

  private buildTestResultSeries(items: LpiItem[], small = false): Record<string, unknown> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const val = item.agg_gen_group;
      if (!val) continue;
      counts[val] = (counts[val] || 0) + 1;
    }
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    const opts: Record<string, unknown> = {
      chart: { type: 'donut' },
      labels,
      series: data,
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
      plotOptions: { pie: { donut: { size: '60%' } } },
      tooltip: { enabled: true },
      legend: { position: 'bottom', fontSize: '12px' },
    };
    if (small) {
      opts.dataLabels = { enabled: false };
      opts.legend = { show: false };
    }
    return opts;
  }

  private buildTopProductsSeries(items: LpiItem[]): Record<string, unknown> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      counts[item.product_name] = (counts[item.product_name] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const names = sorted.map(([name]) => name);
    return {
      chart: { type: 'bar' },
      plotOptions: { bar: { borderRadius: 3, horizontal: true } },
      series: [{ name: 'Заявок', data: sorted.map(([, c]) => c) }],
      xaxis: {
        categories: names,
        labels: { style: { fontSize: '10px' } },
      },
      yaxis: {
        labels: {
          style: { fontSize: '10px', whiteSpace: 'normal', wordBreak: 'break-word' },
          maxWidth: 500,
          trim: false,
        },
      },
      colors: ['#8b5cf6'],
      tooltip: { enabled: true },
      legend: { show: false },
    };
  }

  private async renderDetail(item: LpiItem): Promise<void> {
    const container = this.containerElContent;
    container.empty();

    const btnRow = container.createDiv();
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginBottom = '8px';
    btnRow.style.flexWrap = 'wrap';

    const backBtn = btnRow.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    const sqlConnected = !!this.plugin.settings.lpiDbPath && fs.existsSync(this.plugin.settings.lpiDbPath);
    const sendBtn = btnRow.createEl('button', {
      text: '📤 Отправить в YouGile',
      cls: 'mailer-yougile-refresh-btn',
    });
    sendBtn.disabled = !sqlConnected;
    if (!sqlConnected) {
      sendBtn.title = 'Укажите путь к SQLite БД в настройках LPI';
    }
    sendBtn.addEventListener('click', async () => {
      if (!this.plugin.client) {
        new Notice('Нет подключения к YouGile');
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Отправка...';
      try {
        await this.syncItemToYougile(item, this.isEffectivelyActive(item));
        await this.saveData();
        new Notice(`Заявка №${item.application_external_id} отправлена в YouGile`);
      } catch (e: any) {
        new Notice('Ошибка: ' + e.message);
      }
      sendBtn.disabled = false;
      sendBtn.textContent = '📤 Отправить в YouGile';
    });

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta' });

    const colorRules = this.viewConfig.colorRules || {};

    const renderFieldSection = (section: FieldSectionDef) => {
      if (section.fields.length === 0) return;
      meta.createEl('h4', { text: section.title, cls: 'mailer-mt-8' });
      for (const f of section.fields) {
        if (f.visibleIf) {
          const targetVal = (item as any)[f.visibleIf.field];
          if (f.visibleIf.notNull && (targetVal === null || targetVal === undefined || targetVal === '')) continue;
          if (f.visibleIf.equals !== undefined && String(targetVal) !== f.visibleIf.equals) continue;
        }
        const raw = (item as any)[f.field];
        const isMissing = raw === null || raw === undefined || raw === '';
        let display = isMissing ? '—' : String(raw);
        if (f.format && !isMissing) {
          display = f.format.replace('{value}', display);
        }
        const div = meta.createDiv();
        if (f.bold) div.style.fontWeight = 'bold';
        div.textContent = `${f.label}: ${display}`;
        if (f.colorRuleId && !isMissing) {
          const ruleSet = colorRules[f.colorRuleId];
          if (ruleSet) {
            const match = ruleSet.rules.find(r => r.match === raw);
            div.style.color = match ? match.color : (ruleSet.defaultColor || '');
          }
        }
      }
    };

    const renderSubquerySection = async (section: SubquerySectionDef) => {
      const dbPath = this.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
      if (!dbPath || !fs.existsSync(dbPath)) return;
      let query = section.query;
      for (const key of section.dependsOn) {
        const val = (item as any)[key];
        if (val !== null && val !== undefined) {
          query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
        }
      }
      try {
        const result = await this.schemaService.runQuery(dbPath, query);
        if (result.columns.length === 0) return;
        meta.createEl('h4', { text: section.title, cls: 'mailer-mt-8' });
        const subTable = meta.createEl('table');
        subTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;margin-top:4px';
        const subHead = subTable.createEl('thead');
        const subHr = subHead.createEl('tr');
        for (const col of section.columns) {
          const th = subHr.createEl('th', { text: col.label });
          th.style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:3px 6px;text-align:left;white-space:nowrap';
        }
        const subBody = subTable.createEl('tbody');
        for (const row of result.rows) {
          const tr = subBody.createEl('tr');
          for (const col of section.columns) {
            const colIdx = result.columns.indexOf(col.field);
            const raw = colIdx >= 0 ? row[colIdx] : null;
            const isMissing = raw === null || raw === undefined || raw === '';
            let display = isMissing ? '—' : String(raw);
            if (col.format && !isMissing) {
              display = col.format.replace('{value}', display);
            }
            tr.createEl('td', { text: display }).style.cssText = 'padding:2px 6px;border-bottom:1px solid var(--background-modifier-border)';
          }
        }
      } catch {}
    };

    for (const section of this.viewConfig.detailSections) {
      if (section.type === 'fields') {
        renderFieldSection(section);
      } else if (section.type === 'subquery') {
        await renderSubquerySection(section);
      }
    }

    this.renderQueryRunner(container, item);
  }

  private renderQueryRunner(container: HTMLElement, item: LpiItem): void {
    const dbPath = this.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
    if (!dbPath || !fs.existsSync(dbPath)) return;

    const details = container.createEl('details', { attr: { style: 'margin-top:16px' } });
    const summary = details.createEl('summary', { text: '🔍 SQL Запрос', attr: { style: 'cursor:pointer;font-weight:600;font-size:13px' } });

    const qContainer = details.createDiv();
    qContainer.style.cssText = 'padding:8px;background:var(--background-primary-alt);border-radius:6px;margin-top:8px';

    const tableSelRow = qContainer.createDiv();
    tableSelRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';

    const tableSel = tableSelRow.createEl('select');
    tableSel.style.cssText = 'flex:1;font-size:12px;padding:4px';
    tableSel.createEl('option', { text: '— Выберите таблицу —', value: '' });

    this.schemaService.loadSchema(dbPath).then(schema => {
      for (const table of schema.tables) {
        tableSel.createEl('option', { text: table.name, value: table.name });
      }
    }).catch(() => {});

    const autoBtn = tableSelRow.createEl('button', { text: '🔄 Авто', cls: 'mailer-yougile-refresh-btn' });
    autoBtn.style.fontSize = '11px';

    const sqlInput = qContainer.createEl('textarea');
    sqlInput.style.cssText = 'width:100%;box-sizing:border-box;padding:6px;font-family:monospace;font-size:11px;min-height:60px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:4px';
    sqlInput.placeholder = 'SELECT * FROM table WHERE column = \'{{application_external_id}}\'';

    autoBtn.addEventListener('click', () => {
      const tableName = tableSel.value;
      if (!tableName) return;
      this.schemaService.loadSchema(dbPath).then(schema => {
        const table = schema.byName.get(tableName);
        if (!table) return;
        const cols = table.columns.map(c => c.name).join(',\n  ');
        const fkClauses = table.foreignKeys.map(fk => `${fk.from} = '{{aggregate_id}}'`).join('\n  OR ');
        let where = '';
        if (fkClauses) where = `WHERE (\n  ${fkClauses}\n)`;
        else if (table.columns.some(c => c.name.includes('application_id') || c.name.includes('aggregate_id'))) {
          where = "WHERE application_id = '{{aggregate_id}}'";
        }
        sqlInput.value = `SELECT\n  ${cols}\nFROM ${tableName}\n${where}\nLIMIT 50`;
      }).catch(() => {});
    });

    const runBtn = qContainer.createEl('button', { text: '▶ Выполнить', cls: 'mailer-yougile-refresh-btn' });
    runBtn.style.marginTop = '6px';

    const resultDiv = qContainer.createDiv();
    resultDiv.style.cssText = 'margin-top:8px;overflow-x:auto';

    const saveSectionBtn = qContainer.createEl('button', {
      text: '💾 Сохранить как секцию',
      cls: 'mailer-yougile-refresh-btn',
      attr: { style: 'margin-top:6px;font-size:11px' },
    });

    runBtn.addEventListener('click', async () => {
      let query = sqlInput.value;
      for (const key of ['aggregate_id', 'application_external_id', 'product_name']) {
        const val = (item as any)[key];
        if (val !== null && val !== undefined) {
          query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
        }
      }
      resultDiv.empty();
      runBtn.textContent = '⏳';
      runBtn.disabled = true;
      try {
        const result = await this.schemaService.runQuery(dbPath, query);
        if (result.columns.length === 0) {
          resultDiv.textContent = 'Нет результатов';
          saveSectionBtn.style.display = 'none';
          return;
        }
        const resTable = resultDiv.createEl('table');
        resTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';
        const resHead = resTable.createEl('thead');
        const resHr = resHead.createEl('tr');
        for (const col of result.columns) {
          resHr.createEl('th', { text: col }).style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:3px 6px;text-align:left;white-space:nowrap';
        }
        const resBody = resTable.createEl('tbody');
        for (const row of result.rows) {
          const tr = resBody.createEl('tr');
          for (let i = 0; i < result.columns.length; i++) {
            tr.createEl('td', { text: row[i] !== null && row[i] !== undefined ? String(row[i]) : '—' }).style.cssText = 'padding:2px 6px;border-bottom:1px solid var(--background-modifier-border);white-space:nowrap';
          }
        }
        saveSectionBtn.style.display = 'block';
        saveSectionBtn.onclick = () => {
          const newSection: SubquerySectionDef = {
            title: tableSel.value ? `Данные: ${tableSel.value}` : 'Доп. данные',
            type: 'subquery',
            query: sqlInput.value,
            columns: result.columns.map(c => ({ label: c, field: c })),
            dependsOn: ['aggregate_id', 'application_external_id'],
          };
          this.viewConfig.detailSections.push(newSection);
        };
      } catch (e: any) {
        resultDiv.textContent = 'Ошибка: ' + e.message;
        saveSectionBtn.style.display = 'none';
      }
      runBtn.textContent = '▶ Выполнить';
      runBtn.disabled = false;
    });
    saveSectionBtn.style.display = 'none';

    const editConfigBtn = qContainer.createEl('button', {
      text: '⚙ Редактор конфига',
      cls: 'mailer-yougile-refresh-btn',
      attr: { style: 'margin-left:6px;font-size:11px' },
    });
    editConfigBtn.addEventListener('click', () => {
      new LpiConfigEditorModal(this.app, this).open();
    });
  }
}

class ProductFilterModal extends Modal {
  private allProducts: string[];
  private selected: Set<string>;
  private onSave: (selected: Set<string>) => void;

  constructor(app: App, allProducts: string[], selected: Set<string>, onSave: (selected: Set<string>) => void) {
    super(app);
    this.allProducts = allProducts;
    this.selected = new Set(selected);
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mailer-yougile-container');

    contentEl.createEl('h3', { text: 'Выбор продуктов для дашборда' });

    const searchInput = contentEl.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск продукта...' } });
    searchInput.style.width = '100%';
    searchInput.style.marginBottom = '8px';
    searchInput.style.boxSizing = 'border-box';
    searchInput.focus();

    const listContainer = contentEl.createDiv();
    listContainer.style.maxHeight = '400px';
    listContainer.style.overflowY = 'auto';

    const renderList = () => {
      listContainer.empty();
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allProducts.filter(p => p && p.toLowerCase().includes(q)) : this.allProducts;
      for (const product of filtered) {
        const wrapper = listContainer.createEl('label');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.padding = '2px 0';
        wrapper.style.cursor = 'pointer';
        wrapper.style.fontSize = 'var(--font-smaller)';
        const cb = wrapper.createEl('input', { attr: { type: 'checkbox' } });
        cb.style.width = '16px';
        cb.style.height = '16px';
        cb.style.margin = '0 6px 0 0';
        cb.style.flexShrink = '0';
        cb.checked = this.selected.has(product);
        cb.addEventListener('change', () => {
          if (cb.checked) this.selected.add(product);
          else this.selected.delete(product);
        });
        wrapper.createEl('span').setText(product);
      }
    };
    renderList();

    searchInput.addEventListener('input', renderList);
    searchInput.addEventListener('keyup', renderList);

    const btnRow = contentEl.createDiv({ cls: 'mailer-yougile-header mailer-mt-8' });
    const selectAllBtn = btnRow.createEl('button', { text: 'Выбрать все', cls: 'mailer-yougile-refresh-btn' });
    selectAllBtn.addEventListener('click', () => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allProducts.filter(p => p && p.toLowerCase().includes(q)) : this.allProducts;
      for (const product of filtered) this.selected.add(product);
      renderList();
    });

    const deselectAllBtn = btnRow.createEl('button', { text: 'Снять все', cls: 'mailer-yougile-refresh-btn' });
    deselectAllBtn.addEventListener('click', () => {
      this.selected.clear();
      renderList();
    });

    const applyBtn = btnRow.createEl('button', { text: '✅ Применить', cls: 'mailer-yougile-refresh-btn' });
    applyBtn.addEventListener('click', () => {
      this.onSave(this.selected);
      this.close();
    });

    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class MethodFilterModal extends Modal {
  private allMethods: string[];
  private selected: Set<string>;
  private onSave: (selected: Set<string>) => void;

  constructor(app: App, allMethods: string[], selected: Set<string>, onSave: (selected: Set<string>) => void) {
    super(app);
    this.allMethods = allMethods;
    this.selected = new Set(selected);
    this.onSave = onSave;
  }

  private displayName(abbr: string): string {
    return LpiView.METHOD_NAMES[abbr] || abbr;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mailer-yougile-container');

    contentEl.createEl('h3', { text: 'Выбор подтверждаемого показателя' });

    const searchInput = contentEl.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск показателя...' } });
    searchInput.style.width = '100%';
    searchInput.style.marginBottom = '8px';
    searchInput.style.boxSizing = 'border-box';
    searchInput.focus();

    const listContainer = contentEl.createDiv();
    listContainer.style.maxHeight = '400px';
    listContainer.style.overflowY = 'auto';

    const renderList = () => {
      listContainer.empty();
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allMethods.filter(m => this.displayName(m).toLowerCase().includes(q)) : this.allMethods;
      for (const method of filtered) {
        const wrapper = listContainer.createEl('label');
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.padding = '2px 0';
        wrapper.style.cursor = 'pointer';
        wrapper.style.fontSize = 'var(--font-smaller)';
        const cb = wrapper.createEl('input', { attr: { type: 'checkbox' } });
        cb.style.width = '16px';
        cb.style.height = '16px';
        cb.style.margin = '0 6px 0 0';
        cb.style.flexShrink = '0';
        cb.checked = this.selected.has(method);
        cb.addEventListener('change', () => {
          if (cb.checked) this.selected.add(method);
          else this.selected.delete(method);
        });
        wrapper.createEl('span').setText(this.displayName(method));
      }
    };
    renderList();

    searchInput.addEventListener('input', renderList);
    searchInput.addEventListener('keyup', renderList);

    const btnRow = contentEl.createDiv({ cls: 'mailer-yougile-header mailer-mt-8' });
    const selectAllBtn = btnRow.createEl('button', { text: 'Выбрать все', cls: 'mailer-yougile-refresh-btn' });
    selectAllBtn.addEventListener('click', () => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allMethods.filter(m => this.displayName(m).toLowerCase().includes(q)) : this.allMethods;
      for (const method of filtered) this.selected.add(method);
      renderList();
    });

    const deselectAllBtn = btnRow.createEl('button', { text: 'Снять все', cls: 'mailer-yougile-refresh-btn' });
    deselectAllBtn.addEventListener('click', () => {
      this.selected.clear();
      renderList();
    });

    const applyBtn = btnRow.createEl('button', { text: '✅ Применить', cls: 'mailer-yougile-refresh-btn' });
    applyBtn.addEventListener('click', () => {
      this.onSave(this.selected);
      this.close();
    });

    const cancelBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class YougileSyncModal extends Modal {
  private choices: Map<number, 'local' | 'yougile'> = new Map();

  constructor(app: App, private plugin: YouGilePlugin, private view: LpiView) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('mailer-yougile-container');
    contentEl.createEl('h2', { text: '🔄 Синхронизация с YouGile' });

    if (!this.plugin.client) {
      contentEl.createEl('p', { text: '❌ Нет подключения к YouGile' });
      const closeBtn = contentEl.createEl('button', { text: 'Закрыть', cls: 'mailer-yougile-refresh-btn' });
      closeBtn.addEventListener('click', () => this.close());
      return;
    }

    contentEl.createEl('p', { text: 'Загрузка задач из YouGile...' });

    const tasks: any[] = await this.plugin.client.getTasks();
    const lpiTasks = tasks.filter((t: any) => {
      try {
        const desc = JSON.parse(t.description || '{}');
        return desc.type === 'lpi_completed' || desc.type === 'lpi_data';
      } catch { return false; }
    });

    const items: LpiItem[] = this.view.items;
    const byExtId = new Map<string, any>();
    const byAggId = new Map<string, any>();
    const existingTaskIds = new Set(items.filter(i => i.taskId).map(i => i.taskId));

    for (const task of lpiTasks) {
      const desc = JSON.parse(task.description || '{}');
      if (desc.application_external_id) byExtId.set(desc.application_external_id, { task, desc });
      if (desc.aggregate_id) byAggId.set(desc.aggregate_id, { task, desc });
    }

    const matchingDiffs: { item: LpiItem; task: any; yougileDesc: Record<string, any>; diffs: { label: string; local: string; yougile: string }[] }[] = [];
    const imported: any[] = [];

    for (const task of lpiTasks) {
      const desc = JSON.parse(task.description || '{}');
      const extId = desc.application_external_id || '';
      let localItem = items.find(i => i.taskId === task.id);
      if (!localItem && extId) localItem = items.find(i => i.application_external_id === extId);
      if (!localItem && desc.aggregate_id) localItem = items.find(i => i.aggregate_id === desc.aggregate_id);

      if (!localItem) {
        if (desc.application_created_at && desc.application_created_at < '2026-07-20') continue;
        imported.push({ task, desc });
        continue;
      }

      const diffs: { label: string; local: string; yougile: string }[] = [];
      const compareFields: { key: string; label: string }[] = [
        { key: 'application_status', label: 'Статус заявки' },
        { key: 'protocol_date', label: 'Дата протокола' },
        { key: 'agg_gen_group_complience', label: 'Оценка соответствия' },
        { key: 'agg_gen_group', label: 'Результат испытания' },
      ];
      for (const { key, label } of compareFields) {
        const lv = String((localItem as any)[key] ?? '');
        const yv = String(desc[key] ?? '');
        if (lv !== yv) diffs.push({ label, local: lv || '—', yougile: yv || '—' });
      }
      const lc = localItem.completedLocally ? 'Завершена' : 'Активна';
      const yc = task.completed ? 'Завершена' : 'Активна';
      if (lc !== yc) diffs.push({ label: 'Статус завершения', local: lc, yougile: yc });

      if (diffs.length > 0) {
        matchingDiffs.push({ item: localItem, task, yougileDesc: desc, diffs });
      }
    }

    contentEl.empty();
    contentEl.createEl('h2', { text: '🔄 Синхронизация с YouGile' });

    let autoImported = 0;
    for (const imp of imported) {
      const newItem: LpiItem = { ...imp.desc, taskId: imp.task.id } as any;
      newItem.completedLocally = !!imp.task.completed;
      if (imp.task.completed) newItem.completedAt = imp.desc.completedAt || '';
      const hasItem = items.some(i => i.aggregate_id === newItem.aggregate_id || i.application_external_id === newItem.application_external_id);
      if (!hasItem) {
        items.push(newItem);
        autoImported++;
      }
    }

    if (matchingDiffs.length === 0) {
      if (autoImported > 0) {
        await (this.view as any).saveData();
        contentEl.createEl('p', { text: `✅ Автоматически импортировано из YouGile: ${autoImported} заявок. Расхождений нет.` });
      } else {
        contentEl.createEl('p', { text: '✅ Расхождений нет. Локальные данные синхронизированы с YouGile.' });
      }
      const closeBtn = contentEl.createEl('button', { text: 'Закрыть', cls: 'mailer-yougile-refresh-btn' });
      closeBtn.addEventListener('click', () => this.close());
      return;
    }

    if (autoImported > 0) {
      contentEl.createEl('p', { text: `✅ Автоматически импортировано из YouGile: ${autoImported} заявок.` });
    }
    contentEl.createEl('p', { text: `Найдено расхождений по ${matchingDiffs.length} заявкам. Выберите приоритет для каждой:` });

    const cardsContainer = contentEl.createDiv();
    cardsContainer.style.maxHeight = '500px';
    cardsContainer.style.overflowY = 'auto';

    for (let idx = 0; idx < matchingDiffs.length; idx++) {
      const md = matchingDiffs[idx];
      const card = cardsContainer.createEl('div');
      card.style.border = '1px solid var(--background-modifier-border)';
      card.style.borderRadius = '6px';
      card.style.padding = '8px 10px';
      card.style.marginBottom = '8px';
      card.style.backgroundColor = 'var(--background-secondary)';

      const headerLine = card.createEl('div');
      headerLine.style.fontWeight = 'bold';
      headerLine.style.marginBottom = '6px';
      headerLine.setText(`№${md.item.application_external_id} — ${md.item.product_name || 'нет материала'}`);

      const diffTable = card.createEl('table');
      diffTable.style.width = '100%';
      diffTable.style.fontSize = 'var(--font-smaller)';
      diffTable.style.borderCollapse = 'collapse';
      diffTable.style.marginBottom = '6px';

      const headerRow = diffTable.insertRow();
      for (const text of ['Поле', '📍 Локально', 'YouGile']) {
        const th = headerRow.createEl('th');
        th.style.padding = '2px 6px';
        th.style.borderBottom = '2px solid var(--background-modifier-border)';
        th.style.textAlign = 'left';
        th.style.fontWeight = 'bold';
        th.setText(text);
      }

      for (const d of md.diffs) {
        const tr = diffTable.insertRow();
        const cells = [d.label, d.local, d.yougile];
        for (let ci = 0; ci < cells.length; ci++) {
          const td = tr.insertCell();
          td.style.padding = '2px 6px';
          td.style.borderBottom = '1px solid var(--background-modifier-border)';
          td.setText(cells[ci]);
          if (ci === 1) td.style.backgroundColor = 'rgba(var(--color-green-rgb), 0.08)';
          if (ci === 2) td.style.backgroundColor = 'rgba(var(--interactive-accent-rgb), 0.08)';
        }
      }

      const toggleLine = card.createDiv();
      toggleLine.style.display = 'flex';
      toggleLine.style.alignItems = 'center';
      toggleLine.style.gap = '8px';
      toggleLine.style.marginTop = '4px';

      const localRadio = toggleLine.createEl('input', { attr: { type: 'radio', name: `choice_${idx}`, id: `local_${idx}` } });
      localRadio.style.width = '14px';
      localRadio.style.height = '14px';
      localRadio.checked = true;
      this.choices.set(idx, 'local');
      localRadio.addEventListener('change', () => { if (localRadio.checked) this.choices.set(idx, 'local'); });

      const localLabel = toggleLine.createEl('label', { attr: { for: `local_${idx}` } });
      localLabel.style.color = 'var(--text-success)';
      localLabel.style.fontWeight = 'bold';
      localLabel.style.fontSize = 'var(--font-smaller)';
      localLabel.setText('📍 Локальные');

      const yougileRadio = toggleLine.createEl('input', { attr: { type: 'radio', name: `choice_${idx}`, id: `yougile_${idx}` } });
      yougileRadio.style.width = '14px';
      yougileRadio.style.height = '14px';
      yougileRadio.addEventListener('change', () => { if (yougileRadio.checked) this.choices.set(idx, 'yougile'); });

      const yougileLabel = toggleLine.createEl('label', { attr: { for: `yougile_${idx}` } });
      yougileLabel.style.color = 'var(--interactive-accent)';
      yougileLabel.style.fontWeight = 'bold';
      yougileLabel.style.fontSize = 'var(--font-smaller)';
      yougileLabel.setText('YouGile');
    }

    const bottomRow = contentEl.createDiv();
    bottomRow.style.marginTop = '12px';
    bottomRow.style.display = 'flex';
    bottomRow.style.gap = '8px';
    bottomRow.style.flexWrap = 'wrap';
    bottomRow.style.alignItems = 'center';

    const applyAllBtn = bottomRow.createEl('button', {
      text: '✅ Применить все',
      cls: 'mailer-yougile-refresh-btn',
    });
    applyAllBtn.addEventListener('click', async () => {
      applyAllBtn.disabled = true;
      applyAllBtn.setText('⏳ Применение...');
      let count = 0;
      for (let idx = 0; idx < matchingDiffs.length; idx++) {
        const md = matchingDiffs[idx];
        const choice = this.choices.get(idx) || 'local';
        try {
          const fullJson = (this.view as any).buildFullJson(md.item);
          const isTerminal = !(this.view as any).isEffectivelyActive(md.item);

          if (choice === 'local') {
            await this.plugin.client!.updateTask(md.task.id, { description: JSON.stringify(fullJson) });
            if (isTerminal && !md.task.completed) {
              await this.plugin.client!.updateTask(md.task.id, { completed: true });
            }
            if (!md.item.taskId) md.item.taskId = md.task.id;
          } else {
            for (const key of ['application_status', 'protocol_date', 'agg_gen_group_complience', 'agg_gen_group']) {
              const yv = md.yougileDesc[key];
              if (yv !== undefined && yv !== null) (md.item as any)[key] = yv;
            }
            if (md.task.completed && !md.item.completedLocally) {
              md.item.completedLocally = true;
              md.item.completedAt = md.yougileDesc.completedAt || '';
            }
            if (!md.item.taskId) md.item.taskId = md.task.id;
          }
          count++;
        } catch (e: any) {
          new Notice(`Ошибка по №${md.item.application_external_id}: ${e.message}`);
        }
      }
      await (this.view as any).saveData();
      new Notice(`Применено: ${count} заявок`);
      this.close();
      (this.view as any).renderView();
    });

    const closeBtn = bottomRow.createEl('button', {
      text: 'Закрыть',
      cls: 'mailer-yougile-refresh-btn',
    });
    closeBtn.addEventListener('click', () => {
      (this.view as any).renderView();
      this.close();
    });
  }
}

class LpiConfigEditorModal extends Modal {
  private view: LpiView;

  constructor(app: App, view: LpiView) {
    super(app);
    this.view = view;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('mailer-yougile-container');
    contentEl.createEl('h2', { text: '⚙ Редактор конфига отображения' });

    const info = contentEl.createEl('p', { text: 'Конфиг хранится в yourbase/lpi_view_config.json. Изменения применяются после перезагрузки деталей заявки.' });
    info.style.color = 'var(--text-muted)';
    info.style.fontSize = '12px';

    const configJson = JSON.stringify(this.view.viewConfig, null, 2);
    const textarea = contentEl.createEl('textarea');
    textarea.value = configJson;
    textarea.style.cssText = 'width:100%;box-sizing:border-box;min-height:400px;font-family:monospace;font-size:11px;padding:8px;background:var(--background-primary-alt);border:1px solid var(--background-modifier-border);border-radius:4px';

    const btnRow = contentEl.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px';

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    saveBtn.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(textarea.value);
        this.view.viewConfig = parsed;
        const adapter = this.view.app.vault.adapter;
        await adapter.write(CONFIG_PATH, JSON.stringify(parsed, null, 2));
        new Notice('Конфиг сохранён');
        this.close();
      } catch (e: any) {
        new Notice('Ошибка в JSON: ' + e.message);
      }
    });

    const resetBtn = btnRow.createEl('button', { text: '↺ Сбросить на умолчания', cls: 'mailer-yougile-refresh-btn' });
    resetBtn.addEventListener('click', async () => {
      this.view.viewConfig = DEFAULT_CONFIG;
      const adapter = this.view.app.vault.adapter;
      await adapter.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      textarea.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
      new Notice('Конфиг сброшен на умолчания');
    });

    const howTo = contentEl.createEl('details', { attr: { style: 'margin-top:12px' } });
    howTo.createEl('summary', { text: '📖 Как добавить секцию с SQL-запросом', attr: { style: 'cursor:pointer;font-weight:600;font-size:12px' } });
    const howContent = howTo.createDiv();
    howContent.style.cssText = 'padding:8px;font-size:11px;background:var(--background-primary-alt);border-radius:4px;margin-top:4px';
    howContent.innerHTML = `<pre style="margin:0;white-space:pre-wrap">
Добавьте секцию в "detailSections":

{
  "title": "Мои данные",
  "type": "subquery",
  "query": "SELECT * FROM my_table WHERE fk_id = '{{aggregate_id}}'",
  "columns": [
    { "label": "Колонка 1", "field": "col1" }
  ],
  "dependsOn": ["aggregate_id"]
}
</pre>`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

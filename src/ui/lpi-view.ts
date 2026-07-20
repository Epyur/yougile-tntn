import { ItemView, WorkspaceLeaf, Modal, App, Notice, requestUrl } from 'obsidian';
import type YouGilePlugin from '../main';
import type { LpiItem } from '../types/lpi';
import ApexCharts from 'apexcharts';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = 'yourbase/lpi_data.json';

export const LPI_VIEW_TYPE = 'yougile-lpi-view';

type ViewMode = 'table' | 'dashboard' | 'sync';

export class LpiView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private items: LpiItem[] = [];
  private searchQuery = '';
  private searchTimeout: number | null = null;
  private mode: ViewMode = 'table';
  private charts: ApexCharts[] = [];
  private dashboardTimer: number | null = null;
  private selectedProducts: Set<string> = new Set();
  private selectedMethods: Set<string> = new Set();
  private appDateFrom = '';
  private appDateTo = '';
  private protocolDateFrom = '';
  private protocolDateTo = '';
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
          return desc.type === 'lpi_completed' && t.completed;
        } catch { return false; }
      });
      let changed = false;
      for (const task of lpiTasks) {
        const desc = JSON.parse(task.description || '{}');
        const existing = this.items.find(i => i.aggregate_id === desc.aggregate_id);
        if (existing && !existing.completedLocally) {
          existing.completedLocally = true;
          existing.completedAt = desc.completedAt || '';
          existing.taskId = task.id;
          changed = true;
        }
      }
      if (changed) await this.saveData();
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

    const refreshBtn = btnRow.createEl('button', {
      text: '🔄 Обновить',
      cls: 'mailer-yougile-refresh-btn',
    });
    refreshBtn.addEventListener('click', async () => {
      await this.syncFromTasks();
      await this.loadFromSqliteToLocal();
    });

    const dashBtn = btnRow.createEl('button', {
      text: '📊 Дашборд',
      cls: 'mailer-yougile-refresh-btn',
    });
    dashBtn.addEventListener('click', () => { this.mode = 'dashboard'; this.renderView(); });

    const syncBtn = btnRow.createEl('button', {
      text: '📝 Зарегистрировать изменения в БД',
      cls: 'mailer-yougile-refresh-btn',
    });
    syncBtn.addEventListener('click', () => { this.mode = 'sync'; this.renderView(); });

    if (this.mode === 'dashboard') {
      this.renderDashboard(container);
    } else if (this.mode === 'sync') {
      this.renderSync(container);
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
    const headers = ['№ заявки', 'Название материала', 'Дата создания', 'Статус', 'Дата протокола', 'Результат испытания', 'Оценка соответствия'];
    for (const h of headers) {
      const th = headerRow.createEl('th', { cls: 'mailer-th' });
      th.setText(h);
    }

    const tbody = table.createEl('tbody');
    if (filtered.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td', { cls: 'mailer-text-center mailer-p-24' });
      td.setAttr('colspan', '7');
      td.setText('Нет данных');
      return;
    }

    for (const item of filtered) {
      const row = tbody.createEl('tr', { cls: 'mailer-clickable mailer-row-hover' });
      row.addEventListener('click', () => this.renderDetail(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.application_external_id);
      row.createEl('td', { cls: 'mailer-td' }).setText(item.product_name);
      row.createEl('td', { cls: 'mailer-td' }).setText(item.application_created_at);
      const statusCell = row.createEl('td', { cls: 'mailer-td' });
      if (this.isEffectivelyActive(item)) {
        statusCell.style.color = 'var(--text-warning)';
        statusCell.setText(LpiView.statusDisplay(item.application_status));
      } else {
        statusCell.style.color = 'var(--text-success)';
        statusCell.setText('Завершена');
      }
      row.createEl('td', { cls: 'mailer-td' }).setText(this.getProtocolDate(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group || '');
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
    }
  }

  private syncDate = '';
  private syncDiff: { new: LpiItem[]; toComplete: LpiItem[] } | null = null;
  private syncReady = false;

  private renderSync(container: HTMLElement): void {
    container.createEl('h4', { text: 'Регистрация изменений из LIMS' });

    const desc = container.createEl('p', {
      text: 'Загрузка всех записей из таблицы агрегированных результатов. Новые заявки будут созданы в YouGile, завершённые — обновлены.',
    });
    desc.style.fontSize = 'var(--font-smaller)';
    desc.style.opacity = '.7';

    const row = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap mailer-mb-8' });
    row.style.alignItems = 'end';
    row.style.gap = '8px';

    const dateGroup = row.createDiv();
    const dateLbl = dateGroup.createEl('label', { text: 'Фильтр даты протокола (для завершения)' });
    dateLbl.style.fontSize = 'var(--font-smaller)';
    dateLbl.style.marginRight = '4px';
    const dateInput = dateGroup.createEl('input', { attr: { type: 'date' } });
    dateInput.style.fontSize = 'var(--font-smaller)';
    dateInput.style.padding = '2px 4px';
    if (!this.syncDate) this.syncDate = new Date().toISOString().split('T')[0];
    dateInput.value = this.syncDate;
    dateInput.addEventListener('change', () => {
      this.syncDate = dateInput.value;
      this.syncReady = false;
      this.syncDiff = null;
      this.renderView();
    });

    const refreshBtn = row.createEl('button', {
      text: '🔄 Обновить',
      cls: 'mailer-yougile-refresh-btn',
    });
    refreshBtn.addEventListener('click', () => this.loadFromSqliteDiff());

    const sendBtn = row.createEl('button', {
      text: '📤 Отправить',
      cls: 'mailer-yougile-refresh-btn',
    });
    sendBtn.style.marginLeft = '8px';
    if (!this.syncReady || !this.syncDiff || (this.syncDiff.new.length === 0 && this.syncDiff.toComplete.length === 0)) {
      sendBtn.setAttr('disabled', 'true');
      sendBtn.style.opacity = '.5';
    }
    sendBtn.addEventListener('click', () => this.syncChanges());

    if (this.syncDiff) {
      if (this.syncDiff.new.length > 0) {
        container.createEl('h5', { text: `🆕 Новые заявки (${this.syncDiff.new.length})` });
        const table = container.createEl('table', { cls: 'mailer-table' });
        const thead = table.createEl('thead');
        const hr = thead.createEl('tr');
        for (const h of ['№ заявки', 'Продукт', 'Дата создания', 'Статус']) {
          hr.createEl('th', { cls: 'mailer-th' }).setText(h);
        }
        const tbody = table.createEl('tbody');
        for (const item of this.syncDiff.new) {
          const r = tbody.createEl('tr');
          r.createEl('td', { cls: 'mailer-td' }).setText(item.application_external_id);
          r.createEl('td', { cls: 'mailer-td' }).setText(item.product_name);
          r.createEl('td', { cls: 'mailer-td' }).setText(item.application_created_at);
          const sc = r.createEl('td', { cls: 'mailer-td' });
          if (item.protocol_date) {
            sc.style.color = 'var(--text-success)';
            sc.setText('Завершена');
          } else {
            sc.style.color = 'var(--text-warning)';
            sc.setText('Активна');
          }
        }
      }

      if (this.syncDiff.toComplete.length > 0) {
        container.createEl('h5', { text: `✅ Заявки к завершению (${this.syncDiff.toComplete.length})` });
        const table = container.createEl('table', { cls: 'mailer-table' });
        const thead = table.createEl('thead');
        const hr = thead.createEl('tr');
        for (const h of ['№ заявки', 'Продукт', 'Дата создания', 'Дата протокола', 'Результат', 'Оценка']) {
          hr.createEl('th', { cls: 'mailer-th' }).setText(h);
        }
        const tbody = table.createEl('tbody');
        for (const item of this.syncDiff.toComplete) {
          const r = tbody.createEl('tr');
          r.createEl('td', { cls: 'mailer-td' }).setText(item.application_external_id);
          r.createEl('td', { cls: 'mailer-td' }).setText(item.product_name);
          r.createEl('td', { cls: 'mailer-td' }).setText(item.application_created_at);
          r.createEl('td', { cls: 'mailer-td' }).setText(item.protocol_date || '');
          r.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group || '');
          r.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
        }
      }

      if (this.syncDiff.new.length === 0 && this.syncDiff.toComplete.length === 0) {
        container.createEl('p', { text: '✓ Изменений не обнаружено. Локальная БД синхронизирована с LIMS.' });
      }
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
      const sql = `SELECT
        ar.aggregate_id,
        a.external_id AS application_external_id,
        a.created_at AS application_created_at,
        a.status AS application_status,
        COALESCE(p.product_name, '') AS product_name,
        ar.protocol_date,
        ar.agg_gen_group_complience,
        COALESCE(c.customer_name, '') AS customer_name,
        COALESCE(c.customer_email, '') AS customer_mail,
        COALESCE(c.organization, '') AS organization,
        COALESCE(c.customer_tel, '') AS customer_phone,
        COALESCE(c.address, '') AS customer_address,
        COALESCE(p.ekn, '') AS ekn,
        p.thickness,
        COALESCE(p.color, '') AS color,
        COALESCE(o.batch_number, '') AS batch_number,
        COALESCE(o.sample_number, '') AS sample_number,
        COALESCE(o.object_name, '') AS object_name,
        COALESCE(p.standard, '') AS standard,
        COALESCE(p.target_comb_group, '') AS target_comb_group,
        COALESCE(p.target_flam_group, '') AS target_flam_group,
        COALESCE(p.target_prop_group, '') AS target_prop_group,
        COALESCE(m.method_abbreviation, '') AS method_abbreviation,
        COALESCE(m.method_name, '') AS method_name,
        COALESCE(m.method_standard, '') AS method_standard,
        ar.agg_avg_smog_temp,
        ar.agg_smog_group,
        ar.agg_smog_complience,
        ar.agg_mass_loss,
        ar.agg_comb_time,
        ar.agg_dam_length,
        ar.agg_comb_bulb,
        ar.agg_group_by_mass,
        ar.agg_group_by_length,
        ar.agg_croup_by_comb_time,
        ar.agg_group_by_bulbe,
        ar.agg_gen_group,
        ar.agg_mass_complience,
        ar.agg_complience_by_length,
        ar.agg_complience_by_comb_time,
        ar.agg_complience_by_bulbe,
        ar.agg_additional_info_1
      FROM aggregated_results ar
      LEFT JOIN applications a ON ar.application_id = a.application_id
      LEFT JOIN products p ON p.product_id = a.product_id
      LEFT JOIN customers c ON c.customer_id = a.customer_id
      LEFT JOIN objects o ON o.object_id = a.object_id
      LEFT JOIN methods m ON m.method_id = a.method_id`;
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

      // обновляем локальную БД: новые записи добавляем, существующие обновляем
      let added = 0;
      let updated = 0;
      const sqliteIds = new Set(sqliteItems.map(i => i.aggregate_id));
      const localIds = new Set(this.items.map(i => i.aggregate_id));

      for (const item of sqliteItems) {
        const existing = this.items.find(i => i.aggregate_id === item.aggregate_id);
        if (existing) {
          const changed = existing.application_status !== item.application_status
            || existing.protocol_date !== item.protocol_date
            || existing.agg_gen_group_complience !== item.agg_gen_group_complience
            || existing.agg_gen_group !== item.agg_gen_group;
          if (changed) {
            // сохраняем локальные поля (completedLocally, completedAt, taskId)
            const { completedLocally, completedAt, taskId } = existing;
            Object.assign(existing, item);
            existing.completedLocally = completedLocally;
            existing.completedAt = completedAt;
            existing.taskId = taskId;
            updated++;
          }
        } else {
          this.items.push(item);
          added++;
        }
      }

      // удаляем записи, которых больше нет в SQLite
      const before = this.items.length;
      this.items = this.items.filter(i => sqliteIds.has(i.aggregate_id));
      const removed = before - this.items.length;

      await this.saveData();
      new Notice(`LPI: обновлено. Добавлено: ${added}, обновлено: ${updated}, удалено: ${removed}`);
      this.renderView();
    } catch (e: any) {
      new Notice('Ошибка обновления из SQLite: ' + e.message);
    }
  }

  private async loadFromSqliteDiff(): Promise<void> {
    try {
      let dbPath = this.plugin.settings.lpiDbPath;
      if (!dbPath) {
        new Notice('Укажите путь к SQLite БД в настройках LPI');
        return;
      }
      dbPath = dbPath.replace(/\\/g, '/');
      if (!fs.existsSync(dbPath)) {
        console.error('LPI: DB file not found at', dbPath);
        new Notice('Файл БД не найден: ' + dbPath);
        return;
      }
      const wasmBinary = await this.getWasmBinary();
      const SQL = await initSqlJs({ wasmBinary: wasmBinary.slice(0) });
      const dbBuf = fs.readFileSync(dbPath);
      const db = new SQL.Database(new Uint8Array(dbBuf));
      const sql = `SELECT
        ar.aggregate_id,
        a.external_id AS application_external_id,
        a.created_at AS application_created_at,
        a.status AS application_status,
        COALESCE(p.product_name, '') AS product_name,
        ar.protocol_date,
        ar.agg_gen_group_complience,
        COALESCE(c.customer_name, '') AS customer_name,
        COALESCE(c.customer_email, '') AS customer_mail,
        COALESCE(c.organization, '') AS organization,
        COALESCE(c.customer_tel, '') AS customer_phone,
        COALESCE(c.address, '') AS customer_address,
        COALESCE(p.ekn, '') AS ekn,
        p.thickness,
        COALESCE(p.color, '') AS color,
        COALESCE(o.batch_number, '') AS batch_number,
        COALESCE(o.sample_number, '') AS sample_number,
        COALESCE(o.object_name, '') AS object_name,
        COALESCE(p.standard, '') AS standard,
        COALESCE(p.target_comb_group, '') AS target_comb_group,
        COALESCE(p.target_flam_group, '') AS target_flam_group,
        COALESCE(p.target_prop_group, '') AS target_prop_group,
        COALESCE(m.method_abbreviation, '') AS method_abbreviation,
        COALESCE(m.method_name, '') AS method_name,
        COALESCE(m.method_standard, '') AS method_standard,
        ar.agg_avg_smog_temp,
        ar.agg_smog_group,
        ar.agg_smog_complience,
        ar.agg_mass_loss,
        ar.agg_comb_time,
        ar.agg_dam_length,
        ar.agg_comb_bulb,
        ar.agg_group_by_mass,
        ar.agg_group_by_length,
        ar.agg_croup_by_comb_time,
        ar.agg_group_by_bulbe,
        ar.agg_gen_group,
        ar.agg_mass_complience,
        ar.agg_complience_by_length,
        ar.agg_complience_by_comb_time,
        ar.agg_complience_by_bulbe,
        ar.agg_additional_info_1
      FROM aggregated_results ar
      LEFT JOIN applications a ON ar.application_id = a.application_id
      LEFT JOIN products p ON p.product_id = a.product_id
      LEFT JOIN customers c ON c.customer_id = a.customer_id
      LEFT JOIN objects o ON o.object_id = a.object_id
      LEFT JOIN methods m ON m.method_id = a.method_id`;
      const stmt = db.prepare(sql);
      const allSqlite: LpiItem[] = [];
      while (stmt.step()) {
        const obj = stmt.getAsObject();
        obj.thickness = obj.thickness !== null ? Number(obj.thickness) : null;
        obj.source_series_count = null;
        obj.source_series_range = null;
        obj.calculation_type = null;
        obj.result_data = null;
        allSqlite.push(obj as LpiItem);
      }
      stmt.free();
      db.close();

      // diff
      const localIds = new Set(this.items.map(i => i.aggregate_id));
      const newItems = allSqlite.filter(i => !localIds.has(i.aggregate_id));
      const activeLocalIds = new Set(
        this.items.filter(i => LpiView.isStatusActive(i.application_status) && !i.completedLocally).map(i => i.aggregate_id)
      );
      const toComplete = allSqlite.filter(i =>
        activeLocalIds.has(i.aggregate_id) && i.protocol_date && i.protocol_date === this.syncDate
      );
      // filter out toComplete items that were already completed in an older SQLite load
      const alreadyDoneIds = new Set(
        this.items.filter(i => i.completedLocally).map(i => i.aggregate_id)
      );
      const filteredToComplete = toComplete.filter(i => !alreadyDoneIds.has(i.aggregate_id));

      this.syncDiff = { new: newItems, toComplete: filteredToComplete };
      this.syncReady = true;
      this.renderView();
    } catch (e: any) {
      new Notice('Ошибка загрузки из SQLite: ' + e.message);
    }
  }

  private async syncChanges(): Promise<void> {
    try {
      if (!this.syncReady || !this.syncDiff) return;
      const { new: newItems, toComplete } = this.syncDiff;
      let sent = 0;

      for (const item of newItems) {
        if (this.items.find(i => i.aggregate_id === item.aggregate_id)) continue;
        this.items.push(item);
        try {
          if (this.plugin.client) {
            const isActive = LpiView.isStatusActive(item.application_status);
            const desc = JSON.stringify({
              type: 'lpi_completed',
              aggregate_id: item.aggregate_id,
              application_external_id: item.application_external_id,
              product_name: item.product_name,
              completedAt: isActive ? '' : (item.protocol_date || ''),
              protocol_date: item.protocol_date || '',
              agg_gen_group_complience: item.agg_gen_group_complience || '',
              customer_name: item.customer_name || '',
              customer_mail: item.customer_mail || '',
              organization: item.organization || '',
              ekn: item.ekn || '',
            });
            const result: any = await this.plugin.client.createTask({
              title: `LPI: ${item.application_external_id} — ${item.product_name}`,
              description: desc,
              columnId: this.getLpiColumnId(),
            } as any);
            if (result?.id) {
              item.taskId = result.id;
              if (isActive) {
                await this.plugin.client.updateTask(result.id, { completed: false, dateStart: item.application_created_at });
              } else {
                item.completedLocally = true;
                item.completedAt = item.protocol_date || this.syncDate;
                await this.plugin.client.updateTask(result.id, { completed: true, dateStart: item.application_created_at, dateEnd: item.protocol_date || this.syncDate });
              }
            }
          }
        } catch {}
        sent++;
      }

      for (const item of toComplete) {
        const existing = this.items.find(i => i.aggregate_id === item.aggregate_id);
        if (existing) {
          Object.assign(existing, item);
          existing.completedLocally = true;
          existing.completedAt = item.protocol_date || this.syncDate;
        } else {
          item.completedLocally = true;
          item.completedAt = item.protocol_date || this.syncDate;
          this.items.push(item);
        }
        try {
          if (this.plugin.client) {
            if (existing?.taskId) {
              const desc = JSON.stringify({
                type: 'lpi_completed',
                aggregate_id: item.aggregate_id,
                application_external_id: item.application_external_id,
                product_name: item.product_name,
                completedAt: item.protocol_date || this.syncDate,
                protocol_date: item.protocol_date || '',
                agg_gen_group_complience: item.agg_gen_group_complience || '',
                customer_name: item.customer_name || '',
                customer_mail: item.customer_mail || '',
                organization: item.organization || '',
                ekn: item.ekn || '',
              });
              await this.plugin.client.updateTask(existing.taskId, {
                description: desc,
                completed: true,
                dateEnd: item.protocol_date || this.syncDate,
              });
            } else {
              const desc = JSON.stringify({
                type: 'lpi_completed',
                aggregate_id: item.aggregate_id,
                application_external_id: item.application_external_id,
                product_name: item.product_name,
                completedAt: item.protocol_date || this.syncDate,
                protocol_date: item.protocol_date || '',
                agg_gen_group_complience: item.agg_gen_group_complience || '',
                customer_name: item.customer_name || '',
                customer_mail: item.customer_mail || '',
                organization: item.organization || '',
                ekn: item.ekn || '',
              });
              const result: any = await this.plugin.client.createTask({
                title: `LPI: ${item.application_external_id} — ${item.product_name}`,
                description: desc,
                columnId: this.getLpiColumnId(),
              } as any);
              if (result?.id) {
                item.taskId = result.id;
                await this.plugin.client.updateTask(result.id, { completed: true, dateStart: item.application_created_at, dateEnd: item.protocol_date || this.syncDate });
              }
            }
          }
        } catch {}
        sent++;
      }

      await this.saveData();
      this.syncReady = false;
      this.syncDiff = null;
      new Notice(`Синхронизировано ${sent} записей`);
      this.renderView();
    } catch (e: any) {
      new Notice('Ошибка: ' + e.message);
    }
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

  private buildTestResultSeries(items: LpiItem[]): Record<string, unknown> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const val = item.agg_gen_group;
      if (!val) continue;
      counts[val] = (counts[val] || 0) + 1;
    }
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    return {
      chart: { type: 'donut' },
      labels,
      series: data,
      colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'],
      plotOptions: { pie: { donut: { size: '60%' } } },
      tooltip: { enabled: true },
      legend: { position: 'bottom', fontSize: '12px' },
    };
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

  private renderDetail(item: LpiItem): void {
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-mb-12' });

    const addSection = (title: string, pairs: Array<{ label: string; value: unknown; bold?: boolean; color?: (v: string) => string }>) => {
      if (pairs.length === 0) return;
      meta.createEl('h4', { text: title, cls: 'mailer-mt-8' });
      for (const p of pairs) {
        const div = meta.createDiv();
        if (p.bold) div.style.fontWeight = 'bold';
        const val = p.value ?? '—';
        div.textContent = `${p.label}: ${val}`;
        if (p.color && typeof val === 'string') {
          div.style.color = p.color(val);
        }
      }
    };

    const detailFields = [
      { label: '№ заявки', value: item.application_external_id },
      { label: 'Дата создания', value: item.application_created_at },
      { label: 'Статус', value: LpiView.statusDisplay(item.application_status) },
      { label: 'Название материала', value: item.product_name },
      { label: 'Заказчик', value: item.customer_name },
      { label: 'Email заказчика', value: item.customer_mail },
      { label: 'Организация', value: item.organization },
      { label: 'Телефон', value: item.customer_phone },
      { label: 'Адрес', value: item.customer_address },
      { label: 'ЕКН', value: item.ekn },
      { label: 'Толщина', value: item.thickness !== null && item.thickness !== undefined ? `${item.thickness} мм` : null },
      { label: 'Цвет', value: item.color },
      { label: 'Номер партии', value: item.batch_number },
      { label: 'Номер образца', value: item.sample_number },
      { label: 'Объект', value: item.object_name },
      { label: 'Стандарт', value: item.standard },
      { label: 'Целевая группа горючести', value: item.target_comb_group },
      { label: 'Целевая группа воспламеняемости', value: item.target_flam_group },
      { label: 'Целевая группа распространения', value: item.target_prop_group },
      { label: 'Метод испытаний', value: item.method_name },
      { label: 'Дата протокола', value: this.getProtocolDate(item) },
    ];
    addSection('Детали заявки', detailFields);

    addSection('Результаты измерений', [
      { label: 'Средняя температура дыма', value: item.agg_avg_smog_temp ? `${item.agg_avg_smog_temp} °C` : null },
      { label: 'Потеря массы', value: item.agg_mass_loss ? `${item.agg_mass_loss} %` : null },
      { label: 'Время горения', value: item.agg_comb_time ? `${item.agg_comb_time} с` : null },
      { label: 'Длина повреждения', value: item.agg_dam_length ? `${item.agg_dam_length} мм` : null },
      { label: 'Падение горящих капель расплава', value: item.agg_comb_bulb },
    ]);

    addSection('Выводы', [
      { label: 'Результат испытания', value: item.agg_gen_group, bold: true },
      { label: 'Общая оценка соответствия', value: item.agg_gen_group_complience, bold: true, color: v => v === 'Не оценивается' ? 'var(--text-muted)' : v === 'Соответствует' ? 'var(--text-success)' : v === 'Не соответствует' ? 'var(--text-error)' : '' },
      { label: 'Группа по дыму', value: item.agg_smog_group },
      { label: 'Соответствие по дыму', value: item.agg_smog_complience },
      { label: 'Группа по массе', value: item.agg_group_by_mass },
      { label: 'Соответствие по массе', value: item.agg_mass_complience },
      { label: 'Группа по длине', value: item.agg_group_by_length },
      { label: 'Соответствие по длине', value: item.agg_complience_by_length },
      { label: 'Группа по времени горения', value: item.agg_croup_by_comb_time },
      { label: 'Соответствие по времени горения', value: item.agg_complience_by_comb_time },
      { label: 'Группа по горящим каплям', value: item.agg_group_by_bulbe },
      { label: 'Соответствие по горящим каплям', value: item.agg_complience_by_bulbe },
      { label: 'Дополнительная информация', value: item.agg_additional_info_1 },
    ]);
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

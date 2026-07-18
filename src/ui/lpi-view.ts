import { ItemView, WorkspaceLeaf, Modal, App, Notice } from 'obsidian';
import type YouGilePlugin from '../main';
import type { LpiItem } from '../types/lpi';
import ApexCharts from 'apexcharts';

const DB_PATH = 'yourbase/lpi_data.json';

export const LPI_VIEW_TYPE = 'yougile-lpi-view';

type ViewMode = 'table' | 'dashboard' | 'completed';

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
  private appDateFrom = '';
  private appDateTo = '';
  private protocolDateFrom = '';
  private protocolDateTo = '';
  private serialOnly = false;
  private experimentalOnly = false;

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

  private getProtocolDate(item: LpiItem): string {
    if (item.application_status === 'active') return '—';
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

    const dashBtn = btnRow.createEl('button', {
      text: '📊 Дашборд',
      cls: 'mailer-yougile-refresh-btn',
    });
    dashBtn.addEventListener('click', () => { this.mode = 'dashboard'; this.renderView(); });

    const completedBtn = btnRow.createEl('button', {
      text: '✅ Завершённые',
      cls: 'mailer-yougile-refresh-btn',
    });
    completedBtn.addEventListener('click', () => { this.mode = 'completed'; this.renderView(); });

    if (this.mode === 'dashboard') {
      this.renderDashboard(container);
    } else if (this.mode === 'completed') {
      this.renderCompleted(container);
    } else {
      this.renderTable(container);
    }
  }

  private renderTable(container: HTMLElement): void {
    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по № заявки, названию материала...' } });
    searchInput.addClass('mailer-mb-8');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => { this.renderView(); }, 300);
    });

    const q = this.searchQuery.trim().toLowerCase();
    let filtered = this.items;
    if (q) {
      filtered = this.items.filter(item =>
        item.application_external_id.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      const numA = parseInt(a.application_external_id, 10);
      const numB = parseInt(b.application_external_id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
      return b.application_external_id.localeCompare(a.application_external_id);
    });

    const table = container.createEl('table', { cls: 'mailer-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    const headers = ['№ заявки', 'Название материала', 'Дата создания', 'Статус', 'Дата протокола', 'Оценка соответствия'];
    for (const h of headers) {
      const th = headerRow.createEl('th', { cls: 'mailer-th' });
      th.setText(h);
    }

    const tbody = table.createEl('tbody');
    if (filtered.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td', { cls: 'mailer-text-center mailer-p-24' });
      td.setAttr('colspan', '6');
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
      if (item.application_status === 'active') {
        statusCell.style.color = 'var(--text-warning)';
        statusCell.setText('Активна');
      } else {
        statusCell.style.color = 'var(--text-success)';
        statusCell.setText('Завершена');
      }
      row.createEl('td', { cls: 'mailer-td' }).setText(this.getProtocolDate(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
    }
  }

  private renderCompleted(container: HTMLElement): void {
    const entries = this.plugin.lpiDb.getAll();
    container.createEl('h4', { text: `Завершённые заявки (${entries.length})` });
    const table = container.createEl('table', { cls: 'mailer-table' });
    const thead = table.createEl('thead');
    const hr = thead.createEl('tr');
    for (const h of ['№ заявки', 'Продукт', 'Дата завершения', 'Оценка']) {
      hr.createEl('th', { cls: 'mailer-th' }).setText(h);
    }
    const tbody = table.createEl('tbody');
    if (entries.length === 0) {
      const row = tbody.createEl('tr');
      const td = row.createEl('td', { attr: { colspan: '4' }, cls: 'mailer-text-center mailer-p-24' });
      td.setText('Нет завершённых заявок');
      return;
    }
    for (const e of entries) {
      const row = tbody.createEl('tr');
      row.createEl('td', { cls: 'mailer-td' }).setText(e.application_external_id);
      row.createEl('td', { cls: 'mailer-td' }).setText(e.product_name);
      row.createEl('td', { cls: 'mailer-td' }).setText(e.completed_at);
      row.createEl('td', { cls: 'mailer-td' }).setText(e.agg_gen_group_complience);
    }
  }

  private async completeEntry(item: LpiItem): Promise<void> {
    try {
      const now = new Date().toISOString().split('T')[0];
      const entry = {
        id: this.plugin.lpiDb.getNextId(),
        aggregate_id: item.aggregate_id,
        application_external_id: item.application_external_id,
        product_name: item.product_name,
        completed_at: now,
        protocol_date: item.protocol_date || now,
        agg_gen_group_complience: item.agg_gen_group_complience || '',
        customer_name: item.customer_name || '',
        customer_mail: item.customer_mail || '',
        organization: item.organization || '',
        ekn: item.ekn || '',
      };
      try {
        if (this.plugin.client) {
          const desc = JSON.stringify({ type: 'lpi_completed', ...entry });
          const result = await this.plugin.client.createTask({
            title: `LPI: ${item.application_external_id} — ${item.product_name}`,
            description: desc,
            columnId: '',
          } as any);
          if (result?.id) {
            await this.plugin.client.updateTask(result.id, { completed: true });
            (entry as any).taskId = result.id;
          }
        }
      } catch {}
      this.plugin.lpiDb.add(entry);
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

    const availableProducts = [...new Set(allFiltered.map(i => i.product_name))].sort();
    // remove selected products that are no longer in filtered set
    for (const p of this.selectedProducts) {
      if (!availableProducts.includes(p)) this.selectedProducts.delete(p);
    }

    const productBtn = container.createEl('button', {
      text: this.selectedProducts.size > 0 ? `🔽 Продукты (${this.selectedProducts.size})` : '🔽 Выбрать продукты',
      cls: 'mailer-yougile-refresh-btn',
    });
    productBtn.addEventListener('click', () => {
      const modal = new ProductFilterModal(this.app, availableProducts, this.selectedProducts, (selected) => {
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
    const active = filtered.filter(i => i.application_status === 'active').length;
    const completed = filtered.filter(i => i.application_status === 'completed').length;
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
    c2.createEl('h4', { text: 'Заявки по месяцам' });
    this.createChart(c2, this.buildMonthlySeries(filtered));

    const c3 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c3.createEl('h4', { text: 'Общая оценка соответствия' });
    this.createChart(c3, this.buildComplianceSeries(filtered));

    if (this.selectedProducts.size > 1) {
      const c4 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
      c4.createEl('h4', { text: 'Оценка по продуктам' });
      const perProductWrap = c4.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
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
      const c4 = chartRow.createDiv({ attr: { style: 'width:98%;min-width:280px;margin:1%' } });
      c4.createEl('h4', { text: 'Топ продуктов по заявкам' });
      this.createChart(c4, this.buildTopProductsSeries(filtered));
    }

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
    const active = items.filter(i => i.application_status === 'active').length;
    const completed = items.filter(i => i.application_status === 'completed').length;
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

  private buildMonthlySeries(items: LpiItem[]): Record<string, unknown> {
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
      series: [{ name: 'Заявок', data: sorted.map(([, c]) => c) }],
      colors: ['#3b82f6'],
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

    if (item.application_status === 'active') {
      const completeBtn = container.createEl('button', {
        text: '✅ Завершить заявку',
        cls: 'mailer-yougile-refresh-btn',
      });
      completeBtn.style.marginLeft = '8px';
      completeBtn.addEventListener('click', () => this.completeEntry(item));
    }

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const fields: Array<{ label: string; value: unknown }> = [
      { label: 'Название материала', value: item.product_name },
      { label: 'Дата создания заявки', value: item.application_created_at },
      { label: 'Статус', value: item.application_status === 'active' ? 'Активна' : 'Завершена' },
      { label: 'Дата протокола', value: this.getProtocolDate(item) || null },
      { label: 'Оценка соответствия', value: item.agg_gen_group_complience },
      { label: 'Заказчик', value: item.customer_name },
      { label: 'Email заказчика', value: item.customer_mail },
      { label: 'Организация', value: item.organization },
      { label: 'Телефон', value: item.customer_phone },
      { label: 'Адрес', value: item.customer_address },
      { label: 'ЕКН', value: item.ekn },
      { label: 'Толщина', value: item.thickness !== null ? `${item.thickness} мм` : null },
      { label: 'Цвет', value: item.color },
      { label: 'Номер партии', value: item.batch_number },
      { label: 'Номер образца', value: item.sample_number },
      { label: 'Объект', value: item.object_name },
      { label: 'Стандарт', value: item.standard },
      { label: 'Целевая группа горючести', value: item.target_comb_group },
      { label: 'Целевая группа воспламеняемости', value: item.target_flam_group },
      { label: 'Целевая группа распространения', value: item.target_prop_group },
      { label: 'Метод испытаний', value: item.method_name },
      { label: 'Средняя температура дыма', value: item.agg_avg_smog_temp ? `${item.agg_avg_smog_temp} °C` : null },
      { label: 'Группа по дыму', value: item.agg_smog_group },
      { label: 'Соответствие по дыму', value: item.agg_smog_complience },
      { label: 'Потеря массы', value: item.agg_mass_loss ? `${item.agg_mass_loss} %` : null },
      { label: 'Время горения', value: item.agg_comb_time ? `${item.agg_comb_time} с` : null },
      { label: 'Длина повреждения', value: item.agg_dam_length ? `${item.agg_dam_length} мм` : null },
      { label: 'Воспламенение ватки', value: item.agg_comb_bulb },
      { label: 'Группа по массе', value: item.agg_group_by_mass },
      { label: 'Группа по длине', value: item.agg_group_by_length },
      { label: 'Группа по времени горения', value: item.agg_croup_by_comb_time },
      { label: 'Группа по ватке', value: item.agg_group_by_bulbe },
      { label: 'Общая группа горючести', value: item.agg_gen_group },
      { label: 'Соответствие по массе', value: item.agg_mass_complience },
      { label: 'Соответствие по длине', value: item.agg_complience_by_length },
      { label: 'Соответствие по времени горения', value: item.agg_complience_by_comb_time },
      { label: 'Соответствие по ватке', value: item.agg_complience_by_bulbe },
      { label: 'Дополнительная информация', value: item.agg_additional_info_1 },
    ];

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-mb-12' });
    for (const field of fields) {
      if (field.value === null || field.value === undefined || field.value === '') continue;
      meta.createDiv({ text: `${field.label}: ${field.value}` });
    }
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

    const listContainer = contentEl.createDiv();
    listContainer.style.maxHeight = '400px';
    listContainer.style.overflowY = 'auto';

    const renderList = () => {
      listContainer.empty();
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allProducts.filter(p => p.toLowerCase().includes(q)) : this.allProducts;
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

    const btnRow = contentEl.createDiv({ cls: 'mailer-yougile-header mailer-mt-8' });
    const selectAllBtn = btnRow.createEl('button', { text: 'Выбрать все', cls: 'mailer-yougile-refresh-btn' });
    selectAllBtn.addEventListener('click', () => {
      const q = searchInput.value.trim().toLowerCase();
      const filtered = q ? this.allProducts.filter(p => p.toLowerCase().includes(q)) : this.allProducts;
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

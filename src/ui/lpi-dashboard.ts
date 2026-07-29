import type { LpiItem } from '../types/lpi';
import ApexCharts from 'apexcharts';
import type { LpiView } from './lpi-view';
import { ProductFilterModal, MethodFilterModal } from './lpi-modals';
import { isCompleted, getMethodDisplayName } from './lpi-utils';

export class LpiDashboard {
  private view: LpiView;
  charts: ApexCharts[] = [];
  private dashboardTimer: number | null = null;

  constructor(view: LpiView) {
    this.view = view;
  }

  destroy(): void {
    if (this.dashboardTimer) { clearTimeout(this.dashboardTimer); this.dashboardTimer = null; }
    for (const c of this.charts) { try { c.destroy(); } catch {} }
    this.charts = [];
  }

  render(container: HTMLElement, items: LpiItem[]): void {
    this.destroy();
    container.empty();
    this.renderFilterRow(container, items);
    const filtered = this.view.applyFilters(items);
    this.renderMetrics(container, filtered);
    this.renderCharts(container, filtered);
  }

  private renderFilterRow(container: HTMLElement, allItems: LpiItem[]): void {
    const v = this.view;
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
      inp.addEventListener('change', () => { onChange(inp.value); this.render(container, allItems); });
      return inp;
    };
    addDateFilter('Дата создания с', v.appDateFrom, val => v.appDateFrom = val);
    addDateFilter('по', v.appDateTo, val => v.appDateTo = val);
    addDateFilter('Дата протокола с', v.protocolDateFrom, val => v.protocolDateFrom = val);
    addDateFilter('по', v.protocolDateTo, val => v.protocolDateTo = val);

    const addCb = (label: string, checked: boolean, onChange: (ch: boolean) => void) => {
      const group = filterRow.createDiv({ attr: { style: 'display:flex;align-items:center;margin-left:8px' } });
      const cb = group.createEl('input', { attr: { type: 'checkbox' } });
      cb.style.width = '16px';
      cb.style.height = '16px';
      cb.style.margin = '0 4px 0 0';
      cb.checked = checked;
      cb.addEventListener('change', () => { onChange(cb.checked); this.render(container, allItems); });
      const lbl = group.createEl('label', { text: label });
      lbl.style.fontSize = 'var(--font-smaller)';
    };
    addCb('Серийная продукция', v.serialOnly, val => v.serialOnly = val);
    addCb('Опытная продукция', v.experimentalOnly, val => v.experimentalOnly = val);

    const allFiltered = v.applyFilters(allItems);
    const allProducts = [...new Set(allItems.map(i => i.product_name))].sort();
    for (const p of v.selectedProducts) {
      if (!allProducts.includes(p)) v.selectedProducts.delete(p);
    }
    const allMethods = [...new Set(allItems.filter(i => i.method_abbreviation).map(i => i.method_abbreviation!))].sort();
    for (const m of v.selectedMethods) {
      if (!allMethods.includes(m)) v.selectedMethods.delete(m);
    }

    const methodBtn = container.createEl('button', {
      text: v.selectedMethods.size > 0 ? `🔬 ${[...v.selectedMethods].map(m => getMethodDisplayName(m)).join(', ')}` : '🔬 Подтверждаемый показатель',
      cls: 'mailer-yougile-refresh-btn',
    });
    methodBtn.style.marginLeft = '8px';
    methodBtn.addEventListener('click', () => {
      const modal = new MethodFilterModal(v.app, allMethods, v.selectedMethods, (selected: Set<string>) => {
        v.selectedMethods = selected;
        this.render(container, allItems);
      });
      modal.open();
    });
    if (v.selectedMethods.size > 0) {
      const clearM = container.createEl('button', { text: '✕', cls: 'mailer-yougile-refresh-btn' });
      clearM.style.marginLeft = '4px';
      clearM.addEventListener('click', () => {
        v.selectedMethods.clear();
        this.render(container, allItems);
      });
    }

    const productBtn = container.createEl('button', {
      text: v.selectedProducts.size > 0 ? `🔽 Продукты (${v.selectedProducts.size})` : '🔽 Выбрать продукты',
      cls: 'mailer-yougile-refresh-btn',
    });
    productBtn.style.marginLeft = '8px';
    productBtn.addEventListener('click', () => {
      const modal = new ProductFilterModal(v.app, allProducts, v.selectedProducts, (selected: Set<string>) => {
        v.selectedProducts = selected;
        this.render(container, allItems);
      });
      modal.open();
    });

    if (v.selectedProducts.size > 0) {
      const clearBtn = container.createEl('button', { text: '✕ Сбросить', cls: 'mailer-yougile-refresh-btn' });
      clearBtn.style.marginLeft = '8px';
      clearBtn.addEventListener('click', () => {
        v.selectedProducts.clear();
        this.render(container, allItems);
      });
    }
  }

  private renderMetrics(container: HTMLElement, items: LpiItem[]): void {
    const total = items.length;
    const active = items.filter(i => !isCompleted(i)).length;
    const completed = items.filter(i => isCompleted(i)).length;

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
    addMetric('С протоколом', completed);
  }

  private renderCharts(container: HTMLElement, items: LpiItem[]): void {
    const v = this.view;
    const chartRow = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    const c1 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c1.createEl('h4', { text: 'Статус заявок' });
    this.createChart(c1, this.buildStatusSeries(items));

    const c2 = chartRow.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c2.createEl('h4', { text: 'Поступление заявок по месяцам' });
    this.createChart(c2, this.buildIncomingMonthlySeries(items));

    const chartRow2 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    const c3 = chartRow2.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c3.createEl('h4', { text: 'Завершение заявок по месяцам' });
    this.createChart(c3, this.buildCompletedMonthlySeries(items));

    const c4 = chartRow2.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c4.createEl('h4', { text: 'Общая оценка соответствия' });
    this.createChart(c4, this.buildComplianceSeries(items));

    const chartRow3 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });

    if (v.selectedProducts.size > 1) {
      const c5 = chartRow3.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
      c5.createEl('h4', { text: 'Оценка по продуктам' });
      const perProductWrap = c5.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
      const c6 = chartRow3.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
      c6.createEl('h4', { text: 'Результаты испытаний по продуктам' });
      const perProductTestWrap = c6.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
      const products = [...v.selectedProducts].sort();
      for (const product of products) {
        const productItems = items.filter(i => i.product_name === product);
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
      this.createChart(c5, this.buildTopProductsSeries(items));
    }

    const chartRow4 = container.createDiv({ cls: 'mailer-flex-row mailer-flex-wrap' });
    const c6 = chartRow4.createDiv({ attr: { style: 'width:48%;min-width:280px;margin:1%' } });
    c6.createEl('h4', { text: 'Результаты испытания' });
    this.createChart(c6, this.buildTestResultSeries(items));

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
    const active = items.filter(i => !isCompleted(i)).length;
    const completed = items.filter(i => isCompleted(i)).length;
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
}

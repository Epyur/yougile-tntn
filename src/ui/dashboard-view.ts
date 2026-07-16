import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CachedTask } from '../types/cache';
import ApexCharts from 'apexcharts';

export const DASHBOARD_VIEW_TYPE = 'yougile-dashboard-view';

export class DashboardView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private selectedProjectId = '';
  private selectedColumnId = '';
  private selectedAssigneeId = '';
  private dateFrom = '';
  private dateTo = '';
  private charts: ApexCharts[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: YouGilePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return 'Дашборд'; }
  getIcon(): string { return 'bar-chart'; }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.addClass('mailer-yougile-container');
    this.containerElContent = container.createDiv();
    this.renderView();
  }

  onClose(): void {
    this.destroyCharts();
  }

  private destroyCharts(): void {
    for (const chart of this.charts) {
      chart.destroy();
    }
    this.charts = [];
  }

  private getFilteredTasks(): CachedTask[] {
    let tasks = this.plugin.db.getTasks();
    if (this.selectedProjectId) {
      tasks = tasks.filter(t => t.projectId === this.selectedProjectId);
    }
    if (this.selectedColumnId) {
      tasks = tasks.filter(t => t.columnId === this.selectedColumnId);
    }
    if (this.selectedAssigneeId) {
      tasks = tasks.filter(t => Array.isArray(t.assigned) && t.assigned.includes(this.selectedAssigneeId));
    }
    if (this.dateFrom) {
      const from = new Date(this.dateFrom);
      from.setHours(0, 0, 0, 0);
      tasks = tasks.filter(t => t.timestamp >= from.getTime());
    }
    if (this.dateTo) {
      const to = new Date(this.dateTo);
      to.setHours(23, 59, 59, 999);
      tasks = tasks.filter(t => t.timestamp <= to.getTime());
    }
    return tasks;
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();
    this.destroyCharts();

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '📊 Дашборд' });
    const refreshBtn = header.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());

    const filterRow = container.createDiv();
    filterRow.style.display = 'flex';
    filterRow.style.alignItems = 'center';
    filterRow.style.gap = '8px';
    filterRow.style.marginBottom = '12px';
    filterRow.style.flexWrap = 'wrap';

    const projects = this.plugin.db.getProjects();
    const allTasks = this.plugin.db.getTasks();
    const projectTasks = this.selectedProjectId ? allTasks.filter(t => t.projectId === this.selectedProjectId) : allTasks;

    filterRow.createSpan({ text: 'Проект:' });
    const projectSelect = filterRow.createEl('select');
    projectSelect.style.width = '160px';
    projectSelect.createEl('option', { value: '', text: '— все —' });
    for (const p of projects) {
      projectSelect.createEl('option', { value: p.id, text: p.title });
    }
    projectSelect.value = this.selectedProjectId;
    projectSelect.addEventListener('change', () => {
      this.selectedProjectId = projectSelect.value;
      this.selectedColumnId = '';
      this.renderView();
    });

    const boards = this.plugin.db.getBoards().filter(b => !this.selectedProjectId || b.projectId === this.selectedProjectId);
    const allCols = this.plugin.db.getColumns().filter(c => boards.some(b => b.id === c.boardId));
    filterRow.createSpan({ text: 'Колонка:' });
    const columnSelect = filterRow.createEl('select');
    columnSelect.style.width = '160px';
    columnSelect.createEl('option', { value: '', text: '— все —' });
    for (const c of allCols) {
      columnSelect.createEl('option', { value: c.id, text: c.title });
    }
    columnSelect.value = this.selectedColumnId;
    columnSelect.addEventListener('change', () => {
      this.selectedColumnId = columnSelect.value;
      this.renderView();
    });

    const allAssignees = [...new Set(allTasks.flatMap(t => t.assigned || []))].filter(Boolean).sort();
    filterRow.createSpan({ text: 'Исполнитель:' });
    const assigneeSelect = filterRow.createEl('select');
    assigneeSelect.style.width = '160px';
    assigneeSelect.createEl('option', { value: '', text: '— все —' });
    for (const a of allAssignees) {
      const name = this.plugin.db.getUserName(a);
      assigneeSelect.createEl('option', { value: a, text: name });
    }
    assigneeSelect.value = this.selectedAssigneeId;
    assigneeSelect.addEventListener('change', () => {
      this.selectedAssigneeId = assigneeSelect.value;
      this.renderView();
    });

    let dateFilterTimeout: number | null = null;
    const applyDateFilter = () => {
      if (dateFilterTimeout) clearTimeout(dateFilterTimeout);
      dateFilterTimeout = window.setTimeout(() => this.renderView(), 600);
    };

    filterRow.createSpan({ text: 'с' });
    const dateFromInput = filterRow.createEl('input', { attr: { type: 'date' } });
    dateFromInput.style.width = '130px';
    dateFromInput.value = this.dateFrom;
    dateFromInput.addEventListener('input', () => { this.dateFrom = dateFromInput.value; applyDateFilter(); });

    filterRow.createSpan({ text: 'по' });
    const dateToInput = filterRow.createEl('input', { attr: { type: 'date' } });
    dateToInput.style.width = '130px';
    dateToInput.value = this.dateTo;
    dateToInput.addEventListener('input', () => { this.dateTo = dateToInput.value; applyDateFilter(); });

    const exportJpgBtn = filterRow.createEl('button', { text: '📸 JPG', cls: 'mailer-yougile-refresh-btn' });
    exportJpgBtn.addEventListener('click', () => this.exportAllCharts());
    const exportCsvBtn = filterRow.createEl('button', { text: '📊 CSV', cls: 'mailer-yougile-refresh-btn' });
    exportCsvBtn.addEventListener('click', () => this.exportCsv());

    const tasks = this.getFilteredTasks();
    this.renderMetricCards(container, tasks);
    this.renderCharts(container, tasks);
  }

  private renderMetricCards(container: HTMLElement, tasks: CachedTask[]): void {
    const total = tasks.length;
    const overdue = tasks.filter(t => !t.completed && t.deadline && t.deadline < Date.now()).length;
    const completed = tasks.filter(t => t.completed).length;
    const withDeadline = tasks.filter(t => t.deadline).length;

    const cardsRow = container.createDiv();
    cardsRow.style.display = 'grid';
    cardsRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
    cardsRow.style.gap = '12px';
    cardsRow.style.marginBottom = '20px';

    const items = [
      { label: 'Всего задач', value: total, color: 'var(--text-normal)' },
      { label: 'Просрочено', value: overdue, color: '#e74c3c' },
      { label: 'Завершено', value: completed, color: '#2ecc71' },
      { label: 'С дедлайном', value: withDeadline, color: '#3498db' },
    ];

    for (const m of items) {
      const card = cardsRow.createDiv();
      card.style.cssText = 'background:var(--background-primary-alt);border-radius:8px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1)';
      const v = card.createEl('div');
      v.style.cssText = `font-size:32px;font-weight:bold;color:${m.color}`;
      v.setText(String(m.value));
      const l = card.createDiv();
      l.style.cssText = 'font-size:var(--font-smaller);margin-top:4px;color:var(--text-muted)';
      l.setText(m.label);
    }
  }

  private chartBox(container: HTMLElement, title: string, chartIdx: number): { box: HTMLElement; el: HTMLElement } {
    const box = container.createDiv();
    box.style.cssText = 'background:var(--background-primary-alt);border-radius:8px;padding:12px;position:relative';

    const titleRow = box.createDiv();
    titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';

    const titleEl = titleRow.createDiv();
    titleEl.style.cssText = 'font-weight:bold;font-size:var(--font-ui-small)';
    titleEl.setText(title);

    const dlBtn = titleRow.createEl('button', { text: '💾', cls: 'mailer-yougile-refresh-btn' });
    dlBtn.style.cssText = 'font-size:12px;padding:2px 6px';
    const curIdx = this.charts.length;
    dlBtn.addEventListener('click', async () => {
      const chart = this.charts[curIdx];
      if (chart) {
        await this.exportSingleChart(chart, title);
      }
    });
    // push placeholder, will be set after chart creation
    this.charts.push(null as unknown as ApexCharts);

    const el = box.createDiv();
    return { box, el };
  }

  private renderCharts(container: HTMLElement, tasks: CachedTask[]): void {
    const grid = container.createDiv();
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px';

    // Chart 1: Tasks by column (donut)
    const columnCount = new Map<string, number>();
    for (const t of tasks) {
      const key = t.columnTitle || 'Без колонки';
      columnCount.set(key, (columnCount.get(key) || 0) + 1);
    }
    const colLabels = [...columnCount.keys()];
    const colValues = [...columnCount.values()];

    const c1 = this.chartBox(grid, 'Задачи по колонкам', 0);
    // Chart 2: Status (horizontal bar)
    const completedCount = tasks.filter(t => t.completed).length;
    const activeCount = tasks.length - completedCount;
    const c2 = this.chartBox(grid, 'Статус задач', 1);

    // Chart 3: Tasks per day (area)
    const now = new Date();
    const dayCount = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayCount.set(d.toLocaleDateString(), 0);
    }
    for (const t of tasks) {
      const key = new Date(t.timestamp).toLocaleDateString();
      if (dayCount.has(key)) dayCount.set(key, (dayCount.get(key) || 0) + 1);
    }
    const dayLabels = [...dayCount.keys()];
    const dayValues = [...dayCount.values()];
    const c3 = this.chartBox(grid, 'Создано задач по дням (30 дней)', 2);

    // Chart 4: Deadline distribution
    const dt = tasks.filter(t => t.deadline);
    const overdue = dt.filter(t => !t.completed && t.deadline! < Date.now()).length;
    const week = dt.filter(t => !t.completed && t.deadline! >= Date.now() && t.deadline! < Date.now() + 7 * 86400000).length;
    const month = dt.filter(t => !t.completed && t.deadline! >= Date.now() + 7 * 86400000).length;
    const done = dt.filter(t => t.completed).length;
    const c4 = this.chartBox(grid, 'Дедлайны', 3);

    const isDark = document.body.classList.contains('theme-dark');
    const textColor = isDark ? '#ccc' : '#333';
    const gridColor = isDark ? '#333' : '#e0e0e0';

    const fontSmall = isDark ? '#aaa' : '#666';

    setTimeout(() => {
      try {
        const chartOpts: Partial<ApexCharts> = {
          chart: { type: 'donut', height: 240, foreColor: textColor, toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } } },
          labels: colLabels,
          series: colValues,
          colors: ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'],
          plotOptions: { pie: { donut: { size: '55%' } } },
          dataLabels: { enabled: false },
          legend: { position: 'bottom', fontSize: '12px', labels: { colors: textColor } },
          tooltip: { y: { formatter: (v: number) => `${v} задач` } },
          responsive: [{ breakpoint: 480, options: { chart: { height: 200 }, legend: { position: 'bottom' } } }],
        };
        if (colLabels.length > 0) {
          const chart1 = new ApexCharts(c1.el, chartOpts);
          chart1.render();
          this.charts[0] = chart1;
        }

        const chart2 = new ApexCharts(c2.el, {
          chart: { type: 'bar', height: 240, foreColor: textColor, toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } } },
          series: [{ data: [activeCount, completedCount] }],
          xaxis: { categories: ['В работе', 'Завершено'], labels: { style: { colors: textColor, fontSize: '12px' } } },
          colors: ['#3498db', '#2ecc71'],
          plotOptions: { bar: { horizontal: true, barHeight: '50%' } },
          dataLabels: { enabled: true, style: { fontSize: '12px', colors: [textColor] } },
          tooltip: { y: { formatter: (v: number) => `${v} задач` } },
        });
        chart2.render();
        this.charts[1] = chart2;

        const chart3 = new ApexCharts(c3.el, {
          chart: { type: 'area', height: 240, foreColor: textColor, toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } }, zoom: { enabled: false } },
          series: [{ name: 'Задачи', data: dayValues }],
          xaxis: { categories: dayLabels, labels: { rotate: -45, style: { colors: textColor, fontSize: '9px' } } },
          yaxis: { forceNiceScale: true, labels: { style: { colors: textColor }, formatter: (v: number) => Math.floor(v).toString() } },
          colors: ['#3498db'],
          fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3 } },
          stroke: { curve: 'smooth', width: 2 },
          dataLabels: { enabled: false },
          grid: { borderColor: gridColor },
          tooltip: { y: { formatter: (v: number) => `${Math.floor(v)} задач` } },
        });
        chart3.render();
        this.charts[2] = chart3;

        const chart4 = new ApexCharts(c4.el, {
          chart: { type: 'bar', height: 240, foreColor: textColor, toolbar: { show: true, tools: { download: true, selection: false, zoom: false, zoomin: false, zoomout: false, pan: false, reset: false } } },
          series: [{ data: [overdue, week, month, done] }],
          xaxis: { categories: ['Просрочено', '7 дней', 'В месяце', 'Выполнено'], labels: { style: { colors: textColor, fontSize: '11px' } } },
          colors: ['#e74c3c', '#f39c12', '#3498db', '#2ecc71'],
          plotOptions: { bar: { horizontal: false, columnWidth: '60%' } },
          dataLabels: { enabled: true, style: { fontSize: '12px', colors: [textColor] } },
          tooltip: { y: { formatter: (v: number) => `${v} задач` } },
        });
        chart4.render();
        this.charts[3] = chart4;
      } catch (e) {
        console.error('Dashboard chart error:', e);
      }
    }, 100);
  }

  private async exportSingleChart(chart: ApexCharts, name: string): Promise<void> {
    try {
      const result = await chart.dataURI({ scale: 5 });
      const pngData = result.imgURI;
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { new Notice('❌ Ошибка canvas'); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const jpgData = canvas.toDataURL('image/jpeg', 0.92);
        const link = document.createElement('a');
        link.download = `${name.replace(/[^a-zа-яё0-9_\- ]/gi, '_')}.jpg`;
        link.href = jpgData;
        link.click();
        new Notice(`✅ Экспортирован: ${name}.jpg`);
      };
      img.src = pngData;
    } catch (e) {
      new Notice(`❌ Ошибка экспорта: ${e}`);
    }
  }

  private async exportAllCharts(): Promise<void> {
    new Notice(`📸 Экспорт ${this.charts.filter(Boolean).length} графиков...`);
    for (let i = 0; i < this.charts.length; i++) {
      const chart = this.charts[i];
      if (!chart) continue;
      const names = ['Задачи по колонкам', 'Статус задач', 'Задачи по дням', 'Дедлайны'];
      await this.exportSingleChart(chart, names[i] || `Chart ${i + 1}`);
    }
  }

  private async exportCsv(): Promise<void> {
    const tasks = this.getFilteredTasks();
    const sep = ';';
    const esc = (s: string | undefined | null): string => {
      if (!s) return '';
      const str = String(s);
      if (str.includes(sep) || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const headers = ['Название', 'Колонка', 'Проект', 'Доска', 'Исполнители', 'Статус', 'Дедлайн', 'Создана'];
    const rows: string[] = [headers.join(sep)];
    for (const t of tasks) {
      const assignees = (t.assigned || []).map(a => this.plugin.db.getUserName(a)).join(', ');
      const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleDateString() : '';
      const createdStr = new Date(t.timestamp).toLocaleDateString();
      rows.push([
        esc(t.title),
        esc(t.columnTitle),
        esc(t.projectTitle),
        esc(t.boardTitle),
        esc(assignees),
        t.completed ? 'Завершено' : 'В работе',
        deadlineStr,
        createdStr,
      ].join(sep));
    }
    const folderPath = 'Экспорт';
    const adapter = this.plugin.app.vault.adapter;
    if (!await adapter.exists(folderPath)) {
      await this.plugin.app.vault.createFolder(folderPath);
    }
    const safeName = `Дашборд_${new Date().toISOString().slice(0, 10)}`;
    let filePath = `${folderPath}/${safeName}.csv`;
    let counter = 1;
    while (await adapter.exists(filePath)) {
      filePath = `${folderPath}/${safeName}_${counter}.csv`;
      counter++;
    }
    const data = new TextEncoder().encode('\uFEFF' + rows.join('\r\n'));
    await adapter.writeBinary(filePath, data.buffer as ArrayBuffer);
    new Notice(`✅ CSV экспорт: ${filePath}`);
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      await this.plugin.app.workspace.getLeaf().openFile(file);
    }
  }

  async syncAndRender(): Promise<void> {
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      new Notice('Настройте API ключ в настройках плагина');
      return;
    }
    await this.plugin.db.sync();
    this.plugin.emailDb.syncFromTasks(this.plugin.db.getTasks());
    this.renderView();
  }
}

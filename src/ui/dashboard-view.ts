import { ItemView, Notice, WorkspaceLeaf, TFile } from 'obsidian';
import type YouGilePlugin from '../main';
import type { CachedTask } from '../types/cache';
import ApexCharts from 'apexcharts';
import type { ApexOptions, XAxisAnnotations } from 'apexcharts';
import { errorMessage } from '../utils/errors';

export const DASHBOARD_VIEW_TYPE = 'yougile-dashboard-view';

export class DashboardView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private selectedProjectId = '';
  private selectedBoardId = '';
  private selectedColumnId = '';
  private selectedAssigneeId = '';
  private dateFrom = '';
  private dateTo = '';
  private includeSubtasks = false;
  private showDeadlines = true;
  private charts: ApexCharts[] = [];
  private renderTimeoutId: number | null = null;

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

  async onClose(): Promise<void> {
    this.cancelRender();
    this.destroyCharts();
  }

  private cancelRender(): void {
    if (this.renderTimeoutId !== null) {
      clearTimeout(this.renderTimeoutId);
      this.renderTimeoutId = null;
    }
  }

  private destroyCharts(): void {
    for (const chart of this.charts) {
      if (chart) chart.destroy();
    }
    this.charts = [];
  }

  private getFilteredTasks(topLevelOnly: boolean): CachedTask[] {
    let tasks = this.plugin.db.getTasks();
    if (topLevelOnly) {
      const subtaskIds = new Set<string>();
      for (const t of tasks) {
        for (const s of t.subtasks) {
          subtaskIds.add(s.id);
        }
      }
      tasks = tasks.filter(t => !subtaskIds.has(t.id));
    }
    if (this.selectedProjectId) {
      tasks = tasks.filter(t => t.projectId === this.selectedProjectId);
    }
    if (this.selectedBoardId) {
      tasks = tasks.filter(t => t.boardId === this.selectedBoardId);
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
      tasks = tasks.filter(t =>
        t.timestamp >= from.getTime() ||
        (t.completed && t.completeAt !== undefined && t.completeAt >= from.getTime())
      );
    }
    if (this.dateTo) {
      const to = new Date(this.dateTo);
      to.setHours(23, 59, 59, 999);
      tasks = tasks.filter(t =>
        t.timestamp <= to.getTime() ||
        (t.completed && t.completeAt !== undefined && t.completeAt <= to.getTime())
      );
    }
    return tasks;
  }

  private renderView(): void {
    this.cancelRender();
    const container = this.containerElContent;
    container.empty();
    this.destroyCharts();

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '📊 Дашборд' });
    const refreshBtn = header.createEl('button', { text: '🔄', cls: 'mailer-yougile-refresh-btn' });
    refreshBtn.addEventListener('click', () => this.syncAndRender());

    const filterRow = container.createDiv({ cls: 'mailer-yougile-header mailer-mb-8' });

    const projects = this.plugin.db.getProjects();
    const allTasks = this.plugin.db.getTasks();

    const fgStyle = 'display:flex;flex-direction:column;margin-right:8px';
    const fLabelStyle = 'font-size:var(--font-smaller);margin-bottom:2px';

    const projectGroup = filterRow.createDiv();
    projectGroup.style.cssText = fgStyle;
    projectGroup.createEl('label', { text: 'Проект' }).style.cssText = fLabelStyle;
    const projectSelect = projectGroup.createEl('select');
    projectSelect.addClass('dropdown');
    projectSelect.createEl('option', { value: '', text: '— все —' });
    for (const p of projects) {
      projectSelect.createEl('option', { value: p.id, text: p.title });
    }
    projectSelect.value = this.selectedProjectId;
    projectSelect.addEventListener('change', () => {
      this.selectedProjectId = projectSelect.value;
      this.selectedBoardId = '';
      this.selectedColumnId = '';
      this.renderView();
    });

    const boardGroup = filterRow.createDiv();
    boardGroup.style.cssText = fgStyle;
    boardGroup.createEl('label', { text: 'Доска' }).style.cssText = fLabelStyle;
    const boards = this.plugin.db.getBoards().filter(b => !this.selectedProjectId || b.projectId === this.selectedProjectId);
    const boardSelect = boardGroup.createEl('select');
    boardSelect.addClass('dropdown');
    boardSelect.createEl('option', { value: '', text: '— все —' });
    for (const b of boards) {
      boardSelect.createEl('option', { value: b.id, text: b.title });
    }
    boardSelect.value = this.selectedBoardId;
    boardSelect.addEventListener('change', () => {
      this.selectedBoardId = boardSelect.value;
      this.selectedColumnId = '';
      this.renderView();
    });

    const colGroup = filterRow.createDiv();
    colGroup.style.cssText = fgStyle;
    colGroup.createEl('label', { text: 'Колонка' }).style.cssText = fLabelStyle;
    const allCols = this.plugin.db.getColumns().filter(c => !this.selectedBoardId || c.boardId === this.selectedBoardId);
    const columnSelect = colGroup.createEl('select');
    columnSelect.addClass('dropdown');
    columnSelect.createEl('option', { value: '', text: '— все —' });
    for (const c of allCols) {
      columnSelect.createEl('option', { value: c.id, text: c.title });
    }
    columnSelect.value = this.selectedColumnId;
    columnSelect.addEventListener('change', () => {
      this.selectedColumnId = columnSelect.value;
      this.renderView();
    });

    const assigneeGroup = filterRow.createDiv();
    assigneeGroup.style.cssText = fgStyle;
    assigneeGroup.createEl('label', { text: 'Исполнитель' }).style.cssText = fLabelStyle;
    const allAssignees = [...new Set(allTasks.flatMap(t => t.assigned || []))].filter(Boolean).sort();
    const assigneeSelect = assigneeGroup.createEl('select');
    assigneeSelect.addClass('dropdown');
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

    const dateGroup = filterRow.createDiv();
    dateGroup.style.cssText = fgStyle;
    dateGroup.createEl('label', { text: 'Даты' }).style.cssText = fLabelStyle;
    const dateInner = dateGroup.createDiv();
    dateInner.style.display = 'flex';
    dateInner.style.alignItems = 'center';
    dateInner.style.gap = '4px';
    let dateFilterTimeout: number | null = null;
    const applyDateFilter = () => {
      if (dateFilterTimeout) clearTimeout(dateFilterTimeout);
      dateFilterTimeout = window.setTimeout(() => this.renderView(), 600);
    };

    dateInner.createSpan({ text: 'с' });
    const dateFromInput = dateInner.createEl('input', { attr: { type: 'date' } });
    dateFromInput.style.width = '130px';
    dateFromInput.value = this.dateFrom;
    dateFromInput.addEventListener('input', () => { this.dateFrom = dateFromInput.value; applyDateFilter(); });

    dateInner.createSpan({ text: 'по' });
    const dateToInput = dateInner.createEl('input', { attr: { type: 'date' } });
    dateToInput.style.width = '130px';
    dateToInput.value = this.dateTo;
    dateToInput.addEventListener('input', () => { this.dateTo = dateToInput.value; applyDateFilter(); });

    const exportJpgBtn = filterRow.createEl('button', { text: '📸 JPG', cls: 'mailer-yougile-refresh-btn' });
    exportJpgBtn.addEventListener('click', () => this.exportAllCharts());
    const exportCsvBtn = filterRow.createEl('button', { text: '📊 CSV', cls: 'mailer-yougile-refresh-btn' });
    exportCsvBtn.addEventListener('click', () => this.exportCsv());

    const subtaskWrapper = filterRow.createDiv();
    subtaskWrapper.style.display = 'inline-flex';
    subtaskWrapper.style.alignItems = 'center';
    subtaskWrapper.style.marginRight = '12px';
    subtaskWrapper.style.marginTop = '4px';
    subtaskWrapper.style.fontSize = 'var(--font-smaller)';
    subtaskWrapper.style.cursor = 'pointer';
    subtaskWrapper.style.whiteSpace = 'nowrap';
    const subtaskCb = subtaskWrapper.createEl('input', { attr: { type: 'checkbox' } });
    subtaskCb.style.width = '16px';
    subtaskCb.style.height = '16px';
    subtaskCb.style.margin = '0 4px 0 0';
    subtaskCb.style.flexShrink = '0';
    subtaskCb.checked = this.includeSubtasks;
    subtaskCb.addEventListener('change', () => {
      this.includeSubtasks = subtaskCb.checked;
      this.renderView();
    });
    const subtaskSpan = subtaskWrapper.createEl('span');
    subtaskSpan.setText('Учитывать подзадачи');

    const deadlineWrapper = filterRow.createDiv();
    deadlineWrapper.style.display = 'inline-flex';
    deadlineWrapper.style.alignItems = 'center';
    deadlineWrapper.style.marginRight = '12px';
    deadlineWrapper.style.marginTop = '4px';
    deadlineWrapper.style.fontSize = 'var(--font-smaller)';
    deadlineWrapper.style.cursor = 'pointer';
    deadlineWrapper.style.whiteSpace = 'nowrap';
    const deadlineCb = deadlineWrapper.createEl('input', { attr: { type: 'checkbox' } });
    deadlineCb.style.width = '16px';
    deadlineCb.style.height = '16px';
    deadlineCb.style.margin = '0 4px 0 0';
    deadlineCb.style.flexShrink = '0';
    deadlineCb.checked = this.showDeadlines;
    deadlineCb.addEventListener('change', () => {
      this.showDeadlines = deadlineCb.checked;
      this.renderView();
    });
    const deadlineSpan = deadlineWrapper.createEl('span');
    deadlineSpan.setText('Показать дедлайны');

    const tasks = this.getFilteredTasks(!this.includeSubtasks);
    this.renderMetricCards(container, tasks);
    this.renderCharts(container, tasks);
  }

  private renderMetricCards(container: HTMLElement, tasks: CachedTask[]): void {
    const total = tasks.length;
    const overdue = tasks.filter(t => !t.completed && t.deadline && t.deadline < Date.now()).length;
    const completed = tasks.filter(t => t.completed).length;
    const withDeadline = tasks.filter(t => t.deadline).length;

    const cardsRow = container.createDiv({ cls: 'mailer-cards-grid' });

    const items = [
      { label: 'Всего задач', value: total, color: 'var(--text-normal)' },
      { label: 'Просрочено', value: overdue, color: '#e74c3c' },
      { label: 'Завершено', value: completed, color: '#2ecc71' },
      { label: 'С дедлайном', value: withDeadline, color: '#3498db' },
    ];

    for (const m of items) {
      const card = cardsRow.createDiv();
      card.addClass('mailer-card');
      const v = card.createEl('div');
      v.addClass('mailer-card-value');
      v.style.color = m.color;
      v.setText(String(m.value));
      const l = card.createDiv();
      l.addClass('mailer-card-label');
      l.setText(m.label);
    }
  }

  private chartBox(container: HTMLElement, title: string): { box: HTMLElement; el: HTMLElement } {
    const box = container.createDiv({ cls: 'mailer-chart-box' });

    const titleRow = box.createDiv({ cls: 'mailer-chart-title-row' });

    const titleEl = titleRow.createDiv({ cls: 'mailer-chart-title' });
    titleEl.setText(title);

    const dlBtn = titleRow.createEl('button', { text: '💾', cls: 'mailer-yougile-refresh-btn' });
    dlBtn.addClass('mailer-dl-btn');
    const curIdx = this.charts.length;
    this.charts.push(null as unknown as ApexCharts);
    dlBtn.addEventListener('click', async () => {
      const chart = this.charts[curIdx];
      if (chart) {
        await this.exportSingleChart(chart, title);
      }
    });

    const el = box.createDiv();
    return { box, el };
  }

  private renderCharts(container: HTMLElement, tasks: CachedTask[]): void {
    const grid = container.createDiv({ cls: 'mailer-chart-grid' });

    // Chart 1: Tasks by column (donut)
    const columnCount = new Map<string, number>();
    for (const t of tasks) {
      const key = t.columnTitle || 'Без колонки';
      columnCount.set(key, (columnCount.get(key) || 0) + 1);
    }
    const colLabels = [...columnCount.keys()];
    const colValues = [...columnCount.values()];

    const c1 = this.chartBox(grid, 'Задачи по колонкам');
    // Chart 2: Status (horizontal bar)
    const completedCount = tasks.filter(t => t.completed).length;
    const activeCount = tasks.length - completedCount;
    const c2 = this.chartBox(grid, 'Статус задач');

    // Chart 3: Tasks per day (area)
    const dayCreatedCount = new Map<string, number>();
    const dayCompletedCount = new Map<string, number>();
    if (this.dateFrom || this.dateTo) {
      const from = this.dateFrom ? new Date(this.dateFrom) : new Date(Date.now() - 30 * 86400000);
      const to = this.dateTo ? new Date(this.dateTo) : new Date();
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dayCreatedCount.set(d.toLocaleDateString(), 0);
        dayCompletedCount.set(d.toLocaleDateString(), 0);
      }
    } else {
      const allTasks = this.plugin.db.getTasks();
      const minTs = allTasks.reduce((m, t) => Math.min(m, t.timestamp), Infinity);
      const from = new Date(isFinite(minTs) ? minTs : Date.now());
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      to.setHours(23, 59, 59, 999);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dayCreatedCount.set(d.toLocaleDateString(), 0);
        dayCompletedCount.set(d.toLocaleDateString(), 0);
      }
    }
    for (const t of tasks) {
      const key = new Date(t.timestamp).toLocaleDateString();
      if (dayCreatedCount.has(key)) dayCreatedCount.set(key, (dayCreatedCount.get(key) || 0) + 1);
      if (t.completed) {
        const cKey = new Date(t.completeAt ?? t.timestamp).toLocaleDateString();
        if (dayCompletedCount.has(cKey)) dayCompletedCount.set(cKey, (dayCompletedCount.get(cKey) || 0) + 1);
      }
    }
    const dayLabels = [...dayCreatedCount.keys()];
    const dayCreatedValues = [...dayCreatedCount.values()];
    const dayCompletedValues = [...dayCompletedCount.values()];

    // collect deadline dates within chart range for annotations
    const deadlineDates = new Set<string>();
    if (this.showDeadlines) {
      for (const t of tasks) {
        if (t.deadline && dayCreatedCount.has(new Date(t.deadline).toLocaleDateString())) {
          deadlineDates.add(new Date(t.deadline).toLocaleDateString());
        }
      }
    }
    const deadlineAnnotations: XAxisAnnotations[] = [...deadlineDates].map(d => ({
      x: d,
      strokeDashArray: 4,
      borderColor: '#e74c3c',
    }));

    const c3 = this.chartBox(grid, 'Динамика озадачивания');

    // Chart 4: Deadline distribution
    const dt = tasks.filter(t => t.deadline);
    const overdue = dt.filter(t => !t.completed && t.deadline! < Date.now()).length;
    const week = dt.filter(t => !t.completed && t.deadline! >= Date.now() && t.deadline! < Date.now() + 7 * 86400000).length;
    const month = dt.filter(t => !t.completed && t.deadline! >= Date.now() + 7 * 86400000).length;
    const done = dt.filter(t => t.completed).length;
    const c4 = this.chartBox(grid, 'Дедлайны');

    const isDark = document.body.classList.contains('theme-dark');
    const textColor = isDark ? '#ccc' : '#333';
    const gridColor = isDark ? '#333' : '#e0e0e0';

    const fontSmall = isDark ? '#aaa' : '#666';

    this.renderTimeoutId = window.setTimeout(() => {
      this.renderTimeoutId = null;
      try {
        const chartOpts: ApexOptions = {
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
          series: [
            { name: 'Поступило задач', data: dayCreatedValues },
            { name: 'Задач решено', data: dayCompletedValues },
          ],
          xaxis: { categories: dayLabels, labels: { rotate: -45, style: { colors: textColor, fontSize: '9px' } } },
          yaxis: { forceNiceScale: true, labels: { style: { colors: textColor }, formatter: (v: number) => Math.floor(v).toString() } },
          colors: ['#3498db', '#2ecc71'],
          fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.3 } },
          stroke: { curve: 'smooth', width: 2 },
          dataLabels: { enabled: false },
          grid: { borderColor: gridColor },
          annotations: { xaxis: deadlineAnnotations },
          tooltip: { y: { formatter: (v: number) => `${Math.floor(v)} задач` } },
          legend: { position: 'bottom', fontSize: '12px', labels: { colors: textColor } },
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
      } catch (e: unknown) {
        console.error('Dashboard chart error:', e);
      }
    }, 100);
  }

  private async exportSingleChart(chart: ApexCharts, name: string): Promise<void> {
    try {
      const result = await chart.dataURI({ scale: 5 });
      if (!('imgURI' in result)) {
        new Notice('❌ График вернул неподдерживаемый формат изображения');
        return;
      }
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
    } catch (e: unknown) {
      new Notice(`❌ Ошибка экспорта: ${errorMessage(e)}`);
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
    const tasks = this.getFilteredTasks(!this.includeSubtasks);
    const sep = ';';
    const esc = (s: string | undefined | null): string => {
      if (!s) return '';
      const str = String(s);
      if (str.includes(sep) || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const headers = ['Название', 'Колонка', 'Проект', 'Доска', 'Исполнители', 'Статус', 'Дедлайн', 'Создана', 'Завершена'];
    const rows: string[] = [headers.join(sep)];
    for (const t of tasks) {
      const assignees = (t.assigned || []).map(a => this.plugin.db.getUserName(a)).join(', ');
      const deadlineStr = t.deadline ? new Date(t.deadline).toLocaleDateString() : '';
      const createdStr = new Date(t.timestamp).toLocaleDateString();
      const completeStr = t.completed && t.completeAt ? new Date(t.completeAt).toLocaleDateString() : '';
      rows.push([
        esc(t.title),
        esc(t.columnTitle),
        esc(t.projectTitle),
        esc(t.boardTitle),
        esc(assignees),
        t.completed ? 'Завершено' : 'В работе',
        deadlineStr,
        createdStr,
        completeStr,
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
    if (file instanceof TFile) {
      await this.plugin.app.workspace.getLeaf().openFile(file);
    }
  }

  async syncAndRender(): Promise<void> {
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      new Notice('Настройте API ключ в настройках плагина');
      return;
    }
    await this.plugin.db.sync();
    await this.plugin.emailDb.syncFromTasks(this.plugin.db.getTasks());
    this.renderView();
  }
}

import { Modal, App } from 'obsidian';
import { LpiSchemaService, type SchemaDb, type TableDef, type ColumnDef, type ForeignKeyDef } from '../services/lpi-schema-service';

export class LpiSchemaModal extends Modal {
  private schemaService: LpiSchemaService;
  private dbPath: string;
  private schema: SchemaDb | null = null;
  private selectedTable: TableDef | null = null;
  private searchQuery = '';

  constructor(app: App, schemaService: LpiSchemaService, dbPath: string) {
    super(app);
    this.schemaService = schemaService;
    this.dbPath = dbPath;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.addClass('mailer-yougile-container');
    contentEl.createEl('h3', { text: '📐 Схема базы данных LIMS' });

    const loading = contentEl.createDiv({ text: 'Загрузка схемы...' });
    loading.style.margin = '12px 0';
    loading.style.color = 'var(--text-muted)';

    try {
      this.schema = await this.schemaService.loadSchema(this.dbPath);
      loading.remove();
      this.render();
    } catch (e: any) {
      loading.textContent = 'Ошибка загрузки схемы: ' + e.message;
      loading.style.color = 'var(--text-error)';
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: '📐 Схема базы данных LIMS' });

    const main = contentEl.createDiv();
    main.style.display = 'flex';
    main.style.gap = '12px';
    main.style.height = '70vh';

    const left = main.createDiv();
    left.style.width = '300px';
    left.style.minWidth = '200px';
    left.style.overflowY = 'auto';
    left.style.borderRight = '1px solid var(--background-modifier-border)';
    left.style.paddingRight = '8px';

    const searchInput = left.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск таблицы...' } });
    searchInput.style.width = '100%';
    searchInput.style.marginBottom = '8px';
    searchInput.style.boxSizing = 'border-box';
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderTableList(left);
    });

    const tableList = left.createDiv();
    this.renderTableList(tableList);

    const right = main.createDiv();
    right.style.flex = '1';
    right.style.overflowY = 'auto';
    right.style.paddingLeft = '8px';

    if (this.selectedTable) {
      this.renderTableDetail(right, this.selectedTable);
    } else {
      right.createEl('p', { text: 'Выберите таблицу слева', attr: { style: 'color:var(--text-muted);margin-top:40px;text-align:center' } });
    }
  }

  private renderTableList(container: HTMLElement): void {
    container.empty();
    if (!this.schema) return;

    const filtered = this.searchQuery
      ? this.schema.tables.filter(t => t.name.toLowerCase().includes(this.searchQuery))
      : this.schema.tables;

    for (const table of filtered) {
      const btn = container.createEl('button', { text: table.name, cls: 'mailer-yougile-refresh-btn' });
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.marginBottom = '4px';
      btn.style.padding = '4px 8px';
      btn.style.fontSize = '12px';
      btn.style.overflow = 'hidden';
      btn.style.textOverflow = 'ellipsis';
      if (this.selectedTable?.name === table.name) {
        btn.style.background = 'var(--interactive-accent)';
        btn.style.color = 'var(--text-on-accent)';
      }
      btn.addEventListener('click', () => {
        this.selectedTable = table;
        this.render();
      });
    }

    if (filtered.length === 0) {
      container.createEl('p', { text: 'Таблицы не найдены', attr: { style: 'color:var(--text-muted);font-size:12px' } });
    }
  }

  private renderTableDetail(container: HTMLElement, table: TableDef): void {
    container.empty();

    const header = container.createDiv();
    header.style.marginBottom = '12px';

    header.createEl('h4', { text: table.name, attr: { style: 'margin:0 0 4px 0' } });

    const copyBtn = header.createEl('button', { text: '📋 Копировать CREATE TABLE', cls: 'mailer-yougile-refresh-btn' });
    copyBtn.style.fontSize = '11px';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(table.sql);
    });

    // Columns section
    container.createEl('h5', { text: 'Колонки', attr: { style: 'margin:8px 0 4px 0' } });
    const colTable = container.createEl('table');
    colTable.style.width = '100%';
    colTable.style.borderCollapse = 'collapse';
    colTable.style.fontSize = '12px';

    const colHead = colTable.createEl('thead');
    const colHr = colHead.createEl('tr');
    for (const h of ['#', 'Колонка', 'Тип', 'PK', 'NOT NULL', 'По умолч.']) {
      colHr.createEl('th', { text: h }).style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:3px 6px;text-align:left;white-space:nowrap;font-size:11px';
    }

    const colBody = colTable.createEl('tbody');
    for (const col of table.columns) {
      const row = colBody.createEl('tr');
      row.createEl('td', { text: String(col.cid) }).style.cssText = 'padding:2px 6px;color:var(--text-muted)';
      const nameTd = row.createEl('td', { text: col.name });
      nameTd.style.cssText = 'padding:2px 6px;font-weight:600';
      if (col.pk) nameTd.style.color = 'var(--text-accent)';
      row.createEl('td', { text: col.type || '—' }).style.cssText = 'padding:2px 6px;color:var(--text-muted)';
      row.createEl('td', { text: col.pk ? '🔑' : '' }).style.cssText = 'padding:2px 6px;text-align:center';
      row.createEl('td', { text: col.notnull ? '✓' : '' }).style.cssText = 'padding:2px 6px;text-align:center';
      row.createEl('td', { text: col.dflt_value || '—' }).style.cssText = 'padding:2px 6px;color:var(--text-muted)';
    }

    // Foreign keys section
    if (table.foreignKeys.length > 0) {
      container.createEl('h5', { text: 'Внешние ключи (FK)', attr: { style: 'margin:12px 0 4px 0' } });
      for (const fk of table.foreignKeys) {
        const fkDiv = container.createDiv();
        fkDiv.style.cssText = 'padding:4px 8px;margin:2px 0;background:var(--background-modifier-hover);border-radius:4px;font-size:12px';
        fkDiv.innerHTML = `<span style="font-weight:600">${table.name}.${fk.from}</span> → <span style="color:var(--text-accent);font-weight:600">${fk.table}.${fk.to}</span>`;
      }
    }

    // Sample query builder
    container.createEl('h5', { text: 'Быстрый запрос', attr: { style: 'margin:12px 0 4px 0' } });

    const queryHint = container.createDiv();
    queryHint.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:4px';
    queryHint.textContent = '{{placeholder}} подставляется из текущей заявки в деталях. Сначала получите application_id через external_id.';

    const queryBox = container.createEl('textarea');
    queryBox.style.cssText = 'width:100%;box-sizing:border-box;padding:6px;font-family:monospace;font-size:11px;min-height:80px;background:var(--background-primary-alt);border:1px solid var(--background-modifier-border);border-radius:4px';
    queryBox.readOnly = true;

    const selectAllColumns = table.columns.map(c => c.name).join(',\n  ');

    const hasAppIdFk = table.foreignKeys.some(fk => fk.table === 'applications' && fk.to === 'application_id');
    const otherFks = table.foreignKeys.filter(fk => !(fk.table === 'applications' && fk.to === 'application_id'));

    let query = '';
    if (hasAppIdFk) {
      const appIdFk = table.foreignKeys.find(fk => fk.table === 'applications' && fk.to === 'application_id')!;
      query = `-- 1. Получить application_id по номеру заявки:\n-- SELECT application_id FROM applications WHERE external_id = '{{application_external_id}}';\n\n-- 2. Запрос данных:\nSELECT\n  ${selectAllColumns}\nFROM ${table.name}\nWHERE ${appIdFk.from} = '{{application_id}}'`;
    } else if (table.name === 'applications') {
      query = `SELECT\n  ${selectAllColumns}\nFROM ${table.name}\nWHERE external_id = '{{application_external_id}}'`;
    } else if (otherFks.length > 0) {
      const whereClauses = otherFks.map(fk => `  ${fk.from} = '{{value}}'`).join('\n  OR ');
      query = `SELECT\n  ${selectAllColumns}\nFROM ${table.name}\nWHERE (\n${whereClauses}\n)`;
    } else {
      query = `SELECT\n  ${selectAllColumns}\nFROM ${table.name}\nLIMIT 100`;
    }
    queryBox.value = query;

    const copyQueryBtn = container.createEl('button', { text: '📋 Копировать запрос', cls: 'mailer-yougile-refresh-btn' });
    copyQueryBtn.style.fontSize = '11px';
    copyQueryBtn.style.marginTop = '4px';
    copyQueryBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(queryBox.value);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

import { Notice } from 'obsidian';
import type { LpiItem } from '../types/lpi';
import type { DetailSectionDef, FieldSectionDef, SubquerySectionDef } from '../types/lpi-config';
import type { LpiView } from './lpi-view';
import { LpiConfigEditorModal } from './lpi-modals';
import { isCompleted } from './lpi-utils';

export class LpiDetail {
  private view: LpiView;

  constructor(view: LpiView) {
    this.view = view;
  }

  async render(container: HTMLElement, item: LpiItem): Promise<void> {
    container.empty();

    const btnRow = container.createDiv();
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.marginBottom = '8px';
    btnRow.style.flexWrap = 'wrap';

    const backBtn = btnRow.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.view.renderView());

    const sqlConnected = !!this.view.plugin.settings.lpiDbPath;
    const sendBtn = btnRow.createEl('button', {
      text: '📤 Отправить в YouGile',
      cls: 'mailer-yougile-refresh-btn',
    });
    sendBtn.disabled = !sqlConnected;
    if (!sqlConnected) {
      sendBtn.title = 'Укажите путь к SQLite БД в настройках LPI';
    }
    sendBtn.addEventListener('click', async () => {
      if (!this.view.plugin.client) {
        new Notice('Нет подключения к YouGile');
        return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Отправка...';
      try {
        await this.view.sync.syncItemToYougile(item);
        await this.view.saveData();
        new Notice(`Заявка №${item.application_external_id} отправлена в YouGile`);
      } catch (e: any) {
        new Notice('Ошибка: ' + e.message);
      }
      sendBtn.disabled = false;
      sendBtn.textContent = '📤 Отправить в YouGile';
    });

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    const colorRules = this.view.viewConfig.colorRules || {};

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
      const dbPath = this.view.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
      if (!dbPath) return;
      const { existsSync } = await import('fs');
      if (!existsSync(dbPath)) return;
      let query = section.query;
      for (const key of section.dependsOn) {
        const val = (item as any)[key];
        if (val !== null && val !== undefined) {
          query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
        }
      }
      try {
        const result = await this.view.schemaService.runQuery(dbPath, query);
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

    for (const section of this.view.viewConfig.detailSections) {
      if (section.type === 'fields') {
        renderFieldSection(section);
      } else if (section.type === 'subquery') {
        await renderSubquerySection(section);
      }
    }

    this.renderQueryRunner(container, item);
  }

  private renderQueryRunner(container: HTMLElement, item: LpiItem): void {
    const dbPath = this.view.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
    if (!dbPath) return;

    const details = container.createEl('details', { attr: { style: 'margin-top:16px' } });
    details.createEl('summary', { text: '🔍 SQL Запрос', attr: { style: 'cursor:pointer;font-weight:600;font-size:13px' } });

    const qContainer = details.createDiv();
    qContainer.style.cssText = 'padding:8px;background:var(--background-primary-alt);border-radius:6px;margin-top:8px';

    const tableSelRow = qContainer.createDiv();
    tableSelRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';

    const tableSel = tableSelRow.createEl('select');
    tableSel.style.cssText = 'flex:1;font-size:12px;padding:4px';
    tableSel.createEl('option', { text: '— Выберите таблицу —', value: '' });

    this.view.schemaService.loadSchema(dbPath).then(schema => {
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
      this.view.schemaService.loadSchema(dbPath).then(schema => {
        const table = schema.byName.get(tableName);
        if (!table) return;
        const cols = table.columns.map(c => c.name).join(',\n  ');
        const hasAppIdFk = table.foreignKeys.some(fk => fk.table === 'applications' && fk.to === 'application_id');
        const otherFks = table.foreignKeys.filter(fk => !(fk.table === 'applications' && fk.to === 'application_id'));
        let query = '';
        if (hasAppIdFk) {
          query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE application_id = '{{application_id}}'\nLIMIT 50`;
        } else if (tableName === 'applications') {
          query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE external_id = '{{application_external_id}}'\nLIMIT 50`;
        } else if (otherFks.length > 0) {
          const fkWhere = otherFks.map(fk => `${fk.from} = '{{${fk.from}}}'`).join('\n  OR ');
          query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE (\n  ${fkWhere}\n)\nLIMIT 50`;
        } else {
          query = `SELECT\n  ${cols}\nFROM ${tableName}\nLIMIT 100`;
        }
        sqlInput.value = query;
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
      const placeholderKeys = ['aggregate_id', 'application_id', 'application_external_id', 'product_name'];
      for (const key of placeholderKeys) {
        const val = (item as any)[key];
        if (val !== null && val !== undefined) {
          query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
        }
      }
      resultDiv.empty();
      runBtn.textContent = '⏳';
      runBtn.disabled = true;
      try {
        const result = await this.view.schemaService.runQuery(dbPath, query);
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
            dependsOn: ['aggregate_id', 'application_id', 'application_external_id'],
          };
          this.view.viewConfig.detailSections.push(newSection);
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
      new LpiConfigEditorModal(this.view).open();
    });
  }
}

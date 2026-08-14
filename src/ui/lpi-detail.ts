import { Notice } from 'obsidian';
import type { LpiItem } from '../types/lpi';
import type { FieldSectionDef, SubquerySectionDef } from '../types/lpi-config';
import type { LpiView } from './lpi-view';
import { LpiConfigEditorModal } from './lpi-modals';
import { getLpiField, setLpiField } from './lpi-utils';
import { errorMessage } from '../utils/errors';

/** Описание редактируемого поля в деталях заявки. */
interface EditFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'textarea';
  options?: string[];
}

export class LpiDetail {
  private view: LpiView;
  private editFieldsConfig: EditFieldDef[] = [
    { key: 'protocol_date', label: 'Дата протокола', type: 'date' },
    { key: 'product_name', label: 'Название материала', type: 'text' },
    { key: 'customer_name', label: 'Заказчик', type: 'text' },
    { key: 'customer_mail', label: 'Email заказчика', type: 'text' },
    { key: 'organization', label: 'Организация', type: 'text' },
    { key: 'customer_phone', label: 'Телефон', type: 'text' },
    { key: 'customer_address', label: 'Адрес', type: 'text' },
    { key: 'ekn', label: 'ЕКН', type: 'text' },
    { key: 'thickness', label: 'Толщина', type: 'text' },
    { key: 'color', label: 'Цвет', type: 'text' },
    { key: 'batch_number', label: 'Номер партии', type: 'text' },
    { key: 'sample_number', label: 'Номер образца', type: 'text' },
    { key: 'object_name', label: 'Объект', type: 'text' },
    { key: 'standard', label: 'Стандарт', type: 'text' },
    { key: 'target_comb_group', label: 'Целевая группа горючести', type: 'text' },
    { key: 'target_flam_group', label: 'Целевая группа воспламеняемости', type: 'text' },
    { key: 'target_prop_group', label: 'Целевая группа распространения', type: 'text' },
    { key: 'method_name', label: 'Метод испытаний', type: 'text' },
    { key: 'agg_gen_group', label: 'Результат испытания', type: 'text' },
    { key: 'agg_gen_group_complience', label: 'Оценка соответствия', type: 'select', options: ['', 'Соответствует', 'Не соответствует', 'Не оценивается'] },
    { key: 'agg_avg_smog_temp', label: 'Средняя температура дыма (°C)', type: 'text' },
    { key: 'agg_mass_loss', label: 'Потеря массы (%)', type: 'text' },
    { key: 'agg_comb_time', label: 'Время горения (с)', type: 'text' },
    { key: 'agg_dam_length', label: 'Длина повреждения (мм)', type: 'text' },
    { key: 'agg_comb_bulb', label: 'Падение горящих капель расплава', type: 'text' },
    { key: 'agg_smog_group', label: 'Группа по дыму', type: 'text' },
    { key: 'agg_smog_complience', label: 'Соответствие по дыму', type: 'text' },
    { key: 'agg_group_by_mass', label: 'Группа по массе', type: 'text' },
    { key: 'agg_mass_complience', label: 'Соответствие по массе', type: 'text' },
    { key: 'agg_group_by_length', label: 'Группа по длине', type: 'text' },
    { key: 'agg_complience_by_length', label: 'Соответствие по длине', type: 'text' },
    { key: 'agg_croup_by_comb_time', label: 'Группа по времени горения', type: 'text' },
    { key: 'agg_complience_by_comb_time', label: 'Соответствие по времени горения', type: 'text' },
    { key: 'agg_group_by_bulbe', label: 'Группа по горящим каплям', type: 'text' },
    { key: 'agg_complience_by_bulbe', label: 'Соответствие по горящим каплям', type: 'text' },
    { key: 'agg_additional_info_1', label: 'Дополнительная информация', type: 'textarea' },
  ];

  constructor(view: LpiView) {
    this.view = view;
  }

  async render(container: HTMLElement, item: LpiItem): Promise<void> {
    container.empty();
    const sqlConnected = !!this.view.plugin.settings.lpiDbPath;
    let editing = false;
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};

    const btnRow = container.createDiv();
    btnRow.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap';

    const backBtn = btnRow.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.view.renderView());

    const sendBtn = btnRow.createEl('button', { text: '📤 Отправить в YouGile', cls: 'mailer-yougile-refresh-btn' });
    sendBtn.disabled = !sqlConnected;
    if (!sqlConnected) sendBtn.title = 'Укажите путь к SQLite БД в настройках LPI';
    sendBtn.addEventListener('click', async () => {
      if (!this.view.plugin.client) { new Notice('Нет подключения к YouGile'); return; }
      sendBtn.disabled = true; sendBtn.textContent = '⏳ Отправка...';
      try {
        await this.view.sync.syncItemToYougile(item);
        await this.view.saveData();
        new Notice(`Заявка №${item.application_external_id} отправлена в YouGile`);
      } catch (e: unknown) { new Notice('Ошибка: ' + errorMessage(e)); }
      sendBtn.disabled = false; sendBtn.textContent = '📤 Отправить в YouGile';
    });

    const saveBtn = btnRow.createEl('button', { text: '💾 Сохранить', cls: 'mailer-yougile-refresh-btn' });
    saveBtn.style.display = 'none';
    const cancelEditBtn = btnRow.createEl('button', { text: 'Отмена', cls: 'mailer-yougile-refresh-btn' });
    cancelEditBtn.style.display = 'none';

    const editBtn = btnRow.createEl('button', { text: '✏ Редактировать', cls: 'mailer-yougile-refresh-btn' });
    if (!sqlConnected) editBtn.style.display = 'none';

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta' });
    const colorRules = this.view.viewConfig.colorRules || {};

    const renderFieldSection = (section: FieldSectionDef) => {
      if (section.fields.length === 0) return;
      meta.createEl('h4', { text: section.title, cls: 'mailer-mt-8' });
      for (const f of section.fields) {
        if (f.visibleIf) {
          const targetVal = getLpiField(item, f.visibleIf.field);
          if (f.visibleIf.notNull && (targetVal === null || targetVal === undefined || targetVal === '')) continue;
          if (f.visibleIf.equals !== undefined && String(targetVal) !== f.visibleIf.equals) continue;
        }
        const raw = getLpiField(item, f.field);
        const isMissing = raw === null || raw === undefined || raw === '';
        let display = isMissing ? '—' : String(raw);
        if (f.format && !isMissing && f.field !== 'protocol_date') display = f.format.replace('{value}', display);

        const efc = this.editFieldsConfig.find(e => e.key === f.field);
        if (efc && sqlConnected) {
          const row = meta.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' } });
          const lbl = row.createEl('span', { text: f.label + ':', attr: { style: 'min-width:240px;font-size:var(--font-smaller);font-weight:' + (f.bold ? 'bold' : 'normal') } });
          const inp = this.createInput(efc, display === '—' ? '' : display, !editing);
          row.appendChild(inp);
          inputs[f.field] = inp;
          if (f.colorRuleId && !isMissing && raw) {
            const ruleSet = colorRules[f.colorRuleId];
            if (ruleSet) {
              const match = ruleSet.rules.find(r => r.match === raw);
              if (match) inp.style.color = match.color;
            }
          }
        } else {
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
      }
    };

    const renderSubquerySection = async (section: SubquerySectionDef) => {
      const dbPath = this.view.plugin.settings.lpiDbPath?.replace(/\\/g, '/');
      if (!dbPath) return;
      const fs = await import('fs');
      if (!fs.existsSync(dbPath)) return;
      let query = section.query;
      for (const key of section.dependsOn) {
        const val = getLpiField(item, key);
        if (val !== null && val !== undefined) query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
      }
      try {
        const result = await this.view.schemaService.runQuery(dbPath, query);
        if (result.columns.length === 0) return;
        meta.createEl('h4', { text: section.title, cls: 'mailer-mt-8' });
        const subTable = meta.createEl('table');
        subTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;margin-top:4px';
        const subHr = subTable.createEl('thead').createEl('tr');
        for (const col of section.columns) {
          subHr.createEl('th', { text: col.label }).style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:3px 6px;text-align:left;white-space:nowrap';
        }
        const subBody = subTable.createEl('tbody');
        for (const row of result.rows) {
          const tr = subBody.createEl('tr');
          for (const col of section.columns) {
            const colIdx = result.columns.indexOf(col.field);
            const raw = colIdx >= 0 ? row[colIdx] : null;
            const isMissing = raw === null || raw === undefined || raw === '';
            let display = isMissing ? '—' : String(raw);
            if (col.format && !isMissing) display = col.format.replace('{value}', display);
            tr.createEl('td', { text: display }).style.cssText = 'padding:2px 6px;border-bottom:1px solid var(--background-modifier-border)';
          }
        }
      } catch (e: unknown) {
        console.error(`LPI: не удалось выполнить подзапрос секции «${section.title}»:`, errorMessage(e));
      }
    };

    for (const section of this.view.viewConfig.detailSections) {
      if (section.type === 'fields') renderFieldSection(section);
      else if (section.type === 'subquery') await renderSubquerySection(section);
    }

    this.renderQueryRunner(container, item);

    // Toggle edit mode
    const toggleEdit = (enable: boolean) => {
      editing = enable;
      for (const ef of this.editFieldsConfig) {
        const inp = inputs[ef.key];
        if (!inp) continue;
        inp.disabled = !enable;
        if (inp instanceof HTMLInputElement || inp instanceof HTMLTextAreaElement) {
          inp.readOnly = !enable;
        }
      }
      editBtn.style.display = enable ? 'none' : (sqlConnected ? '' : 'none');
      saveBtn.style.display = enable ? '' : 'none';
      cancelEditBtn.style.display = enable ? '' : 'none';
    };

    editBtn.addEventListener('click', () => toggleEdit(true));

    cancelEditBtn.addEventListener('click', () => {
      // Reset values
      void this.render(container, item);
    });

    saveBtn.addEventListener('click', async () => {
      const changedKeys: string[] = [];
      for (const ef of this.editFieldsConfig) {
        const inp = inputs[ef.key];
        if (!inp) continue;
        let newVal = inp.value.trim();
        const oldVal = String(getLpiField(item, ef.key) ?? '');
        if (ef.type === 'date' && newVal) {
          // Convert YYYY-MM-DD → DD.MM.YYYY for storage
          const m = newVal.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (m) newVal = `${m[3]}.${m[2]}.${m[1]}`;
        }
        if (newVal !== oldVal) {
          setLpiField(item, ef.key, newVal || null);
          changedKeys.push(ef.label);
        }
      }
      if (changedKeys.length === 0) { new Notice('Нет изменений'); return; }
      item.updatedAt = new Date().toISOString();
      item.updatedBy = this.view.plugin.settings.login || 'local';
      saveBtn.disabled = true; saveBtn.textContent = '⏳ Сохранение...';
      try {
        await this.view.sync.syncItemToYougile(item);
        await this.view.saveData();
        new Notice(`Заявка №${item.application_external_id}: изменено ${changedKeys.length} полей`);
      } catch (e: unknown) { new Notice('Ошибка сохранения: ' + errorMessage(e)); }
      void this.render(container, item);
    });
  }

  private createInput(ef: EditFieldDef, value: string, readOnly: boolean): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    const style = 'flex:1;font-size:var(--font-smaller);padding:3px 6px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:4px';
    if (ef.type === 'select') {
      const sel = document.createElement('select');
      sel.style.cssText = style;
      for (const opt of ef.options || []) sel.createEl('option', { text: opt || '(пусто)', value: opt });
      sel.value = value;
      sel.disabled = readOnly;
      return sel;
    } else if (ef.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.style.cssText = style + ';min-height:50px;resize:vertical';
      ta.value = value;
      ta.readOnly = readOnly;
      return ta;
    } else if (ef.type === 'date') {
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.style.cssText = style;
      inp.readOnly = readOnly;
      // Convert DD.MM.YYYY → YYYY-MM-DD for input[type=date]
      if (value) {
        const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (match) {
          inp.value = `${match[3]}-${match[2]}-${match[1]}`;
        } else {
          inp.value = value;
        }
      }
      return inp;
    } else {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.style.cssText = style;
      inp.value = value;
      inp.readOnly = readOnly;
      return inp;
    }
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
      for (const table of schema.tables) tableSel.createEl('option', { text: table.name, value: table.name });
    }).catch((e: unknown) => {
      console.error('LPI: не удалось загрузить список таблиц:', errorMessage(e));
    });

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
        if (hasAppIdFk) query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE application_id = '{{application_id}}'\nLIMIT 50`;
        else if (tableName === 'applications') query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE external_id = '{{application_external_id}}'\nLIMIT 50`;
        else if (otherFks.length > 0) query = `SELECT\n  ${cols}\nFROM ${tableName}\nWHERE (\n  ${otherFks.map(fk => `${fk.from} = '{{${fk.from}}}'`).join('\n  OR ')}\n)\nLIMIT 50`;
        else query = `SELECT\n  ${cols}\nFROM ${tableName}\nLIMIT 100`;
        sqlInput.value = query;
      }).catch((e: unknown) => {
        console.error('LPI: не удалось сгенерировать запрос:', errorMessage(e));
      });
    });

    const runBtn = qContainer.createEl('button', { text: '▶ Выполнить', cls: 'mailer-yougile-refresh-btn', attr: { style: 'margin-top:6px' } });
    const resultDiv = qContainer.createDiv({ attr: { style: 'margin-top:8px;overflow-x:auto' } });
    const saveSectionBtn = qContainer.createEl('button', { text: '💾 Сохранить как секцию', cls: 'mailer-yougile-refresh-btn', attr: { style: 'margin-top:6px;font-size:11px' } });

    runBtn.addEventListener('click', async () => {
      let query = sqlInput.value;
      for (const key of ['aggregate_id', 'application_id', 'application_external_id', 'product_name']) {
        const val = getLpiField(item, key);
        if (val !== null && val !== undefined) query = query.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
      }
      resultDiv.empty();
      runBtn.textContent = '⏳'; runBtn.disabled = true;
      try {
        const result = await this.view.schemaService.runQuery(dbPath, query);
        if (result.columns.length === 0) { resultDiv.textContent = 'Нет результатов'; saveSectionBtn.style.display = 'none'; return; }
        const resTable = resultDiv.createEl('table');
        resTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';
        const resHr = resTable.createEl('thead').createEl('tr');
        for (const col of result.columns) resHr.createEl('th', { text: col }).style.cssText = 'border-bottom:1px solid var(--background-modifier-border);padding:3px 6px;text-align:left;white-space:nowrap';
        const resBody = resTable.createEl('tbody');
        for (const row of result.rows) {
          const tr = resBody.createEl('tr');
          for (let i = 0; i < result.columns.length; i++) tr.createEl('td', { text: row[i] !== null && row[i] !== undefined ? String(row[i]) : '—' }).style.cssText = 'padding:2px 6px;border-bottom:1px solid var(--background-modifier-border);white-space:nowrap';
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
      } catch (e: unknown) { resultDiv.textContent = 'Ошибка: ' + errorMessage(e); saveSectionBtn.style.display = 'none'; }
      runBtn.textContent = '▶ Выполнить'; runBtn.disabled = false;
    });
    saveSectionBtn.style.display = 'none';

    qContainer.createEl('button', { text: '⚙ Редактор конфига', cls: 'mailer-yougile-refresh-btn', attr: { style: 'margin-left:6px;font-size:11px' } })
      .addEventListener('click', () => new LpiConfigEditorModal(this.view).open());
  }
}
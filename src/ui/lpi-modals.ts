import { App, Modal, Notice } from 'obsidian';
import type { LpiItem } from '../types/lpi';
import { DEFAULT_CONFIG } from '../types/lpi-config';
import type { LpiView } from './lpi-view';
import type YouGilePlugin from '../main';
import { isCompleted } from './lpi-utils';

const CONFIG_PATH = 'yourbase/lpi_view_config.json';

export class ProductFilterModal extends Modal {
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

export class MethodFilterModal extends Modal {
  private allMethods: string[];
  private selected: Set<string>;
  private onSave: (selected: Set<string>) => void;
  private static METHOD_NAMES: Record<string, string> = {
    'method1': 'Группа горючести',
    'method2': 'Группа воспламеняемости',
    'method3': 'Группа распространения пламени',
    'method4': 'Кислородный индекс',
    'g56027': 'Малое пламя',
    'g56927': 'Малое пламя',
  };

  constructor(app: App, allMethods: string[], selected: Set<string>, onSave: (selected: Set<string>) => void) {
    super(app);
    this.allMethods = allMethods;
    this.selected = new Set(selected);
    this.onSave = onSave;
  }

  private displayName(abbr: string): string {
    return MethodFilterModal.METHOD_NAMES[abbr] || abbr;
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

export class YougileSyncModal extends Modal {
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

    const matchingDiffs: { item: LpiItem; task: any; yougileDesc: Record<string, any>; diffs: { label: string; local: string; yougile: string }[] }[] = [];
    const imported: any[] = [];

    for (const task of lpiTasks) {
      const desc = JSON.parse(task.description || '{}');
      const extId = desc.application_external_id || '';
      let localItem = items.find(i => i.taskId === task.id);
      if (!localItem && extId) localItem = items.find(i => i.application_external_id === extId);
      if (!localItem && desc.aggregate_id) localItem = items.find(i => i.aggregate_id === desc.aggregate_id);

      if (!localItem) {
        imported.push({ task, desc });
        continue;
      }

      const diffs: { label: string; local: string; yougile: string }[] = [];
      const compareFields: { key: string; label: string }[] = [
        { key: 'protocol_date', label: 'Дата протокола' },
        { key: 'agg_gen_group_complience', label: 'Оценка соответствия' },
        { key: 'agg_gen_group', label: 'Результат испытания' },
        { key: 'product_name', label: 'Материал' },
      ];
      for (const { key, label } of compareFields) {
        const lv = String((localItem as any)[key] ?? '');
        const yv = String(desc[key] ?? '');
        if (lv !== yv) diffs.push({ label, local: lv || '—', yougile: yv || '—' });
      }
      const lc = isCompleted(localItem) ? 'Завершена' : 'Активна';
      const yc = isCompleted({ ...localItem, ...desc } as any) ? 'Завершена' : 'Активна';
      if (lc !== yc) diffs.push({ label: 'Статус', local: lc, yougile: yc });

      if (diffs.length > 0) {
        matchingDiffs.push({ item: localItem, task, yougileDesc: desc, diffs });
      }
    }

    contentEl.empty();
    contentEl.createEl('h2', { text: '🔄 Синхронизация с YouGile' });

    let autoImported = 0;
    for (const imp of imported) {
      const newItem: LpiItem = { ...imp.desc, taskId: imp.task.id } as any;
      if (imp.task.completed && imp.desc.protocol_date) {
        newItem.protocol_date = imp.desc.protocol_date;
      }
      const hasItem = items.some(i => i.aggregate_id === newItem.aggregate_id || i.application_external_id === newItem.application_external_id);
      if (!hasItem) {
        items.push(newItem);
        autoImported++;
      }
    }

    if (matchingDiffs.length === 0) {
      if (autoImported > 0) {
        await this.view.saveData();
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
          const fullJson = this.view.buildFullJson(md.item);
          if (choice === 'local') {
            await this.plugin.client!.updateTask(md.task.id, { description: JSON.stringify(fullJson) });
            if (isCompleted(md.item) && !md.task.completed) {
              await this.plugin.client!.updateTask(md.task.id, { completed: true });
            }
            if (!md.item.taskId) md.item.taskId = md.task.id;
          } else {
            // Copy all fields from YouGile description to local item
            for (const key of Object.keys(md.yougileDesc)) {
              if (key === 'type' || key === 'aggregate_id') continue;
              const yv = md.yougileDesc[key];
              if (yv !== undefined && yv !== null) {
                (md.item as any)[key] = yv;
              }
            }
            if (!md.item.taskId) md.item.taskId = md.task.id;
          }
          count++;
        } catch (e: any) {
          new Notice(`Ошибка по №${md.item.application_external_id}: ${e.message}`);
        }
      }
      await this.view.saveData();
      new Notice(`Применено: ${count} заявок`);
      this.close();
      this.view.renderView();
    });

    const closeBtn = bottomRow.createEl('button', {
      text: 'Закрыть',
      cls: 'mailer-yougile-refresh-btn',
    });
    closeBtn.addEventListener('click', () => {
      this.view.renderView();
      this.close();
    });
  }
}

export class LpiConfigEditorModal extends Modal {
  private view: LpiView;

  constructor(view: LpiView) {
    super(view.app);
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

export interface DiffField {
  label: string;
  field: string;
  local: string;
  remote: string;
}

export class LpiChangesModal extends Modal {
  private diffs: DiffField[];
  private title: string;
  private onApply: () => void;
  private onSkip: () => void;

  constructor(
    app: App,
    title: string,
    diffs: DiffField[],
    onApply: () => void,
    onSkip: () => void,
  ) {
    super(app);
    this.title = title;
    this.diffs = diffs;
    this.onApply = onApply;
    this.onSkip = onSkip;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('mailer-yougile-container');
    contentEl.createEl('h2', { text: `🔄 ${this.title}` });

    const info = contentEl.createEl('p', { text: 'Обнаружены расхождения. Выберите действие:' });
    info.style.marginBottom = '8px';

    const table = contentEl.createEl('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = 'var(--font-smaller)';
    table.style.marginBottom = '12px';

    const hr = table.createEl('thead').createEl('tr');
    for (const text of ['Поле', 'Текущее', 'Новое']) {
      const th = hr.createEl('th');
      th.style.padding = '4px 8px';
      th.style.borderBottom = '2px solid var(--background-modifier-border)';
      th.style.textAlign = 'left';
      th.style.fontWeight = 'bold';
      th.setText(text);
    }

    const tbody = table.createEl('tbody');
    for (const d of this.diffs) {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: d.label }).style.cssText = 'padding:3px 8px;border-bottom:1px solid var(--background-modifier-border)';
      tr.createEl('td', { text: d.local || '—' }).style.cssText = 'padding:3px 8px;border-bottom:1px solid var(--background-modifier-border);background:rgba(var(--color-green-rgb),0.08)';
      tr.createEl('td', { text: d.remote || '—' }).style.cssText = 'padding:3px 8px;border-bottom:1px solid var(--background-modifier-border);background:rgba(var(--interactive-accent-rgb),0.08)';
    }

    const btnRow = contentEl.createDiv();
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';

    const applyBtn = btnRow.createEl('button', { text: '✅ Применить изменения', cls: 'mailer-yougile-refresh-btn' });
    applyBtn.addEventListener('click', () => { this.onApply(); this.close(); });

    const skipBtn = btnRow.createEl('button', { text: '⏭ Пропустить', cls: 'mailer-yougile-refresh-btn' });
    skipBtn.addEventListener('click', () => { this.onSkip(); this.close(); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

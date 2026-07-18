import { ItemView, WorkspaceLeaf } from 'obsidian';
import type YouGilePlugin from '../main';
import type { LpiItem } from '../types/lpi';

const DB_PATH = 'yourbase/lpi_data.json';

export const LPI_VIEW_TYPE = 'yougile-lpi-view';

const PROTOCOL_DATE_FALLBACK = '01.03.2026';

export class LpiView extends ItemView {
  plugin: YouGilePlugin;
  private containerElContent!: HTMLElement;
  private items: LpiItem[] = [];
  private searchQuery = '';
  private searchTimeout: number | null = null;

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
    return item.protocol_date || PROTOCOL_DATE_FALLBACK;
  }

  private renderView(): void {
    const container = this.containerElContent;
    container.empty();

    const header = container.createDiv({ cls: 'mailer-yougile-header' });
    header.createEl('h3', { text: '🧪 Лаборатория пожарных испытаний' });

    const searchInput = container.createEl('input', { attr: { type: 'text', placeholder: '🔍 Поиск по № заявки, названию материала...' } });
    searchInput.addClass('mailer-mb-8');
    searchInput.value = this.searchQuery;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = window.setTimeout(() => {
        this.renderView();
      }, 300);
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
    const headers = ['№ заявки', 'Название материала', 'Дата протокола', 'Оценка соответствия'];
    for (const h of headers) {
      const th = headerRow.createEl('th', { cls: 'mailer-th' });
      th.setText(h);
    }

    const tbody = table.createEl('tbody');
    if (filtered.length === 0) {
      const emptyRow = tbody.createEl('tr');
      const td = emptyRow.createEl('td', { cls: 'mailer-text-center mailer-p-24' });
      td.setAttr('colspan', '4');
      td.setText('Нет данных');
      return;
    }

    for (const item of filtered) {
      const row = tbody.createEl('tr', { cls: 'mailer-clickable mailer-row-hover' });
      row.addEventListener('click', () => this.renderDetail(item));

      row.createEl('td', { cls: 'mailer-td' }).setText(item.application_external_id);
      row.createEl('td', { cls: 'mailer-td' }).setText(item.product_name);
      row.createEl('td', { cls: 'mailer-td' }).setText(this.getProtocolDate(item));
      row.createEl('td', { cls: 'mailer-td' }).setText(item.agg_gen_group_complience || '');
    }
  }

  private renderDetail(item: LpiItem): void {
    const container = this.containerElContent;
    container.empty();

    const backBtn = container.createEl('button', { text: '← Назад к списку', cls: 'mailer-yougile-refresh-btn' });
    backBtn.addEventListener('click', () => this.renderView());

    container.createEl('h3', { text: `Заявка №${item.application_external_id}` });

    const fields: Array<{ label: string; value: unknown }> = [
      { label: 'Название материала', value: item.product_name },
      { label: 'Дата протокола', value: this.getProtocolDate(item) },
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
      { label: 'Оценка соответствия', value: item.agg_gen_group_complience },
      { label: 'Дополнительная информация', value: item.agg_additional_info_1 },
    ];

    const meta = container.createDiv({ cls: 'mailer-yougile-task-meta mailer-mb-12' });
    for (const field of fields) {
      if (field.value === null || field.value === undefined || field.value === '') continue;
      meta.createDiv({ text: `${field.label}: ${field.value}` });
    }
  }
}

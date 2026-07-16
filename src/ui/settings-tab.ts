import { PluginSettingTab, Setting, Notice, SecretComponent, App } from 'obsidian';
import type YouGilePlugin from '../main';

export class YouGileSettingTab extends PluginSettingTab {
  plugin: YouGilePlugin;

  constructor(app: App, plugin: YouGilePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setHeading()
      .setName('Авторизация YouGile');

    new Setting(containerEl)
      .setName('Логин')
      .setDesc('Email или логин от аккаунта YouGile')
      .addText(text => text
        .setPlaceholder('user@example.com')
        .setValue(this.plugin.settings.login)
        .onChange(async (value) => {
          this.plugin.settings.login = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Пароль')
      .setDesc('Пароль от аккаунта YouGile (хранится защищённо)')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('••••••••')
          .setValue('')
          .onChange((value) => {
            this.plugin.savePassword(value);
          });
        return text;
      });

    new Setting(containerEl)
      .setName('ID компании')
      .setDesc('Нажмите Ctrl+Alt+Q (Mac: Ctrl+Option+Q) в YouGile, чтобы скопировать ID')
      .addText(text => text
        .setPlaceholder('company-xxxxx')
        .setValue(this.plugin.settings.companyId)
        .onChange(async (value) => {
          this.plugin.settings.companyId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setHeading()
      .setName('Дополнительно');

    new Setting(containerEl)
      .setName('ID доски по умолчанию')
      .setDesc('ID доски YouGile, в которую будут создаваться задачи (опционально)')
      .addText(text => text
        .setPlaceholder('board-xxxxx')
        .setValue(this.plugin.settings.defaultBoardId)
        .onChange(async (value) => {
          this.plugin.settings.defaultBoardId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setHeading()
      .setName('Расписание мероприятий');

    const calendarProjectSetting = new Setting(containerEl)
      .setName('Проект')
      .setDesc('Проект для мероприятий');
    const calendarProjectSelect = calendarProjectSetting.descEl.parentElement!.createEl('select');
    calendarProjectSelect.addClass('dropdown');
    calendarProjectSelect.style.maxWidth = '100%';
    calendarProjectSelect.style.marginTop = '4px';
    this.populateProjectDropdown(calendarProjectSelect, this.plugin.settings.calendarProjectId);
    calendarProjectSelect.addEventListener('change', async () => {
      this.plugin.settings.calendarProjectId = calendarProjectSelect.value;
      await this.plugin.saveSettings();
      this.populateBoardDropdown(calendarBoardSelect, this.plugin.settings.calendarProjectId, this.plugin.settings.calendarBoardId);
    });

    const calendarBoardSetting = new Setting(containerEl)
      .setName('Доска')
      .setDesc('Доска для мероприятий');
    const calendarBoardSelect = calendarBoardSetting.descEl.parentElement!.createEl('select');
    calendarBoardSelect.addClass('dropdown');
    calendarBoardSelect.style.maxWidth = '100%';
    calendarBoardSelect.style.marginTop = '4px';
    this.populateBoardDropdown(calendarBoardSelect, this.plugin.settings.calendarProjectId, this.plugin.settings.calendarBoardId);
    calendarBoardSelect.addEventListener('change', async () => {
      this.plugin.settings.calendarBoardId = calendarBoardSelect.value;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName('Статус API ключа')
      .setDesc(this.plugin.settings.apiKeySecret ? 'Ключ получен и сохранён защищённо' : 'Ключ не получен')
      .addButton(btn => btn
        .setButtonText('Получить ключ')
        .onClick(async () => {
          btn.setDisabled(true).setButtonText('Получение...');
          try {
            await this.plugin.authenticate();
            new Notice('YouGile: API ключ успешно получен');
            this.display();
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            new Notice(`YouGile: Ошибка аутентификации — ${msg}`);
            btn.setDisabled(false).setButtonText('Получить ключ');
          }
        }));
  }

  private populateProjectDropdown(select: HTMLSelectElement, selectedId: string): void {
    select.empty();
    select.createEl('option', { value: '', text: '— не выбран —' });
    const projects = this.plugin.db.getProjects();
    for (const p of projects) {
      select.createEl('option', { value: p.id, text: p.title });
    }
    if (selectedId) select.value = selectedId;
  }

  private populateBoardDropdown(select: HTMLSelectElement, projectId: string, selectedId: string): void {
    select.empty();
    select.createEl('option', { value: '', text: '— не выбрана —' });
    let boards = this.plugin.db.getBoards();
    if (projectId) boards = boards.filter(b => b.projectId === projectId);
    for (const b of boards) {
      select.createEl('option', { value: b.id, text: b.title });
    }
    if (selectedId) select.value = selectedId;
  }

}

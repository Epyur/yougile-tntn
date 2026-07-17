import { PluginSettingTab, Setting, Notice, SecretComponent, App, SuggestModal, TFile } from 'obsidian';
import type YouGilePlugin from '../main';

class DocxTemplateSuggestModal extends SuggestModal<TFile> {
  plugin: YouGilePlugin;
  onChoose: (path: string) => void;

  constructor(app: App, plugin: YouGilePlugin, onChoose: (path: string) => void) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.setPlaceholder('Выберите .docx шаблон...');
    this.limit = 20;
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault.getFiles()
      .filter(f => f.path.toLowerCase().endsWith('.docx'))
      .filter(f => !q || f.path.toLowerCase().includes(q));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  onChooseSuggestion(file: TFile): void {
    this.onChoose(file.path);
  }
}

export class YouGileSettingTab extends PluginSettingTab {
  plugin: YouGilePlugin;

  constructor(app: App, plugin: YouGilePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ===== Block 1: Базовые настройки =====
    this.renderCollapsibleBlock(containerEl, 'Базовые настройки плагина', true, false, (body) => {
      new Setting(body)
        .setName('ID компании')
        .setDesc('Нажмите Ctrl+Alt+Q (Mac: Ctrl+Option+Q) в YouGile, чтобы скопировать ID')
        .addText(text => text
          .setPlaceholder('company-xxxxx')
          .setValue(this.plugin.settings.companyId)
          .onChange(async (value) => {
            this.plugin.settings.companyId = value;
            await this.plugin.saveSettings();
          }));

      new Setting(body)
        .setName('Логин')
        .setDesc('Email или логин от аккаунта YouGile')
        .addText(text => text
          .setPlaceholder('user@example.com')
          .setValue(this.plugin.settings.login)
          .onChange(async (value) => {
            this.plugin.settings.login = value;
            await this.plugin.saveSettings();
          }));

      new Setting(body)
        .setName('Пароль')
        .setDesc('Пароль от аккаунта YouGile (хранится защищённо)')
        .addText(text => {
          text.inputEl.type = 'password';
          text
            .setPlaceholder('••••••••')
            .setValue('')
            .onChange((value) => { this.plugin.savePassword(value); });
          return text;
        });

      new Setting(body)
        .setName('Получить API Key')
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

      new Setting(body)
        .setName('ID доски по умолчанию')
        .setDesc('ID доски YouGile, в которую будут создаваться задачи (опционально)')
        .addText(text => text
          .setPlaceholder('board-xxxxx')
          .setValue(this.plugin.settings.defaultBoardId)
          .onChange(async (value) => {
            this.plugin.settings.defaultBoardId = value;
            await this.plugin.saveSettings();
          }));
    });

    // ===== Block 2: Календарь =====
    this.renderCollapsibleBlock(containerEl, 'Календарь и расписание мероприятий', true, true, (body) => {
      const projectSetting = new Setting(body).setName('Проект').setDesc('Проект для мероприятий');
      const projectSelect = projectSetting.descEl.parentElement!.createEl('select');
      projectSelect.addClass('dropdown');
      projectSelect.style.maxWidth = '100%';
      projectSelect.style.marginTop = '4px';
      this.populateProjectDropdown(projectSelect, this.plugin.settings.calendarProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.calendarProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.calendarProjectId, this.plugin.settings.calendarBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для мероприятий');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      boardSelect.style.maxWidth = '100%';
      boardSelect.style.marginTop = '4px';
      this.populateBoardDropdown(boardSelect, this.plugin.settings.calendarProjectId, this.plugin.settings.calendarBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.calendarBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });
    });

    // ===== Block 3: Документы =====
    this.renderCollapsibleBlock(containerEl, 'Управление документами', true, true, (body) => {
      const projectSetting = new Setting(body).setName('Проект').setDesc('Проект для документов');
      const projectSelect = projectSetting.descEl.parentElement!.createEl('select');
      projectSelect.addClass('dropdown');
      projectSelect.style.maxWidth = '100%';
      projectSelect.style.marginTop = '4px';
      this.populateProjectDropdown(projectSelect, this.plugin.settings.docsProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.docsProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.docsProjectId, this.plugin.settings.docsBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для документов');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      boardSelect.style.maxWidth = '100%';
      boardSelect.style.marginTop = '4px';
      this.populateBoardDropdown(boardSelect, this.plugin.settings.docsProjectId, this.plugin.settings.docsBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.docsBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });
    });

    // ===== Block 4: Письма =====
    this.renderCollapsibleBlock(containerEl, 'Управление письмами', true, true, (body) => {
      // Sub-block 4.1
      this.renderSubheading(body, 'Основные настройки');

      const projectSetting = new Setting(body).setName('Проект').setDesc('Проект для писем');
      const projectSelect = projectSetting.descEl.parentElement!.createEl('select');
      projectSelect.addClass('dropdown');
      projectSelect.style.maxWidth = '100%';
      projectSelect.style.marginTop = '4px';
      this.populateProjectDropdown(projectSelect, this.plugin.settings.emailProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.emailProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.emailProjectId, this.plugin.settings.emailBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для писем');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      boardSelect.style.maxWidth = '100%';
      boardSelect.style.marginTop = '4px';
      this.populateBoardDropdown(boardSelect, this.plugin.settings.emailProjectId, this.plugin.settings.emailBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.emailBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });

      new Setting(body)
        .setName('Путь к базе писем')
        .setDesc('Путь к файлу mailer_data.json относительно хранилища Obsidian')
        .addText(text => text
          .setPlaceholder('mailer_data.json')
          .setValue(this.plugin.settings.emailDbPath)
          .onChange(async (value) => {
            this.plugin.settings.emailDbPath = value || 'mailer_data.json';
            await this.plugin.saveSettings();
          }));

      new Setting(body)
        .setName('Автор по умолчанию')
        .setDesc('ФИО автора для новых писем')
        .addText(text => text
          .setPlaceholder('Кравченко А.А.')
          .setValue(this.plugin.settings.emailDefaultAuthor)
          .onChange(async (value) => {
            this.plugin.settings.emailDefaultAuthor = value || 'Кравченко А.А.';
            await this.plugin.saveSettings();
          }));

      // Sub-block 4.2
      this.renderSubheading(body, 'Настройки AI помощника');

      new Setting(body)
        .setName('API ключ')
        .setDesc('API ключ для OpenAI-совместимого API')
        .addText(text => {
          text.inputEl.type = 'password';
          text
            .setPlaceholder('sk-...')
            .setValue('')
            .onChange((value) => {
              const secretName = `yougile-llm-${Date.now()}`;
              this.plugin.saveSecret(secretName, value);
              this.plugin.settings.llmApiKeySecret = secretName;
              this.plugin.saveSettings();
            });
          return text;
        });

      new Setting(body)
        .setName('URL API')
        .setDesc('URL эндпоинта LLM (OpenAI-совместимый)')
        .addText(text => text
          .setPlaceholder('https://ask.chadgpt.ru/api/v1/chat/completions')
          .setValue(this.plugin.settings.llmApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmApiUrl = value;
            await this.plugin.saveSettings();
          }));

      new Setting(body)
        .setName('Модель')
        .setDesc('Название модели LLM')
        .addText(text => text
          .setPlaceholder('deepseek-v4-pro')
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings.llmModel = value;
            await this.plugin.saveSettings();
          }));

      new Setting(body)
        .setName('Системный промпт')
        .setDesc('Системный промпт для LLM')
        .addTextArea(text => text
          .setPlaceholder('Ты — эксперт...')
          .setValue(this.plugin.settings.llmSystemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.llmSystemPrompt = value;
            await this.plugin.saveSettings();
          }));

      // Sub-block 4.3
      this.renderSubheading(body, 'Экспорт в DOCX');

      new Setting(body)
        .setName('Путь к шаблону')
        .setDesc('Путь к .docx файлу шаблона (оставьте пустым для стандартного)')
        .addText(text => text
          .setPlaceholder('Шаблоны писем/Стандартный шаблон.docx')
          .setValue(this.plugin.settings.docxTemplatePath)
          .onChange(async (value) => {
            this.plugin.settings.docxTemplatePath = value;
            await this.plugin.saveSettings();
          }))
        .addButton(btn => btn
          .setButtonText('Обзор...')
          .onClick(() => {
            const modal = new DocxTemplateSuggestModal(this.app, this.plugin, (path) => {
              this.plugin.settings.docxTemplatePath = path;
              this.plugin.saveSettings();
              this.display();
            });
            modal.open();
          }));

      new Setting(body)
        .setName('Папка экспорта')
        .setDesc('Папка для сохранения DOCX файлов')
        .addText(text => text
          .setPlaceholder('Экспорт писем')
          .setValue(this.plugin.settings.docxExportFolder)
          .onChange(async (value) => {
            this.plugin.settings.docxExportFolder = value || 'Экспорт писем';
            await this.plugin.saveSettings();
          }));
    });

    // ===== Block 5: Контакты =====
    this.renderCollapsibleBlock(containerEl, 'Управление контактами', true, true, (body) => {
      const projectSetting = new Setting(body).setName('Проект').setDesc('Проект для контактов');
      const projectSelect = projectSetting.descEl.parentElement!.createEl('select');
      projectSelect.addClass('dropdown');
      projectSelect.style.maxWidth = '100%';
      projectSelect.style.marginTop = '4px';
      this.populateProjectDropdown(projectSelect, this.plugin.settings.contactProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.contactProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.contactProjectId, this.plugin.settings.contactBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для контактов');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      boardSelect.style.maxWidth = '100%';
      boardSelect.style.marginTop = '4px';
      this.populateBoardDropdown(boardSelect, this.plugin.settings.contactProjectId, this.plugin.settings.contactBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.contactBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });

      new Setting(body)
        .setName('Путь к базе контактов')
        .setDesc('Путь к файлу contacts_data.json относительно хранилища Obsidian')
        .addText(text => text
          .setPlaceholder('contacts_data.json')
          .setValue(this.plugin.settings.contactDbPath)
          .onChange(async (value) => {
            this.plugin.settings.contactDbPath = value || 'contacts_data.json';
            await this.plugin.saveSettings();
          }));
    });

    // ===== Block 6: Дашборд =====
    this.renderCollapsibleBlock(containerEl, 'Модуль дашборда', false, true, (body) => {
      new Setting(body)
        .setName('Дашборд')
        .setDesc('Панель метрик и графиков ApexCharts. Настройки не требуются.')
        .addButton(btn => btn
          .setButtonText('Открыть дашборд')
          .onClick(() => {
            this.plugin.activateDashboardView();
          }));
    });
  }

  private renderCollapsibleBlock(
    container: HTMLElement,
    title: string,
    collapsible: boolean,
    hasToggle: boolean,
    renderBody: (body: HTMLElement) => void,
  ): void {
    const block = container.createDiv();
    block.style.marginBottom = '8px';

    const header = block.createDiv();
    header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--background-modifier-border);cursor:pointer;user-select:none';

    let bodyEl: HTMLElement | null = null;
    let collapsed = false;

    if (collapsible) {
      const arrow = header.createSpan();
      arrow.setText('▼');
      arrow.style.cssText = 'font-size:10px;width:14px;text-align:center;flex-shrink:0';

      const toggleCollapse = () => {
        collapsed = !collapsed;
        arrow.setText(collapsed ? '▶' : '▼');
        if (bodyEl) bodyEl.style.display = collapsed ? 'none' : '';
      };

      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          toggleCollapse();
        }
      });

      const titleSpan = header.createSpan();
      titleSpan.style.cssText = 'font-weight:bold;font-size:var(--font-ui-medium);flex:1';
      titleSpan.setText(title);

      if (hasToggle) {
        const toggleKey = this.getToggleKey(title);
        const toggle = header.createEl('input', { attr: { type: 'checkbox' } });
        toggle.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0';
        toggle.checked = toggleKey ? (this.plugin.settings as any)[toggleKey] !== false : true;
        toggle.addEventListener('change', async (e) => {
          e.stopPropagation();
          if (toggleKey) {
            (this.plugin.settings as any)[toggleKey] = toggle.checked;
            await this.plugin.saveSettings();
          }
          if (bodyEl) bodyEl.style.display = toggle.checked ? '' : 'none';
          if (!toggle.checked) collapsed = true;
        });
        if (!toggle.checked) collapsed = true;
      }

      bodyEl = block.createDiv();
      bodyEl.style.marginLeft = '18px';
      if (collapsed) bodyEl.style.display = 'none';
      renderBody(bodyEl);
    } else {
      const titleSpan = header.createSpan();
      titleSpan.style.cssText = 'font-weight:bold;font-size:var(--font-ui-medium);flex:1';
      titleSpan.setText(title);

      if (hasToggle) {
        const toggleKey = this.getToggleKey(title);
        const toggle = header.createEl('input', { attr: { type: 'checkbox' } });
        toggle.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0';
        toggle.checked = toggleKey ? (this.plugin.settings as any)[toggleKey] !== false : true;
        toggle.addEventListener('change', async () => {
          if (toggleKey) {
            (this.plugin.settings as any)[toggleKey] = toggle.checked;
            await this.plugin.saveSettings();
          }
          if (bodyEl) bodyEl.style.display = toggle.checked ? '' : 'none';
        });
        bodyEl = block.createDiv();
        if (!toggle.checked) bodyEl.style.display = 'none';
        renderBody(bodyEl);
      } else {
        bodyEl = block.createDiv();
        renderBody(bodyEl);
      }
    }
  }

  private renderSubheading(container: HTMLElement, title: string): void {
    const el = container.createDiv();
    el.style.cssText = 'font-weight:600;font-size:var(--font-smaller);color:var(--text-muted);padding:8px 0 4px;border-bottom:1px dashed var(--background-modifier-border);margin-top:8px';
    el.setText(title);
  }

  private getToggleKey(blockTitle: string): string {
    const map: Record<string, string> = {
      'Базовые настройки плагина': '',
      'Календарь и расписание мероприятий': 'moduleCalendarEnabled',
      'Управление документами': 'moduleDocumentsEnabled',
      'Управление письмами': 'moduleEmailsEnabled',
      'Управление контактами': 'moduleContactsEnabled',
      'Модуль дашборда': 'moduleDashboardEnabled',
    };
    return map[blockTitle] || '';
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

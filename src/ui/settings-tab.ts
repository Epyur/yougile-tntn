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
            this.tryAutoAuth();
          }));

      const passwordSetting = new Setting(body)
        .setName('Пароль')
        .setDesc('Пароль от аккаунта YouGile (хранится защищённо)');
      new SecretComponent(this.app, passwordSetting.controlEl)
        .onChange((value) => {
          this.plugin.savePassword(value);
          this.tryAutoAuth();
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
      this.populateProjectDropdown(projectSelect, this.plugin.settings.calendarProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.calendarProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.calendarProjectId, this.plugin.settings.calendarBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для мероприятий');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
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
      this.populateProjectDropdown(projectSelect, this.plugin.settings.docsProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.docsProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.docsProjectId, this.plugin.settings.docsBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для документов');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
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
      this.populateProjectDropdown(projectSelect, this.plugin.settings.emailProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.emailProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.emailProjectId, this.plugin.settings.emailBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для писем');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      this.populateBoardDropdown(boardSelect, this.plugin.settings.emailProjectId, this.plugin.settings.emailBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.emailBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });

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

      const llmKeySetting = new Setting(body)
        .setName('API ключ')
        .setDesc('API ключ для OpenAI-совместимого API');
      new SecretComponent(this.app, llmKeySetting.controlEl)
        .onChange((value) => {
          const secretName = `yougile-llm-${Date.now()}`;
          this.plugin.saveSecret(secretName, value);
          this.plugin.settings.llmApiKeySecret = secretName;
          this.plugin.saveSettings();
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
      this.populateProjectDropdown(projectSelect, this.plugin.settings.contactProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.contactProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.contactProjectId, this.plugin.settings.contactBoardId);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для контактов');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      this.populateBoardDropdown(boardSelect, this.plugin.settings.contactProjectId, this.plugin.settings.contactBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.contactBoardId = boardSelect.value;
        await this.plugin.saveSettings();
      });

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

    // ===== Block 7: Лаборатория пожарных испытаний =====
    this.renderCollapsibleBlock(containerEl, 'Лаборатория пожарных испытаний', true, true, (body) => {
      new Setting(body)
        .setName('Лаборатория пожарных испытаний')
        .setDesc('Просмотр заявок и протоколов лаборатории пожарных испытаний. Проект, доска и колонка настроены жёстко.')
        .addButton(btn => btn
          .setButtonText('Открыть')
          .onClick(() => {
            this.plugin.activateLpiView();
          }));

      const projectSetting = new Setting(body).setName('Проект').setDesc('Проект для заявок ЛПИ');
      const projectSelect = projectSetting.descEl.parentElement!.createEl('select');
      projectSelect.addClass('dropdown');
      this.populateProjectDropdown(projectSelect, this.plugin.settings.lpiProjectId);
      projectSelect.addEventListener('change', async () => {
        this.plugin.settings.lpiProjectId = projectSelect.value;
        await this.plugin.saveSettings();
        this.populateBoardDropdown(boardSelect, this.plugin.settings.lpiProjectId, this.plugin.settings.lpiBoardId);
        this.populateColumnDropdown(columnSelect, this.plugin.settings.lpiBoardId, this.plugin.settings.lpiColumnTitle);
      });

      const boardSetting = new Setting(body).setName('Доска').setDesc('Доска для заявок ЛПИ');
      const boardSelect = boardSetting.descEl.parentElement!.createEl('select');
      boardSelect.addClass('dropdown');
      this.populateBoardDropdown(boardSelect, this.plugin.settings.lpiProjectId, this.plugin.settings.lpiBoardId);
      boardSelect.addEventListener('change', async () => {
        this.plugin.settings.lpiBoardId = boardSelect.value;
        await this.plugin.saveSettings();
        this.populateColumnDropdown(columnSelect, this.plugin.settings.lpiBoardId, this.plugin.settings.lpiColumnTitle);
      });

      const columnSetting = new Setting(body).setName('Колонка').setDesc('Колонка для новых заявок ЛПИ');
      const columnSelect = columnSetting.descEl.parentElement!.createEl('select');
      columnSelect.addClass('dropdown');
      this.populateColumnDropdown(columnSelect, this.plugin.settings.lpiBoardId, this.plugin.settings.lpiColumnTitle);
      columnSelect.addEventListener('change', async () => {
        const selected = columnSelect.options[columnSelect.selectedIndex];
        this.plugin.settings.lpiColumnTitle = selected ? selected.text : '';
        await this.plugin.saveSettings();
      });

      const dbSetting = new Setting(body)
        .setName('Путь к SQLite БД')
        .setDesc('Полный путь к внешней базе данных LIMS (lims.db). Используется для загрузки завершённых заявок на вкладке "Завершённые".')
        .addText(text => text
          .setPlaceholder('C:/lims/lims.db')
          .setValue(this.plugin.settings.lpiDbPath)
          .onChange(async (value) => {
            this.plugin.settings.lpiDbPath = value;
            await this.plugin.saveSettings();
          }));
      dbSetting.addButton(btn => btn
        .setButtonText('Обзор...')
        .onClick(async () => {
          try {
            const { remote } = require('electron');
            const result = await remote.dialog.showOpenDialog({
              properties: ['openFile'],
              filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const chosen = result.filePaths[0].replace(/\\/g, '/');
            this.plugin.settings.lpiDbPath = chosen;
            await this.plugin.saveSettings();
            this.display();
          } catch {
            // Fallback: if Electron dialog fails, use input[type=file]
            const fallback = document.createElement('input');
            fallback.type = 'file';
            fallback.accept = '.db,.sqlite,.sqlite3';
            fallback.style.display = 'none';
            fallback.addEventListener('change', async () => {
              const file = fallback.files?.[0];
              if (file) {
                const p = (file as any).path;
                if (p) {
                  this.plugin.settings.lpiDbPath = p.replace(/\\/g, '/');
                  await this.plugin.saveSettings();
                  this.display();
                } else {
                  new Notice('Выберите файл через меню "Файл" → "Открыть", либо укажите путь вручную');
                }
              }
              document.body.removeChild(fallback);
            });
            document.body.appendChild(fallback);
            fallback.click();
          }
        }));

      new Setting(body)
        .setName('Конфиг отображения')
        .setDesc('Источник конфига для детального просмотра заявок (поля, секции, подзапросы). "Файл" — yourbase/lpi_view_config.json, "По умолчанию" — встроенный.')
        .addDropdown(drop => drop
          .addOption('file', 'Файл (yourbase/lpi_view_config.json)')
          .addOption('default', 'По умолчанию (встроенный)')
          .setValue(this.plugin.settings.lpiViewConfigSource)
          .onChange(async (value) => {
            this.plugin.settings.lpiViewConfigSource = value as 'default' | 'file';
            await this.plugin.saveSettings();
          }));
    }, true);
  }

  private renderCollapsibleBlock(
    container: HTMLElement,
    title: string,
    collapsible: boolean,
    hasToggle: boolean,
    renderBody: (body: HTMLElement) => void,
    startCollapsed = false,
  ): void {
    const block = container.createDiv();
    block.addClass('mailer-mb-8');

    const header = block.createDiv();
    header.addClass('mailer-block-header');

    let bodyEl: HTMLElement | null = null;
    let collapsed = startCollapsed;

    if (collapsible) {
      const arrow = header.createSpan();
      arrow.setText(collapsed ? '▶' : '▼');
      arrow.addClass('mailer-arrow');

      const toggleCollapse = () => {
        collapsed = !collapsed;
        arrow.setText(collapsed ? '▶' : '▼');
        if (bodyEl) bodyEl.classList.toggle('mailer-hidden', collapsed);
      };

      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
          toggleCollapse();
        }
      });

      const titleSpan = header.createSpan();
      titleSpan.addClass('mailer-title-medium');
      titleSpan.setText(title);

      if (hasToggle) {
        const toggleKey = this.getToggleKey(title);
        const toggle = header.createEl('input', { attr: { type: 'checkbox' } });
        toggle.addClass('mailer-cb');
        toggle.checked = toggleKey ? (this.plugin.settings as unknown as Record<string, unknown>)[toggleKey] !== false : true;
        toggle.addEventListener('change', async (e) => {
          e.stopPropagation();
          if (toggleKey) {
            (this.plugin.settings as unknown as Record<string, unknown>)[toggleKey] = toggle.checked;
            await this.plugin.saveSettings();
          }
          if (bodyEl) bodyEl.classList.toggle('mailer-hidden', !toggle.checked);
          if (!toggle.checked) collapsed = true;
        });
        if (!toggle.checked) collapsed = true;
      }

      bodyEl = block.createDiv();
      bodyEl.addClass('mailer-ml-18');
      if (collapsed) bodyEl.addClass('mailer-hidden');
      renderBody(bodyEl);
    } else {
      const titleSpan = header.createSpan();
      titleSpan.addClass('mailer-title-medium');
      titleSpan.setText(title);

      if (hasToggle) {
        const toggleKey = this.getToggleKey(title);
        const toggle = header.createEl('input', { attr: { type: 'checkbox' } });
        toggle.addClass('mailer-cb');
        toggle.checked = toggleKey ? (this.plugin.settings as unknown as Record<string, unknown>)[toggleKey] !== false : true;
        toggle.addEventListener('change', async () => {
          if (toggleKey) {
            (this.plugin.settings as unknown as Record<string, unknown>)[toggleKey] = toggle.checked;
            await this.plugin.saveSettings();
          }
          if (bodyEl) bodyEl.classList.toggle('mailer-hidden', !toggle.checked);
        });
        bodyEl = block.createDiv();
        if (!toggle.checked) bodyEl.addClass('mailer-hidden');
        renderBody(bodyEl);
      } else {
        bodyEl = block.createDiv();
        renderBody(bodyEl);
      }
    }
  }

  private renderSubheading(container: HTMLElement, title: string): void {
    const el = container.createDiv();
    el.addClass('mailer-subheading');
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
      'Лаборатория пожарных испытаний': 'moduleLpiEnabled',
    };
    return map[blockTitle] || '';
  }

  private tryAutoAuth(): void {
    const login = this.plugin.settings.login;
    const password = this.plugin.getPassword();
    const companyId = this.plugin.settings.companyId;
    if (!login || !password || !companyId) return;
    if (this.plugin.settings.apiKeySecret && this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) return;
    this.plugin.authenticate().catch(() => {});
  }

  private populateProjectDropdown(select: HTMLSelectElement, selectedId: string): void {
    select.empty();
    select.createEl('option', { value: '', text: '— не выбран —' });
    const projects = this.plugin.db.getProjects();
    for (const p of projects) {
      select.createEl('option', { value: p.id, text: p.title });
    }
    if (selectedId) {
      if (Array.from(select.options).some(o => o.value === selectedId)) {
        select.value = selectedId;
      } else {
        // fallback: try to match by title
        const byTitle = projects.find(p => p.title === selectedId);
        if (byTitle) select.value = byTitle.id;
      }
    }
  }

  private populateBoardDropdown(select: HTMLSelectElement, projectId: string, selectedId: string): void {
    select.empty();
    select.createEl('option', { value: '', text: '— не выбрана —' });
    let boards = this.plugin.db.getBoards();
    if (projectId) boards = boards.filter(b => b.projectId === projectId);
    for (const b of boards) {
      select.createEl('option', { value: b.id, text: b.title });
    }
    if (selectedId) {
      if (Array.from(select.options).some(o => o.value === selectedId)) {
        select.value = selectedId;
      } else {
        // fallback: try to match by title
        const byTitle = boards.find(b => b.title === selectedId);
        if (byTitle) select.value = byTitle.id;
      }
    }
  }

  private populateColumnDropdown(select: HTMLSelectElement, boardId: string, selectedTitle: string): void {
    select.empty();
    select.createEl('option', { value: '', text: '— не выбрана —' });
    if (!boardId) return;
    const columns = this.plugin.db.getColumns().filter(c => c.boardId === boardId);
    for (const col of columns) {
      const opt = select.createEl('option', { value: col.id, text: col.title });
      if (col.title === selectedTitle) opt.selected = true;
    }
  }
}

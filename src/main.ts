import { App, Plugin, Notice, Modal, Setting, WorkspaceLeaf } from 'obsidian';
import { YouGileSettings, DEFAULT_SETTINGS } from './types/settings';
import { YouGileClient } from './api/client';
import { YouGileSettingTab } from './ui/settings-tab';
import { TASKS_VIEW_TYPE, TasksView } from './ui/tasks-view';
import { SCHEDULE_VIEW_TYPE, ScheduleView } from './ui/schedule-view';
import { DOCUMENTS_VIEW_TYPE, DocumentsView } from './ui/documents-view';
import { EMAILS_VIEW_TYPE, EmailsView } from './ui/emails-view';
import { DASHBOARD_VIEW_TYPE, DashboardView } from './ui/dashboard-view';
import { SUGGESTIONS_VIEW_TYPE, SuggestionsView } from './ui/suggestions-view';
import { CONTACTS_VIEW_TYPE, ContactsView } from './ui/contacts-view';
import { LPI_VIEW_TYPE, LpiView } from './ui/lpi-view';
import { registerCommands } from './commands';
import { LocalDatabase } from './database/db';
import { EmailDatabase } from './database/email-db';
import { ContactDatabase } from './database/contact-db';
import { LLMService } from './services/llm-service';

const PASSWORD_SECRET_ID = 'yougile-password';

const CHANGELOG: Record<string, string[]> = {
  '0.2.0': [
    'Исправлена загрузка календаря (пустая страница из-за addClass с пробелами)',
    'Добавлен фильтр по доске в дашборд',
    'Добавлены подписи над фильтрами дашборда',
    'Добавлен поиск и фильтр по колонкам в Контакты',
    'Тип организации теперь хранится как ID колонки (динамическое разрешение названия)',
    'Исправлен каскад фильтров в Задачах (доски фильтруются по выбранному проекту)',
    'Все чекбоксы переведены на inline-стили (стабильное отображение в любых темах Obsidian)',
    'Кнопки "Обновить" унифицированы на 🔄',
    'Добавлено уведомление об обновлении (это окно) с историей изменений',
  ],
  '0.2.1': [
    'Исправлен баг "e.isShown is not a function" — модалка обновления открывается через onLayoutReady',
    'Обновлён AGENTS.md с правилами версионирования и коммитов',
    'Синхронизация полей модуля Предложения с настройками',
  ],
  '0.2.2': [
    'Исправлен баг "Attempting to register an existing view type" после перезапуска плагина updater\'ом',
    'Updater: исправлен путь скачивания файлов (TARGET_DIR vs TARGET_ID)',
    'Updater: очистка require.cache перед enablePlugin для применения изменений',
  ],
  '0.2.3': [
    'Все базы данных перенесены в папку yourbase/ относительно корня хранилища',
    'Пути к БД жёстко прописаны в коде (yourbase/yougile_cache.json, yourbase/mailer_data.json, yourbase/contacts_data.json)',
    'Удалены настройки "Путь к базе писем" и "Путь к базе контактов"',
  ],
  '0.2.4': [
    'Исправлена ошибка "getDirectionName is not a function", из-за которой не открывались детали письма',
    'Исправлен syncFromTasks — использовал неверные имена полей (topic, content вместо subject, text)',
    'Название направления (direction_name) теперь хранится прямо в теле письма, а не только как числовой direction_id',
    'Все существующие письма переформатированы: direction_name проставлен по direction_id',
  ],
  '0.3.0': [
    'Добавлен модуль "Лаборатория пожарных испытаний" (toggle в настройках, по умолчанию выключен)',
    'Модуль LPI читает данные из yourbase/lpi_data.json, отображает таблицу и детали заявок',
    'Проект, доска и колонка настроены жёстко (Лаборатория пожарных испытаний / Заявки / Заявки)',
    'Добавлен автор manifest.json: Е.Полищук',
  ],
  '0.3.1': [
    'Таблица LPI: добавлены колонки "Дата создания заявки", "Статус" (всего 6 колонок)',
    'Статус "Активна" отображается жёлтым, "Завершена" — зелёным',
    'У active-заявок в колонке "Дата протокола" показывается "—" (вместо fallback-даты 01.03.2026)',
    'Добавлен дашборд LPI с 4 графиками ApexCharts: статус (donut), заявки по месяцам (bar), оценка соответствия (donut), топ продуктов (bar)',
    'Добавлен модальный фильтр продуктов для дашборда (выбор любого количества из 174 уникальных продуктов)',
    'Переключение между режимами Таблица / Дашборд через кнопки в шапке',
  ],
  '0.3.5': [
    'Дашборд LPI: добавлены фильтры по датам (дата создания заявки с/по, дата протокола с/по)',
    'Дашборд LPI: добавлены чекбоксы "Серийная продукция" (если ЕКН цифровой) и "Опытная продукция" (независимые)',
    'График "Топ продуктов": полные названия (перенос на несколько строк), убраны цифры на барах, растянут на всю ширину',
    'При выборе нескольких продуктов: топ-продуктов заменён на круговые диаграммы соответствия по каждому продукту, общий круг остаётся',
    'Модальное окно выбора продуктов: показывает только продукты после всех фильтров, исправлен поиск',
  ],
  '0.4.0': [
    'LPI: завершение заявок — данные сохраняются в lpi_data.json (вместо отдельного lpi_completed.json)',
    'LPI: вкладка "Завершённые": поле выбора даты протокола (по умолч. сегодня), кнопка "Обновить" для чтения SQLite, таблица результатов, кнопка "Отправить" для пакетного завершения',
    'LPI: пакетное завершение — все найденные записи добавляются в lpi_data.json + создаются задачи YouGile с dateStart/dateEnd',
    'LPI: удалён lpi-db.ts (всё хранится в lpi_data.json как в письмах)',
    'Подключена библиотека sql.js (WASM) для чтения внешней SQLite БД',
  ],
  '0.4.1': [
    'Детали заявки LPI: переименованы поля ("Воспламенение ватки" → "Падение горящих капель расплава", "Соответствие по ватке" → "Соответствие по горящим каплям")',
    'Детали заявки LPI: поля сгруппированы в три блока (Детали заявки, Результаты измерений, Выводы), все поля отображаются всегда (пустые — как "—")',
    'Выводы в деталях заявки: "Результат испытания" и "Общая оценка соответствия" выделены жирным, Оценка цветная (зелёный/красный/серый)',
    'Дашборд LPI: добавлен фильтр "Подтверждаемый показатель" с человеческими названиями методов',
    'Дашборд LPI: фильтр продуктов показывает все продукты из полного списка (независимо от других фильтров)',
    'Дашборд LPI: график "Заявки по месяцам" разделён на "Поступление" и "Завершение" (всего 5 графиков)',
    'Таблица LPI: добавлена колонка "Результат испытания" (agg_gen_group)',
    'Исправлена ошибка поиска — null-safe вызовы toLowerCase() для полей с возможными null-значениями',
  ],
  '0.4.2': [
    'Настройки LPI: кнопка "Обзор..." для выбора SQLite БД через диалог Windows',
    'Исправлена загрузка SQLite — используется fs.existsSync/fs.readFileSync вместо adapter.exists/readBinary для внешних путей',
    'Нормализация слэшей в путях к БД (\\ → /)',
  ],
  '0.4.3': [
    'Настройки LPI: кнопка "Обзор..." переведена на Electron dialog.showOpenDialog (исправлен выбор внешних файлов)',
    'Добавлен fallback через input[type=file] если Electron API недоступен',
    'sql-wasm.wasm читается через fs.readFileSync из папки плагина (не через vault adapter)',
    'Если sql-wasm.wasm не найден локально — скачивается с GitHub raw (для пользователей updater)',
  ],
  '0.4.4': [
    'Бамп версии для активации updater на пользовательских машинах',
  ],
  '0.4.5': [
    'LPI: вкладка "Завершённые" переименована в "Зарегистрировать изменения в БД"',
    'LPI: синхронизация читает все записи из aggregated_results и сравнивает с локальной БД',
    'LPI: новые заявки создаются как задачи YouGile (активные/завершённые в зависимости от protocol_date)',
    'LPI: активные задачи с появившейся датой протокола автоматически завершаются',
    'Задачи: подзадачи в деталях выводятся списком с маркерами (вместо одной строки)',
  ],
  '0.4.6': [
    'Задачи: чат перенесён в детали задачи (встроенный, с отправкой файлов/изображений)',
    'Задачи: в чат добавлена загрузка файлов — изображения оборачиваются в <img>, остальные — в <a>',
    'Задачи: групповая вкладка "Чаты" восстановлена (список group-chats + загрузка по ID задачи)',
    'LPI: добавлена кнопка "Обновить" на вкладку таблицы (загрузка всех данных из SQLite в локальную БД)',
    'LPI: исправлено отображение статуса "new" — теперь показывается как "Новая" (вместо "Завершена")',
    'LPI: статус active/completed теперь определяется из поля application_status БД LIMS (не по protocol_date)',
    'LPI: исправлено создание задач YouGile — columnId: undefined вместо пустой строки',
  ],
  '0.4.7': [
    'LPI: детали заявки — поля переведены в редактируемые (input) с кнопкой сохранения',
    'LPI: результаты измерений и выводы остались read-only',
  ],
  '0.4.8': [
    'LPI: добавлены настройки проекта/доски/колонки в блоке LPI (выпадающие списки)',
    'LPI: создание задач использует колонку из настроек вместо undefined',
  ],
  '0.4.9': [
    'LPI: статус received теперь считается завершённым (TERMINAL_STATUSES)',
    'LPI: добавлен isEffectivelyActive — completedLocally блокирует откат статуса',
    'LPI: детали заявки переведены в read-only, удалена кнопка "Завершить заявку"',
    'LPI: кнопка "Обновить" теперь также вызывает syncFromTasks для YouGile-завершений',
  ],
  '0.4.10': [
    'LPI дашборд: добавлена круговая диаграмма "Результаты испытания" (agg_gen_group)',
  ],
};

class ChangelogModal extends Modal {
  private version: string;
  private changes: string[];

  constructor(app: App, version: string, changes: string[]) {
    super(app);
    this.version = version;
    this.changes = changes;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: `✅ YouGile Integration обновлён до v${this.version}` });
    contentEl.createEl('hr');
    const list = contentEl.createEl('ul');
    for (const change of this.changes) {
      list.createEl('li', { text: change });
    }
    contentEl.createEl('hr');
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('OK').setCta().onClick(() => this.close()));
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default class YouGilePlugin extends Plugin {
  settings!: YouGileSettings;
  client!: YouGileClient;
  db!: LocalDatabase;
  emailDb!: EmailDatabase;
  contactDb!: ContactDatabase;
  llmService!: LLMService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.client = new YouGileClient();
    const apiKey = this.getSecretValue(this.settings.apiKeySecret);
    if (apiKey) {
      this.client.setApiKey(apiKey);
    }

    this.db = new LocalDatabase(this.app, this);
    await this.db.init();
    await this.db.sync();
    this.normalizeProjectBoardSettings();

    const currentVersion = this.manifest.version;
    if (this.settings.shownVersion !== currentVersion && CHANGELOG[currentVersion]) {
      this.settings.shownVersion = currentVersion;
      await this.saveSettings();
      this.app.workspace.onLayoutReady(() => {
        new ChangelogModal(this.app, currentVersion, CHANGELOG[currentVersion]).open();
      });
    }

    this.emailDb = new EmailDatabase(this.app);
    await this.emailDb.init();

    this.contactDb = new ContactDatabase(this.app);
    await this.contactDb.init();

    this.llmService = new LLMService(this);

    this.addSettingTab(new YouGileSettingTab(this.app, this));

    this.safeRegisterView(TASKS_VIEW_TYPE, (leaf) => new TasksView(leaf, this));
    if (this.settings.moduleCalendarEnabled) {
      this.safeRegisterView(SCHEDULE_VIEW_TYPE, (leaf) => new ScheduleView(leaf, this));
    }
    if (this.settings.moduleDocumentsEnabled) {
      this.safeRegisterView(DOCUMENTS_VIEW_TYPE, (leaf) => new DocumentsView(leaf, this));
    }
    if (this.settings.moduleEmailsEnabled) {
      this.safeRegisterView(EMAILS_VIEW_TYPE, (leaf) => new EmailsView(leaf, this));
    }
    if (this.settings.moduleDashboardEnabled) {
      this.safeRegisterView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    }
    this.safeRegisterView(SUGGESTIONS_VIEW_TYPE, (leaf) => new SuggestionsView(leaf, this));
    if (this.settings.moduleContactsEnabled) {
      this.safeRegisterView(CONTACTS_VIEW_TYPE, (leaf) => new ContactsView(leaf, this));
    }
    if (this.settings.moduleLpiEnabled) {
      this.safeRegisterView(LPI_VIEW_TYPE, (leaf) => new LpiView(leaf, this));
    }

    this.addRibbonIcon('list-todo', 'YouGile', () => {
      this.activateView();
    });

    if (this.settings.moduleCalendarEnabled) {
      this.addRibbonIcon('calendar', 'Расписание мероприятий', () => {
        this.activateScheduleView();
      });
    }

    if (this.settings.moduleDocumentsEnabled) {
      this.addRibbonIcon('file-text', 'Документы', () => {
        this.activateDocumentsView();
      });
    }

    if (this.settings.moduleEmailsEnabled) {
      this.addRibbonIcon('mail', 'Письма', () => {
        this.activateEmailsView();
      });
    }

    if (this.settings.moduleDashboardEnabled) {
      this.addRibbonIcon('bar-chart', 'Дашборд', () => {
        this.activateDashboardView();
      });
    }
    this.addRibbonIcon('lightbulb', 'Предложения', () => {
      this.activateSuggestionsView();
    });
    if (this.settings.moduleContactsEnabled) {
      this.addRibbonIcon('user', 'Контакты', () => {
        this.activateContactsView();
      });
    }
    if (this.settings.moduleLpiEnabled) {
      this.addRibbonIcon('flame', 'Лаборатория пожарных испытаний', () => {
        this.activateLpiView();
      });
    }

    registerCommands(this);
  }

  private safeRegisterView(type: string, viewCreator: (leaf: WorkspaceLeaf) => any): void {
    this.registerView(type as any, viewCreator as any);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(TASKS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SCHEDULE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DOCUMENTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(EMAILS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SUGGESTIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CONTACTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LPI_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    this.normalizeProjectBoardSettings();
    await this.saveData(this.settings);
    const apiKey = this.getSecretValue(this.settings.apiKeySecret);
    if (apiKey) {
      this.client.setApiKey(apiKey);
    }
  }

  private normalizeProjectBoardSettings(): void {
    const pairs: Array<{ projectKey: keyof YouGileSettings; boardKey: keyof YouGileSettings }> = [
      { projectKey: 'calendarProjectId', boardKey: 'calendarBoardId' },
      { projectKey: 'docsProjectId', boardKey: 'docsBoardId' },
      { projectKey: 'emailProjectId', boardKey: 'emailBoardId' },
      { projectKey: 'contactProjectId', boardKey: 'contactBoardId' },
    ];
    const projects = this.db.getProjects();
    const boards = this.db.getBoards();
    for (const pair of pairs) {
      const pVal = this.settings[pair.projectKey] as string;
      const bVal = this.settings[pair.boardKey] as string;
      if (pVal && !projects.some(p => p.id === pVal)) {
        const byTitle = projects.find(p => p.title === pVal);
        if (byTitle) (this.settings[pair.projectKey] as string) = byTitle.id;
      }
      if (bVal && !boards.some(b => b.id === bVal)) {
        const byTitle = boards.find(b => b.title === bVal);
        if (byTitle) (this.settings[pair.boardKey] as string) = byTitle.id;
      }
    }
  }

  getSecretValue(secretName: string): string | null {
    if (!secretName) {
      return null;
    }
    try {
      return this.app.secretStorage?.getSecret(secretName) ?? null;
    } catch {
      return null;
    }
  }

  saveSecret(secretName: string, value: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, value);
    } catch {
      console.error('YouGile: Failed to save secret', secretName);
    }
  }

  getPassword(): string | null {
    return this.getSecretValue(PASSWORD_SECRET_ID);
  }

  savePassword(password: string): void {
    this.saveSecret(PASSWORD_SECRET_ID, password);
  }

  async authenticate(): Promise<void> {
    const password = this.getPassword();
    if (!this.settings.login || !password || !this.settings.companyId) {
      throw new Error('Заполните логин, пароль и ID компании в настройках');
    }
    const key = await this.client.auth(
      this.settings.login,
      password,
      this.settings.companyId,
    );
    const secretName = `yougile-apikey-${Date.now()}`;
    this.saveSecret(secretName, key);
    this.settings.apiKeySecret = secretName;
    await this.saveSettings();
    new Notice('YouGile: API ключ получен и сохранён защищённо');
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: TASKS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateScheduleView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SCHEDULE_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: SCHEDULE_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateDocumentsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DOCUMENTS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: DOCUMENTS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateEmailsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EMAILS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: EMAILS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateDashboardView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateSuggestionsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SUGGESTIONS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: SUGGESTIONS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateContactsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CONTACTS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: CONTACTS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateLpiView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(LPI_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: LPI_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

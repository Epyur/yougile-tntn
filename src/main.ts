import { App, Plugin, Notice, Modal, Setting } from 'obsidian';
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

    this.emailDb = new EmailDatabase(this.app, this.settings.emailDbPath);
    await this.emailDb.init();

    this.contactDb = new ContactDatabase(this.app, this.settings.contactDbPath);
    await this.contactDb.init();

    this.llmService = new LLMService(this);

    this.addSettingTab(new YouGileSettingTab(this.app, this));

    this.registerView(TASKS_VIEW_TYPE, (leaf) => new TasksView(leaf, this));
    if (this.settings.moduleCalendarEnabled) {
      this.registerView(SCHEDULE_VIEW_TYPE, (leaf) => new ScheduleView(leaf, this));
    }
    if (this.settings.moduleDocumentsEnabled) {
      this.registerView(DOCUMENTS_VIEW_TYPE, (leaf) => new DocumentsView(leaf, this));
    }
    if (this.settings.moduleEmailsEnabled) {
      this.registerView(EMAILS_VIEW_TYPE, (leaf) => new EmailsView(leaf, this));
    }
    if (this.settings.moduleDashboardEnabled) {
      this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    }
    this.registerView(SUGGESTIONS_VIEW_TYPE, (leaf) => new SuggestionsView(leaf, this));
    if (this.settings.moduleContactsEnabled) {
      this.registerView(CONTACTS_VIEW_TYPE, (leaf) => new ContactsView(leaf, this));
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

    registerCommands(this);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(TASKS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SCHEDULE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DOCUMENTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(EMAILS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SUGGESTIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CONTACTS_VIEW_TYPE);
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
    if (this.emailDb) {
      this.emailDb.setDbPath(this.settings.emailDbPath);
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
}

import { Plugin, Notice } from 'obsidian';
import { YouGileSettings, DEFAULT_SETTINGS } from './types/settings';
import { YouGileClient } from './api/client';
import { YouGileSettingTab } from './ui/settings-tab';
import { TASKS_VIEW_TYPE, TasksView } from './ui/tasks-view';
import { SCHEDULE_VIEW_TYPE, ScheduleView } from './ui/schedule-view';
import { DOCUMENTS_VIEW_TYPE, DocumentsView } from './ui/documents-view';
import { EMAILS_VIEW_TYPE, EmailsView } from './ui/emails-view';
import { registerCommands } from './commands';
import { LocalDatabase } from './database/db';
import { EmailDatabase } from './database/email-db';
import { LLMService } from './services/llm-service';

const PASSWORD_SECRET_ID = 'yougile-password';

export default class YouGilePlugin extends Plugin {
  settings!: YouGileSettings;
  client!: YouGileClient;
  db!: LocalDatabase;
  emailDb!: EmailDatabase;
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

    this.emailDb = new EmailDatabase(this.app, this.settings.emailDbPath);
    await this.emailDb.init();

    this.llmService = new LLMService(this);

    this.addSettingTab(new YouGileSettingTab(this.app, this));

    this.registerView(TASKS_VIEW_TYPE, (leaf) => new TasksView(leaf, this));
    this.registerView(SCHEDULE_VIEW_TYPE, (leaf) => new ScheduleView(leaf, this));
    this.registerView(DOCUMENTS_VIEW_TYPE, (leaf) => new DocumentsView(leaf, this));
    this.registerView(EMAILS_VIEW_TYPE, (leaf) => new EmailsView(leaf, this));

    this.addRibbonIcon('list-todo', 'YouGile', () => {
      this.activateView();
    });

    this.addRibbonIcon('calendar', 'Расписание мероприятий', () => {
      this.activateScheduleView();
    });

    this.addRibbonIcon('file-text', 'Документы', () => {
      this.activateDocumentsView();
    });

    this.addRibbonIcon('mail', 'Письма', () => {
      this.activateEmailsView();
    });

    registerCommands(this);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(TASKS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SCHEDULE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DOCUMENTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(EMAILS_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    const apiKey = this.getSecretValue(this.settings.apiKeySecret);
    if (apiKey) {
      this.client.setApiKey(apiKey);
    }
    if (this.emailDb) {
      this.emailDb.setDbPath(this.settings.emailDbPath);
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
}

import { App } from 'obsidian';
import type { EmailDbData, MailItem, MailDirection } from '../types/emails';
import type { CachedTask } from '../types/cache';

const DB_PATH = 'yourbase/mailer_data.json';

export class EmailDatabase {
  private app: App;
  private data: EmailDbData = { emails: [], directions: [] };

  constructor(app: App) {
    this.app = app;
  }

  async init(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const exists = await adapter.exists(DB_PATH);
      if (exists) {
        const content = await adapter.read(DB_PATH);
        const parsed = JSON.parse(content);
        this.data = {
          emails: Array.isArray(parsed.emails) ? parsed.emails : [],
          directions: Array.isArray(parsed.directions) ? parsed.directions : [],
        };
      }
    } catch {
      // file not accessible yet
    }
  }

  private async save(): Promise<void> {
    try {
      await this.app.vault.adapter.write(DB_PATH, JSON.stringify(this.data, null, 2));
    } catch {
      console.error('YouGile: failed to save email db');
    }
  }

  getAllEmails(): MailItem[] {
    return this.data.emails;
  }

  getEmailById(id: string): MailItem | undefined {
    return this.data.emails.find(e => e.id === id);
  }

  addEmail(email: MailItem): void {
    this.data.emails.push(email);
    this.save();
  }

  updateEmail(id: string, updates: Partial<MailItem>): void {
    const idx = this.data.emails.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.data.emails[idx] = { ...this.data.emails[idx], ...updates };
      this.save();
    }
  }

  deleteEmail(id: string): void {
    this.data.emails = this.data.emails.filter(e => e.id !== id);
    this.save();
  }

  getAllDirections(): MailDirection[] {
    return this.data.directions;
  }

  addDirection(dir: MailDirection): void {
    this.data.directions.push(dir);
    this.save();
  }

  removeDirection(columnId: string): void {
    this.data.directions = this.data.directions.filter(d => d.columnId !== columnId);
    this.save();
  }

  syncFromTasks(tasks: CachedTask[]): void {
    const emailTasks = tasks.filter(t => {
      try {
        const desc = JSON.parse(t.description || '{}');
        return desc.type === 'email';
      } catch {
        return false;
      }
    });
    for (const task of emailTasks) {
      try {
        const desc = JSON.parse(task.description || '{}');
        const existing = this.data.emails.find(e => e.taskId === task.id);
        if (existing) {
          existing.title = task.title;
          existing.completed = task.completed;
        } else {
          this.data.emails.push({
            id: task.id,
            taskId: task.id,
            title: task.title,
            date: desc.date || '',
            appNumber: desc.appNumber || '',
            topic: desc.topic || '',
            content: desc.content || '',
            images: desc.images || [],
            directionName: desc.directionName || '',
            author: desc.author || '',
            completed: task.completed,
            textNumber: desc.textNumber || '',
          });
        }
      } catch {
        // skip invalid
      }
    }
    this.save();
  }
}

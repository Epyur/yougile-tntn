import { App } from 'obsidian';
import type { EmailDbData, MailItem, MailDirection } from '../types/emails';
import type { CachedTask } from '../types/cache';

export class EmailDatabase {
  private app: App;
  private dbPath: string;
  private data: EmailDbData = { emails: [], directions: [] };

  constructor(app: App, dbPath: string) {
    this.app = app;
    this.dbPath = dbPath;
  }

  setDbPath(path: string): void {
    this.dbPath = path;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  async init(): Promise<void> {
    const adapter = this.app.vault.adapter;
    try {
      const exists = await adapter.exists(this.dbPath);
      if (exists) {
        const content = await adapter.read(this.dbPath);
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
      await this.app.vault.adapter.write(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch {
      console.error('YouGile: failed to save email db');
    }
  }

  getAllEmails(): MailItem[] {
    return this.data.emails;
  }

  getEmail(id: number): MailItem | undefined {
    return this.data.emails.find(e => e.id === id);
  }

  getEmailByTaskId(taskId: string): MailItem | undefined {
    return this.data.emails.find(e => e.taskId === taskId);
  }

  addEmail(email: MailItem): void {
    const idx = this.data.emails.findIndex(e => e.id === email.id);
    if (idx !== -1) {
      this.data.emails[idx] = email;
    } else {
      this.data.emails.push(email);
    }
    this.save();
  }

  updateEmail(id: number, updates: Partial<MailItem>): void {
    const idx = this.data.emails.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.data.emails[idx] = { ...this.data.emails[idx], ...updates };
      this.save();
    }
  }

  getDirections(): MailDirection[] {
    return this.data.directions;
  }

  addDirection(dir: MailDirection): void {
    const idx = this.data.directions.findIndex(d => d.id === dir.id);
    if (idx !== -1) {
      this.data.directions[idx] = dir;
    } else {
      this.data.directions.push(dir);
    }
    this.save();
  }

  getDirectionName(id: number): string {
    const dir = this.data.directions.find(d => d.id === id);
    return dir?.name || `Направление ${id}`;
  }

  /** Синхронизирует задачи YouGile с локальной БД писем */
  syncFromTasks(tasks: CachedTask[]): void {
    let changed = false;
    for (const task of tasks) {
      if (!task.description) continue;
      const desc = task.description.trim();
      if (!desc.startsWith('{')) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(desc);
      } catch {
        continue;
      }
      if (parsed.type !== 'email') continue;

      const emailId = typeof parsed.emailId === 'number' ? parsed.emailId : this.hashTaskId(task.id);
      const existing = this.data.emails.find(e => e.id === emailId);

      const number = String(parsed.number ?? '');
      const subject = String(parsed.subject ?? task.title.replace(/^\[Письмо\]\s*/, ''));
      const text = String(parsed.text ?? '');
      const author = String(parsed.author ?? '');
      const date = String(parsed.date ?? task.timestamp ? new Date(task.timestamp).toISOString() : new Date().toISOString());
      const directionId = typeof parsed.direction_id === 'number' ? parsed.direction_id : 0;

      if (parsed.directionName) {
        const dirName = String(parsed.directionName);
        if (!this.data.directions.find(d => d.name === dirName)) {
          this.data.directions.push({
            id: directionId || Date.now(),
            name: dirName,
            description: '',
            created_at: new Date().toISOString(),
          });
          changed = true;
        }
      }

      if (existing) {
        if (task.updatedAt !== existing.lastSyncTime) {
          existing.number = number;
          existing.subject = subject;
          existing.text = text;
          existing.author = author;
          existing.date = date;
          existing.direction_id = directionId;
          existing.taskId = task.id;
          existing.lastSyncTime = task.updatedAt || new Date().toISOString();
          existing.sync_status = 'synced';
          changed = true;
        }
      } else {
        this.data.emails.push({
          id: emailId,
          number,
          subject,
          text,
          author,
          date,
          direction_id: directionId,
          images: [],
          mdFilePath: '',
          mdFileHash: '',
          lastSyncTime: task.updatedAt || new Date().toISOString(),
          sync_status: 'synced',
          created_at: date,
          taskId: task.id,
        });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private hashTaskId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}

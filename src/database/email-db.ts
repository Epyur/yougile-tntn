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

  getEmailById(id: number): MailItem | undefined {
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

  deleteEmail(id: number): void {
    this.data.emails = this.data.emails.filter(e => e.id !== id);
    this.save();
  }

  getDirections(): MailDirection[] {
    return this.data.directions;
  }

  getDirectionName(directionId: number): string {
    const dir = this.data.directions.find(d => d.id === directionId);
    return dir?.name || '';
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
      const date = String(parsed.date ?? new Date().toISOString());
      const directionId = typeof parsed.direction_id === 'number' ? parsed.direction_id : 0;
      const directionName = String(parsed.direction_name || parsed.directionName || '');

      if (existing) {
        existing.number = number;
        existing.subject = subject;
        existing.text = text;
        existing.author = author;
        existing.date = date;
        existing.direction_id = directionId;
        existing.direction_name = directionName;
        existing.taskId = task.id;
        existing.lastSyncTime = new Date().toISOString();
        existing.sync_status = 'synced';
        changed = true;
      } else {
        this.data.emails.push({
          id: emailId,
          number,
          subject,
          text,
          author,
          date,
          direction_id: directionId,
          direction_name: directionName,
          images: [],
          mdFilePath: '',
          mdFileHash: '',
          lastSyncTime: new Date().toISOString(),
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

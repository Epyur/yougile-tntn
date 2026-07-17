import { App } from 'obsidian';
import type { ContactItem, ContactDbData } from '../types/contacts';
import type { CachedTask } from '../types/cache';

export class ContactDatabase {
  private app: App;
  private dbPath: string;
  private data: ContactDbData = { contacts: [] };

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
          contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
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
      console.error('YouGile: failed to save contact db');
    }
  }

  getAllContacts(): ContactItem[] {
    return this.data.contacts;
  }

  getContact(id: number): ContactItem | undefined {
    return this.data.contacts.find(c => c.id === id);
  }

  getContactByTaskId(taskId: string): ContactItem | undefined {
    return this.data.contacts.find(c => c.taskId === taskId);
  }

  addContact(contact: ContactItem): void {
    const idx = this.data.contacts.findIndex(c => c.id === contact.id);
    if (idx !== -1) {
      this.data.contacts[idx] = contact;
    } else {
      this.data.contacts.push(contact);
    }
    this.save();
  }

  updateContact(id: number, updates: Partial<ContactItem>): void {
    const idx = this.data.contacts.findIndex(c => c.id === id);
    if (idx !== -1) {
      this.data.contacts[idx] = { ...this.data.contacts[idx], ...updates };
      this.save();
    }
  }

  /** Синхронизирует задачи YouGile (type=contact) с локальной БД контактов */
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
      if (parsed.type !== 'contact') continue;

      const contactId = typeof parsed.contactId === 'number' ? parsed.contactId : this.hashTaskId(task.id);
      const existing = this.data.contacts.find(c => c.id === contactId);

      if (existing) {
        if (task.updatedAt !== existing.updatedAt) {
          existing.name = String(parsed.name ?? existing.name);
          existing.phone = String(parsed.phone ?? existing.phone);
          existing.email = String(parsed.email ?? existing.email);
          existing.organization = String(parsed.organization ?? existing.organization);
          existing.position = String(parsed.position ?? existing.position);
          existing.notes = String(parsed.notes ?? existing.notes);
          existing.updatedAt = task.updatedAt || new Date().toISOString();
          existing.sync_status = 'synced';
          changed = true;
        }
      } else {
        this.data.contacts.push({
          id: contactId,
          name: String(parsed.name ?? task.title),
          phone: String(parsed.phone ?? ''),
          email: String(parsed.email ?? ''),
          organization: String(parsed.organization ?? ''),
          position: String(parsed.position ?? ''),
          notes: String(parsed.notes ?? ''),
          createdAt: task.timestamp ? new Date(task.timestamp).toISOString() : new Date().toISOString(),
          updatedAt: task.updatedAt || new Date().toISOString(),
          taskId: task.id,
          sync_status: 'synced',
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

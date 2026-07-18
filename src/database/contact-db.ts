import { App } from 'obsidian';
import type { ContactItem, ContactDbData } from '../types/contacts';
import type { CachedTask } from '../types/cache';

const DB_PATH = 'yourbase/contacts_data.json';

export class ContactDatabase {
  private app: App;
  private data: ContactDbData = { contacts: [] };

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
          contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
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
      console.error('YouGile: failed to save contact db');
    }
  }

  getAllContacts(): ContactItem[] {
    return this.data.contacts;
  }

  getContactById(id: string): ContactItem | undefined {
    return this.data.contacts.find(c => c.id === id);
  }

  addContact(contact: ContactItem): void {
    this.data.contacts.push(contact);
    this.save();
  }

  updateContact(id: string, updates: Partial<ContactItem>): void {
    const idx = this.data.contacts.findIndex(c => c.id === id);
    if (idx !== -1) {
      this.data.contacts[idx] = { ...this.data.contacts[idx], ...updates };
      this.save();
    }
  }

  deleteContact(id: string): void {
    this.data.contacts = this.data.contacts.filter(c => c.id !== id);
    this.save();
  }

  syncFromTasks(tasks: CachedTask[]): void {
    const contactTasks = tasks.filter(t => {
      try {
        const desc = JSON.parse(t.description || '{}');
        return desc.type === 'contact';
      } catch {
        return false;
      }
    });
    for (const task of contactTasks) {
      try {
        const parsed = JSON.parse(task.description || '{}');
        const existing = this.data.contacts.find(c => c.taskId === task.id);
        const orgType = task.columnId || parsed.orgType || '';
        if (existing) {
          existing.name = task.title;
          existing.orgType = orgType;
          existing.phone = parsed.phone || '';
          existing.email = parsed.email || '';
          existing.organization = parsed.organization || '';
          existing.position = parsed.position || '';
          existing.note = parsed.note || '';
          existing.completed = task.completed;
        } else {
          this.data.contacts.push({
            id: task.id,
            taskId: task.id,
            name: task.title,
            orgType,
            phone: parsed.phone || '',
            email: parsed.email || '',
            organization: parsed.organization || '',
            position: parsed.position || '',
            note: parsed.note || '',
            completed: task.completed,
          });
        }
      } catch {
        // skip invalid
      }
    }
    this.save();
  }
}

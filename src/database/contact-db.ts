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

  async syncFromTasks(tasks: CachedTask[]): Promise<void> {
    const contactTasks = tasks.filter(t => {
      try {
        const desc = JSON.parse(t.description || '{}');
        return desc.type === 'contact';
      } catch {
        return false;
      }
    });
    let updatedCount = 0;
    let addedCount = 0;
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
          existing.notes = parsed.notes || parsed.note || '';
          updatedCount++;
        } else {
          const now = new Date().toISOString();
          this.data.contacts.push({
            id: task.id,
            taskId: task.id,
            name: task.title,
            orgType,
            phone: parsed.phone || '',
            email: parsed.email || '',
            organization: parsed.organization || '',
            position: parsed.position || '',
            notes: parsed.notes || parsed.note || '',
            createdAt: parsed.createdAt || now,
            updatedAt: parsed.updatedAt || now,
            sync_status: 'synced',
          });
          addedCount++;
        }
      } catch {
        // skip invalid
      }
    }
    await this.save();
    if (contactTasks.length > 0) {
      this.logSync(addedCount, updatedCount);
    }
  }

  private logSync(added: number, updated: number): void {
    if (!this.app) return;
    try {
      const { SyncLogger } = require('../services/sync-logger');
      const logger = new SyncLogger(this.app);
      logger.init().then(() => {
        logger.log({
          module: 'contacts',
          direction: 'from-yougile',
          action: 'sync-complete',
          itemId: '',
          status: 'success',
          details: `Синхронизировано из YouGile. Добавлено: ${added}, обновлено: ${updated}`,
        });
      });
    } catch {}
  }
}

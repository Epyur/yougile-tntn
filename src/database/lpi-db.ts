import { App, Notice } from 'obsidian';
import type { LpiCompletedEntry, LpiCompletedDbData } from '../types/lpi';
import type YouGilePlugin from '../main';

const DB_PATH = 'yourbase/lpi_completed.json';

export class LpiDatabase {
  private app: App;
  private plugin: YouGilePlugin;
  private data: LpiCompletedDbData = { entries: [] };

  constructor(app: App, plugin: YouGilePlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(DB_PATH);
      if (exists) {
        const content = await this.app.vault.adapter.read(DB_PATH);
        const parsed = JSON.parse(content);
        this.data = { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
      }
    } catch {}
  }

  private async save(): Promise<void> {
    try {
      await this.app.vault.adapter.write(DB_PATH, JSON.stringify(this.data, null, 2));
    } catch {}
  }

  getAll(): LpiCompletedEntry[] {
    return this.data.entries;
  }

  getByAggregateId(id: string): LpiCompletedEntry | undefined {
    return this.data.entries.find(e => e.aggregate_id === id);
  }

  add(entry: LpiCompletedEntry): void {
    const idx = this.data.entries.findIndex(e => e.id === entry.id);
    if (idx !== -1) {
      this.data.entries[idx] = entry;
    } else {
      this.data.entries.push(entry);
    }
    this.save();
  }

  update(id: number, updates: Partial<LpiCompletedEntry>): void {
    const idx = this.data.entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.data.entries[idx] = { ...this.data.entries[idx], ...updates };
      this.save();
    }
  }

  getNextId(): number {
    if (this.data.entries.length === 0) return 1;
    return Math.max(...this.data.entries.map(e => e.id)) + 1;
  }

  async syncFromTasks(): Promise<void> {
    const client = this.plugin.client;
    if (!client) return;
    try {
      const tasks: any[] = await client.getTasks();
      const lpiTasks = tasks.filter((t: any) => {
        try {
          const desc = JSON.parse(t.description || '{}');
          return desc.type === 'lpi_completed' && t.completed;
        } catch { return false; }
      });
      for (const task of lpiTasks) {
        const desc = JSON.parse(task.description || '{}');
        const existing = this.data.entries.find(e => e.taskId === task.id);
        if (!existing && desc.aggregate_id) {
          this.data.entries.push({
            id: this.getNextId(),
            taskId: task.id,
            aggregate_id: desc.aggregate_id,
            application_external_id: desc.application_external_id || '',
            product_name: desc.product_name || '',
            completed_at: desc.completed_at || '',
            protocol_date: desc.protocol_date || '',
            agg_gen_group_complience: desc.agg_gen_group_complience || '',
            customer_name: desc.customer_name || '',
            customer_mail: desc.customer_mail || '',
            organization: desc.organization || '',
            ekn: desc.ekn || '',
          });
        }
      }
      this.save();
    } catch {}
  }
}

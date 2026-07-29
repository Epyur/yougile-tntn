import { Notice, requestUrl } from 'obsidian';
import type { LpiItem } from '../types/lpi';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { LpiView } from './lpi-view';
import { isCompleted, isBeforeCutoff } from './lpi-utils';

const DB_PATH = 'yourbase/lpi_data.json';

export class LpiSync {
  private view: LpiView;

  constructor(view: LpiView) {
    this.view = view;
  }

  async loadData(): Promise<LpiItem[]> {
    try {
      const exists = await this.view.app.vault.adapter.exists(DB_PATH);
      if (exists) {
        const content = await this.view.app.vault.adapter.read(DB_PATH);
        return JSON.parse(content);
      }
    } catch {}
    return [];
  }

  async saveData(items: LpiItem[]): Promise<void> {
    try {
      await this.view.app.vault.adapter.write(DB_PATH, JSON.stringify(items, null, 2));
    } catch {}
  }

  private wasmBinary: ArrayBuffer | null = null;

  async getWasmBinary(): Promise<ArrayBuffer> {
    if (this.wasmBinary) return this.wasmBinary;
    const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
    try {
      const buf = fs.readFileSync(wasmPath);
      this.wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return this.wasmBinary;
    } catch {
      const url = 'https://raw.githubusercontent.com/Epyur/yougile-tntn/main/sql-wasm.wasm';
      const resp = await requestUrl({ url });
      this.wasmBinary = resp.arrayBuffer;
      try { fs.writeFileSync(wasmPath, Buffer.from(resp.arrayBuffer)); } catch {}
      return this.wasmBinary;
    }
  }

  getAllYougileExtIds(): Promise<Set<string>> {
    return this.view.plugin.client!.getTasks().then((tasks: any[]) => {
      const ids = new Set<string>();
      for (const t of tasks) {
        try {
          const desc = JSON.parse(t.description || '{}');
          if (desc.type === 'lpi_data' || desc.type === 'lpi_completed') {
            if (desc.application_external_id) ids.add(desc.application_external_id);
          }
        } catch {}
      }
      return ids;
    });
  }

  private async readSqliteItems(): Promise<LpiItem[]> {
    let dbPath = this.view.plugin.settings.lpiDbPath;
    if (!dbPath) throw new Error('Укажите путь к SQLite БД в настройках LPI');
    dbPath = dbPath.replace(/\\/g, '/');
    if (!fs.existsSync(dbPath)) throw new Error('Файл БД не найден: ' + dbPath);

    const wasmBinary = await this.getWasmBinary();
    const SQL = await initSqlJs({ wasmBinary: wasmBinary.slice(0) });
    const dbBuf = fs.readFileSync(dbPath);
    const db = new SQL.Database(new Uint8Array(dbBuf));
    await this.view.loadViewConfig();
    const sql = this.view.viewConfig.loadQuery;
    const stmt = db.prepare(sql);
    const sqliteItems: LpiItem[] = [];
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      obj.thickness = obj.thickness !== null ? Number(obj.thickness) : null;
      obj.source_series_count = null;
      obj.source_series_range = null;
      obj.calculation_type = null;
      obj.result_data = null;
      sqliteItems.push(obj as LpiItem);
    }
    stmt.free();
    db.close();
    return sqliteItems;
  }

  async loadNewFromSqlite(items: LpiItem[]): Promise<{ items: LpiItem[]; added: number }> {
    const plugin = this.view.plugin;
    try {
      const sqliteItems = await this.readSqliteItems();

      const localExtIds = new Set(items.filter(i => i.application_external_id).map(i => i.application_external_id));
      const localAggIds = new Set(items.map(i => i.aggregate_id));

      let yougileExtIds = new Set<string>();
      try {
        yougileExtIds = await this.getAllYougileExtIds();
      } catch {}

      const newItems = [...items];
      let added = 0;

      for (const item of sqliteItems) {
        if (localAggIds.has(item.aggregate_id)) continue;
        const extId = item.application_external_id;
        if (!extId) continue;
        if (localExtIds.has(extId)) continue;
        if (yougileExtIds.has(extId)) continue;

        newItems.push(item);
        localAggIds.add(item.aggregate_id);
        localExtIds.add(extId);
        added++;
      }

      if (added > 0) {
        await plugin.syncLogger.log({
          module: 'lpi',
          direction: 'local',
          action: 'load-sql-new',
          itemId: '',
          status: 'success',
          details: `SQLite → новые: ${added} заявок`,
        });
      }

      return { items: newItems, added };
    } catch (e: any) {
      await plugin.syncLogger.log({
        module: 'lpi',
        direction: 'local',
        action: 'load-sql-new',
        itemId: '',
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async syncItemFromSqlite(item: LpiItem): Promise<boolean> {
    const plugin = this.view.plugin;
    try {
      const sqliteItems = await this.readSqliteItems();
      const sqliteItem = sqliteItems.find(i => i.aggregate_id === item.aggregate_id);
      if (!sqliteItem) {
        new Notice('Заявка не найдена в SQLite');
        return false;
      }

      const { taskId } = item;

      // Collect changes before overwriting
      const changes: { label: string; local: string; remote: string }[] = [];
      const compareFields = [
        { key: 'protocol_date', label: 'Дата протокола' },
        { key: 'agg_gen_group_complience', label: 'Оценка соответствия' },
        { key: 'agg_gen_group', label: 'Результат испытания' },
        { key: 'product_name', label: 'Материал' },
      ];
      for (const cf of compareFields) {
        const oldVal = String((item as any)[cf.key] ?? '');
        const newVal = String((sqliteItem as any)[cf.key] ?? '');
        if (oldVal !== newVal && newVal) {
          changes.push({ label: cf.label, local: oldVal || '—', remote: newVal });
        }
      }

      Object.assign(item, sqliteItem);
      item.taskId = taskId;
      item.updatedAt = new Date().toISOString();
      item.updatedBy = this.view.plugin.settings.login || 'local';

      if (changes.length > 0) {
        new Notice(`Заявка №${item.application_external_id}: обновлено ${changes.length} полей из SQLite`);
      } else {
        new Notice(`Заявка №${item.application_external_id} обновлена из SQLite`);
      }
      return true;
    } catch (e: any) {
      new Notice('Ошибка обновления из SQLite: ' + e.message);
      return false;
    }
  }

  async syncFromTasks(items: LpiItem[]): Promise<{ items: LpiItem[]; hasChanges: boolean }> {
    const plugin = this.view.plugin;
    if (!plugin.client) return { items, hasChanges: false };
    // Resolve LPI project ID from settings (title → ID)
    let lpiProjectId: string | undefined;
    try {
      const projects: any[] = await plugin.client.getProjects();
      const projectTitle = plugin.settings.lpiProjectId;
      if (projectTitle) {
        const match = projects.find((p: any) => p.title === projectTitle || p.id === projectTitle);
        if (match) lpiProjectId = match.id;
      }
    } catch {}
    const tasks: any[] = lpiProjectId
      ? await plugin.client.getTasksByProject(lpiProjectId)
      : await plugin.client.getTasks();
    const lpiTasks = tasks.filter((t: any) => {
      try {
        const desc = JSON.parse(t.description || '{}');
        return desc.type === 'lpi_completed' || desc.type === 'lpi_data';
      } catch { return false; }
    });

    if (lpiTasks.length > 0) {
      console.log('YouGile LPI sample:', lpiTasks.slice(0, 3).map((t: any) => ({
        id: t.id,
        title: t.title,
        completed: t.completed,
        desc: t.description?.slice(0, 200),
      })));
    }
    console.log(`YouGile LPI sync: всего задач=${tasks.length}, LPI-задач=${lpiTasks.length}, локальных заявок=${items.length}`);

    let changed = false;
    let updated = 0;
    let imported = 0;
    const newItems = [...items];
    const existingExtIds = new Set(newItems.filter(i => i.application_external_id).map(i => i.application_external_id));
    const pendingChanges: {
      extId: string;
      existing: LpiItem;
      desc: Record<string, any>;
      changes: { label: string; field: string; local: string; remote: string }[];
      taskId: string;
      completed: boolean;
    }[] = [];

    for (const task of lpiTasks) {
      const desc = JSON.parse(task.description || '{}');
      const extId = String(desc.application_external_id || '');

      if (!extId) continue;

      if (!existingExtIds.has(extId)) {
          const newItem: LpiItem = { ...desc, taskId: task.id, updatedAt: task.updatedAt || desc.updated_at || '', updatedBy: desc.updated_by || '' } as LpiItem;
        newItems.push(newItem);
        existingExtIds.add(extId);
        imported++;
        changed = true;
        await plugin.syncLogger.log({
          module: 'lpi',
          direction: 'from-yougile',
          action: 'import',
          itemId: extId,
          itemTitle: desc.product_name || task.title,
          status: 'success',
          details: 'Автоимпорт новой заявки из YouGile',
        });
        continue;
      }

      const existing = newItems.find(i => i.application_external_id === extId);
      if (!existing) continue;

      if (!existing.taskId) {
        existing.taskId = task.id;
        changed = true;
      }

      // Detect changes from YouGile
      const changes: { label: string; field: string; local: string; remote: string }[] = [];
      const compareFields = [
        { key: 'protocol_date', label: 'Дата протокола' },
        { key: 'agg_gen_group_complience', label: 'Оценка соответствия' },
        { key: 'agg_gen_group', label: 'Результат испытания' },
        { key: 'product_name', label: 'Материал' },
      ];
      for (const cf of compareFields) {
        const lv = String((existing as any)[cf.key] ?? '');
        const rv = String(desc[cf.key] ?? '');
        if (lv !== rv) {
          changes.push({ label: cf.label, field: cf.key, local: lv || '—', remote: rv || '—' });
        }
      }

      // Check status change
      const localCompleted = isCompleted(existing);
      const remoteCompleted = !!desc.protocol_date || !!task.completed;
      if (localCompleted !== remoteCompleted) {
        changes.push({
          label: 'Статус',
          field: '_status',
          local: localCompleted ? 'Завершена' : 'Активна',
          remote: remoteCompleted ? 'Завершена' : 'Активна',
        });
      }

      const remoteUpdatedAt = desc.updated_at || task.updatedAt || '';
      const localUpdatedAt = existing.updatedAt || '';

      if (changes.length > 0 && remoteUpdatedAt >= localUpdatedAt) {
        // Show dialog — collect all such tasks, apply after loop
        pendingChanges.push({
          extId,
          existing,
          desc,
          changes,
          taskId: task.id,
          completed: task.completed,
        });
      }
    }

    console.log(`YouGile LPI sync: итог — обновлено=${updated}, импортировано=${imported}, pending=${pendingChanges.length}`);

    // Apply pending changes (auto-apply if newer from YouGile)
    for (const pc of pendingChanges) {
      for (const ch of pc.changes) {
        if (ch.field !== '_status') {
          (pc.existing as any)[ch.field] = pc.desc[ch.field];
        }
      }
      if (pc.desc.protocol_date) pc.existing.protocol_date = pc.desc.protocol_date;
      if (pc.desc.updated_at) pc.existing.updatedAt = pc.desc.updated_at;
      if (pc.desc.updated_by) pc.existing.updatedBy = pc.desc.updated_by;
      changed = true;
      updated++;
      await plugin.syncLogger.log({
        module: 'lpi',
        direction: 'from-yougile',
        action: 'update-from-remote',
        itemId: pc.extId,
        itemTitle: pc.existing.product_name,
        status: 'success',
        details: `Обновлено ${pc.changes.length} полей из YouGile`,
      });
    }

    if (lpiTasks.length > 0) {
      await plugin.syncLogger.log({
        module: 'lpi',
        direction: 'from-yougile',
        action: 'sync-complete',
        itemId: '',
        status: 'success',
        details: `Обработано задач YouGile: ${lpiTasks.length}, обновлено: ${updated}, импортировано: ${imported}`,
      });
    }

    return { items: newItems, hasChanges: changed || imported > 0 };
  }

  async syncItemToYougile(item: LpiItem): Promise<boolean> {
    const plugin = this.view.plugin;
    const completed = isCompleted(item);
    const fullJson = this.view.buildFullJson(item);
    const desc = JSON.stringify(fullJson);
    const itemId = item.application_external_id || item.aggregate_id;
    const itemTitle = item.product_name;

    if (item.taskId) {
      const payload: Record<string, unknown> = { description: desc };
      if (completed) payload.completed = true;
      try {
        await plugin.client!.updateTask(item.taskId, payload);
        await plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'update',
          itemId, itemTitle,
          status: 'success',
          details: completed ? 'Задача завершена' : 'Описание обновлено',
        });
        return true;
      } catch (e: unknown) {
        await plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'update',
          itemId, itemTitle,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    } else {
      try {
        const result: any = await plugin.client!.createTask({
          title: `LPI: ${item.application_external_id} — ${item.product_name}`,
          description: desc,
          columnId: this.view.getLpiColumnId(),
        } as any);
        if (result?.id) {
          item.taskId = result.id;
          if (completed) {
            await plugin.client!.updateTask(result.id, { completed: true });
          }
          await plugin.syncLogger.log({
            module: 'lpi',
            direction: 'to-yougile',
            action: 'create',
            itemId, itemTitle,
            status: 'success',
            details: `taskId: ${result.id}${completed ? ', завершена' : ''}`,
          });
          return true;
        }
        return false;
      } catch (e: unknown) {
        await plugin.syncLogger.log({
          module: 'lpi',
          direction: 'to-yougile',
          action: 'create',
          itemId, itemTitle,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    }
  }
}

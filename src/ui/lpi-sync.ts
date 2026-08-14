import { Notice, requestUrl } from 'obsidian';
import type { LpiItem, LpiTaskDescription, LpiComparableField } from '../types/lpi';
import { LPI_COMPARE_FIELDS } from '../types/lpi';
import type { YouGileTask } from '../types/yougile';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { LpiView } from './lpi-view';
import { isCompleted, parseLpiDescription, isLpiTaskDescription } from './lpi-utils';
import { errorMessage } from '../utils/errors';

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
        const parsed: unknown = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed as LpiItem[];
      }
    } catch (e: unknown) {
      console.error('LPI loadData error:', errorMessage(e));
    }
    return [];
  }

  async saveData(items: LpiItem[]): Promise<void> {
    try {
      await this.view.app.vault.adapter.write(DB_PATH, JSON.stringify(items, null, 2));
    } catch (e: unknown) {
      console.error('LPI saveData error:', errorMessage(e));
    }
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
      try {
        fs.writeFileSync(wasmPath, Buffer.from(resp.arrayBuffer));
      } catch (e: unknown) {
        console.error('LPI: не удалось закэшировать sql-wasm.wasm:', errorMessage(e));
      }
      return this.wasmBinary;
    }
  }

  async getAllYougileExtIds(): Promise<Set<string>> {
    const client = this.view.plugin.client;
    if (!client) return new Set<string>();
    const tasks = await client.getTasks();
    const ids = new Set<string>();
    for (const t of tasks) {
      const desc = parseLpiDescription(t.description);
      if (isLpiTaskDescription(desc) && desc.application_external_id) {
        ids.add(desc.application_external_id);
      }
    }
    return ids;
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
      const row = stmt.getAsObject();
      const item = {
        ...row,
        thickness: row.thickness !== null && row.thickness !== undefined ? Number(row.thickness) : null,
        source_series_count: null,
        source_series_range: null,
        calculation_type: null,
        result_data: null,
      } as unknown as LpiItem;
      sqliteItems.push(item);
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
      } catch (e: unknown) {
        console.error('LPI: не удалось получить список заявок из YouGile:', errorMessage(e));
      }

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
    } catch (e: unknown) {
      await plugin.syncLogger.log({
        module: 'lpi',
        direction: 'local',
        action: 'load-sql-new',
        itemId: '',
        status: 'error',
        error: errorMessage(e),
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
      for (const cf of LPI_COMPARE_FIELDS) {
        const oldVal = String(item[cf.key] ?? '');
        const newVal = String(sqliteItem[cf.key] ?? '');
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
    } catch (e: unknown) {
      new Notice('Ошибка обновления из SQLite: ' + errorMessage(e));
      return false;
    }
  }

  async syncFromTasks(items: LpiItem[]): Promise<{ items: LpiItem[]; hasChanges: boolean }> {
    const plugin = this.view.plugin;
    if (!plugin.client) return { items, hasChanges: false };
    // Resolve LPI project ID from settings (title → ID)
    let lpiProjectId: string | undefined;
    try {
      const projects = await plugin.client.getProjects();
      const projectTitle = plugin.settings.lpiProjectId;
      if (projectTitle) {
        const match = projects.find(p => p.title === projectTitle || p.id === projectTitle);
        if (match) lpiProjectId = match.id;
      }
    } catch (e: unknown) {
      console.error('LPI: не удалось определить проект LPI:', errorMessage(e));
    }
    const tasks: YouGileTask[] = lpiProjectId
      ? await plugin.client.getTasksByProject(lpiProjectId)
      : await plugin.client.getTasks();
    const lpiTasks: { task: YouGileTask; desc: LpiTaskDescription }[] = [];
    for (const t of tasks) {
      const desc = parseLpiDescription(t.description);
      if (isLpiTaskDescription(desc)) lpiTasks.push({ task: t, desc });
    }

    if (lpiTasks.length > 0) {
      console.log('YouGile LPI sample:', lpiTasks.slice(0, 3).map(({ task }) => ({
        id: task.id,
        title: task.title,
        completed: task.completed,
        desc: task.description?.slice(0, 200),
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
      desc: LpiTaskDescription;
      changes: { label: string; field: LpiComparableField | '_status'; local: string; remote: string }[];
      taskId: string;
      completed: boolean;
    }[] = [];

    for (const { task, desc } of lpiTasks) {
      const extId = String(desc.application_external_id || '');

      if (!extId) continue;

      if (!existingExtIds.has(extId)) {
        const newItem = {
          ...desc,
          taskId: task.id,
          updatedAt: task.updatedAt || desc.updated_at || '',
          updatedBy: desc.updated_by || '',
        } as unknown as LpiItem;
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
      const changes: { label: string; field: LpiComparableField | '_status'; local: string; remote: string }[] = [];
      for (const cf of LPI_COMPARE_FIELDS) {
        const lv = String(existing[cf.key] ?? '');
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
          completed: !!task.completed,
        });
      }
    }

    console.log(`YouGile LPI sync: итог — обновлено=${updated}, импортировано=${imported}, pending=${pendingChanges.length}`);

    // Apply pending changes (auto-apply if newer from YouGile)
    for (const pc of pendingChanges) {
      for (const ch of pc.changes) {
        if (ch.field === '_status') continue;
        if (ch.field === 'protocol_date') pc.existing.protocol_date = pc.desc.protocol_date ?? null;
        else if (ch.field === 'agg_gen_group') pc.existing.agg_gen_group = pc.desc.agg_gen_group ?? null;
        else if (ch.field === 'agg_gen_group_complience') pc.existing.agg_gen_group_complience = pc.desc.agg_gen_group_complience ?? null;
        else if (ch.field === 'product_name' && pc.desc.product_name) pc.existing.product_name = pc.desc.product_name;
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
    const client = plugin.client;
    if (!client) throw new Error('Нет подключения к YouGile');
    const completed = isCompleted(item);
    const fullJson = this.view.buildFullJson(item);
    const desc = JSON.stringify(fullJson);
    const itemId = item.application_external_id || item.aggregate_id;
    const itemTitle = item.product_name;

    if (item.taskId) {
      const payload: Record<string, unknown> = { description: desc };
      if (completed) payload.completed = true;
      try {
        await client.updateTask(item.taskId, payload);
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
          error: errorMessage(e),
        });
        throw e;
      }
    } else {
      try {
        const result = await client.createTask({
          title: `LPI: ${item.application_external_id} — ${item.product_name}`,
          description: desc,
          columnId: this.view.getLpiColumnId(),
        });
        if (result?.id) {
          item.taskId = result.id;
          if (completed) {
            await client.updateTask(result.id, { completed: true });
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
          error: errorMessage(e),
        });
        throw e;
      }
    }
  }
}

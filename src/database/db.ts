import { App } from 'obsidian';
import { CacheData, CachedTask, CachedProject, CachedBoard, CachedColumn, OfflineAction, CachedSubtask } from '../types/cache';
import type { YouGileUser } from '../types/yougile';
import type YouGilePlugin from '../main';

const DATA_FILE = 'yourbase/yougile_cache.json';

export class LocalDatabase {
  private app: App;
  private plugin: YouGilePlugin;
  private data: CacheData = {
    tasks: [],
    projects: [],
    boards: [],
    columns: [],
    lastSyncAt: 0,
    offlineQueue: [],
  };
  private initialized = false;
  private userMap = new Map<string, string>();
  private _users: Array<{ id: string; name: string; email: string }> = [];

  constructor(app: App, plugin: YouGilePlugin) {
    this.app = app;
    this.plugin = plugin;
  }

  async init(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(DATA_FILE);
      if (exists) {
        const content = await adapter.read(DATA_FILE);
        const parsed = JSON.parse(content) as CacheData;
        this.data = {
          tasks: parsed.tasks ?? [],
          projects: parsed.projects ?? [],
          boards: parsed.boards ?? [],
          columns: parsed.columns ?? [],
          lastSyncAt: parsed.lastSyncAt ?? 0,
          offlineQueue: parsed.offlineQueue ?? [],
        };
      }
      this.initialized = true;
    } catch {
      this.initialized = true;
    }
  }

  private async save(): Promise<void> {
    if (!this.initialized) return;
    try {
      await this.app.vault.adapter.write(DATA_FILE, JSON.stringify(this.data, null, 2));
    } catch {
      console.error('YouGile: failed to save cache');
    }
  }

  getTasks(): CachedTask[] {
    return this.data.tasks;
  }

  getTask(id: string): CachedTask | undefined {
    return this.data.tasks.find(t => t.id === id);
  }

  getProjects(): CachedProject[] {
    return this.data.projects;
  }

  getBoards(): CachedBoard[] {
    return this.data.boards;
  }

  getColumns(): CachedColumn[] {
    return this.data.columns;
  }

  getLastSyncAt(): number {
    return this.data.lastSyncAt;
  }

  getUserName(id: string): string {
    return this.userMap.get(id) ?? id;
  }

  getUsers(): Array<{ id: string; name: string; email: string }> {
    return this._users;
  }

  getUniqueAssignees(): string[] {
    const set = new Set<string>();
    for (const t of this.data.tasks) {
      if (Array.isArray(t.assigned)) {
        for (const a of t.assigned) {
          if (a) set.add(a);
        }
      }
    }
    return [...set].map(id => this.getUserName(id));
  }

  getOfflineQueue(): OfflineAction[] {
    return this.data.offlineQueue;
  }

  addToOfflineQueue(action: Omit<OfflineAction, 'id' | 'createdAt' | 'synced'>): void {
    const entry: OfflineAction = {
      ...action,
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      synced: false,
    };
    this.data.offlineQueue.push(entry);
    this.save();
  }

  markOfflineSynced(id: string): void {
    const idx = this.data.offlineQueue.findIndex(a => a.id === id);
    if (idx !== -1) {
      this.data.offlineQueue[idx].synced = true;
      this.save();
    }
  }

  removeOfflineAction(id: string): void {
    this.data.offlineQueue = this.data.offlineQueue.filter(a => a.id !== id);
    this.save();
  }

  hasUnsynchronizedActions(): boolean {
    return this.data.offlineQueue.some(a => !a.synced);
  }

  async sync(): Promise<void> {
    if (!this.plugin.settings.apiKeySecret || !this.plugin.getSecretValue(this.plugin.settings.apiKeySecret)) {
      return;
    }

    try {
      let remoteUsers: YouGileUser[] = [];
      try {
        remoteUsers = await this.plugin.client.getUsers();
      } catch {
        // users endpoint may not be available
      }
      this.userMap.clear();
      this._users = [];
      for (const u of remoteUsers) {
        const name = u.name || u.email || u.id;
        this.userMap.set(u.id, name);
        this._users.push({ id: u.id, name: name, email: u.email || name });
      }

      let remoteProjects: Array<{ id: string; title: string }> = [];
      try {
        remoteProjects = await this.plugin.client.getProjects();
      } catch (e: unknown) {
        console.warn('YouGile: failed to load projects', e instanceof Error ? e.message : String(e));
      }

      let allBoards: CachedBoard[] = [];
      try {
        const boards = await this.plugin.client.getBoards();
        allBoards = boards.map(b => ({ id: b.id, title: b.title, projectId: b.projectId }));
      } catch (e: unknown) {
        console.warn('YouGile: failed to load boards', e instanceof Error ? e.message : String(e));
      }

      let remoteTasks = await this.plugin.client.getTasks();

      let allColumns: CachedColumn[] = [];
      try {
        const cols = await this.plugin.client.getColumns();
        allColumns = cols.map(col => ({ id: col.id, title: col.title, boardId: col.boardId }));
      } catch {
        // fallback: try per-board column fetch
        const columnIds = new Set<string>();
        for (const board of allBoards) {
          try {
            const boardCols = await this.plugin.client.getColumns(board.id);
            for (const col of boardCols) {
              if (!columnIds.has(col.id)) {
                columnIds.add(col.id);
                allColumns.push({ id: col.id, title: col.title, boardId: col.boardId });
              }
            }
          } catch {
            // per-board column fetch may fail
          }
        }
        if (allColumns.length === 0) {
          // ultimate fallback: collect columns from tasks
          for (const rt of remoteTasks) {
            if (rt.columnId) columnIds.add(rt.columnId);
          }
          for (const colId of columnIds) {
            try {
              const col = await this.plugin.client.getColumnById(colId);
              allColumns.push({ id: col.id, title: col.title, boardId: col.boardId });
            } catch {
              // individual column fetch may fail
            }
          }
        }
      }

      this.data.projects = remoteProjects.map(p => ({ id: p.id, title: p.title }));
      this.data.boards = allBoards;
      this.data.columns = allColumns;

      // Exclude LPI tasks from general cache
      const lpiProjectId = this.getLpiProjectId();
      if (lpiProjectId) {
        const lpiBoardIds = new Set(allBoards.filter(b => b.projectId === lpiProjectId).map(b => b.id));
        const lpiColumnIds = new Set(allColumns.filter(c => lpiBoardIds.has(c.boardId)).map(c => c.id));
        if (lpiColumnIds.size > 0) {
          remoteTasks = remoteTasks.filter(t => !lpiColumnIds.has(t.columnId ?? ''));
        }
      }

      const now = Date.now();

      const taskMap = new Map(remoteTasks.map(t => [t.id, t]));

      const allSubtaskIds = new Set<string>();
      for (const rt of remoteTasks) {
        if (rt.subtasks) {
          for (const sid of rt.subtasks) {
            allSubtaskIds.add(sid);
          }
        }
      }
      const subtaskCache = new Map<string, string>();
      for (const sid of allSubtaskIds) {
        const known = taskMap.get(sid);
        if (known && known.title) {
          subtaskCache.set(sid, known.title);
        } else {
          try {
            const st = await this.plugin.client.getTaskById(sid);
            subtaskCache.set(sid, st.title || sid);
          } catch {
            subtaskCache.set(sid, sid);
          }
        }
      }

      const boardMap = new Map(allBoards.map(b => [b.id, b]));
      const columnMap = new Map(allColumns.map(c => [c.id, c]));
      const projectMap = new Map(remoteProjects.map(p => [p.id, p.title]));

      const mergedTasks: CachedTask[] = [];
      const existingMap = new Map(this.data.tasks.map(t => [t.id, t]));

      const processedIds = new Set<string>();

      for (const rt of remoteTasks) {
        processedIds.add(rt.id);
        const existing = existingMap.get(rt.id);
        if (existing && existing.updatedAt === rt.updatedAt) {
          mergedTasks.push(existing);
        } else {
          const colId = rt.columnId ?? '';
          const column = columnMap.get(colId);
          const board = column ? boardMap.get(column.boardId) : undefined;
          const projectTitle = board ? projectMap.get(board.projectId) ?? '' : '';
          mergedTasks.push({
            id: rt.id,
            title: rt.title ?? '',
            description: rt.description ?? '',
            columnId: colId,
            columnTitle: column?.title ?? '',
            boardId: board?.id ?? '',
            boardTitle: board?.title ?? '',
            projectId: board?.projectId ?? '',
            projectTitle,
            completed: rt.completed ?? false,
            assigned: (rt.assigned ?? []).map(id => this.getUserName(id)),
            subtasks: (rt.subtasks ?? []).map(sid => ({ id: sid, title: subtaskCache.get(sid) || sid })),
            timestamp: rt.timestamp ?? 0,
            cachedAt: now,
            updatedAt: rt.updatedAt ?? '',
            deadline: rt.deadline?.deadline,
          });
        }
      }

      for (const sid of allSubtaskIds) {
        if (processedIds.has(sid)) continue;
        processedIds.add(sid);
        const existing = existingMap.get(sid);
        if (existing) {
          mergedTasks.push(existing);
        } else {
          let st;
          try {
            st = await this.plugin.client.getTaskById(sid);
          } catch {
            continue;
          }
          const colId = st.columnId ?? '';
          const column = columnMap.get(colId);
          const board = column ? boardMap.get(column.boardId) : undefined;
          const projectTitle = board ? projectMap.get(board.projectId) ?? '' : '';
          mergedTasks.push({
            id: st.id,
            title: st.title ?? '',
            description: st.description ?? '',
            columnId: colId,
            columnTitle: column?.title ?? '',
            boardId: board?.id ?? '',
            boardTitle: board?.title ?? '',
            projectId: board?.projectId ?? '',
            projectTitle,
            completed: st.completed ?? false,
            assigned: (st.assigned ?? []).map(id => this.getUserName(id)),
            subtasks: (st.subtasks ?? []).map(sst => ({ id: sst, title: subtaskCache.get(sst) || sst })),
            timestamp: st.timestamp ?? 0,
            cachedAt: now,
            updatedAt: st.updatedAt ?? '',
            deadline: st.deadline?.deadline,
          });
        }
      }

      this.data.tasks = mergedTasks;
      this.data.lastSyncAt = now;

      await this.save();
      await this.logSync(remoteTasks.length, allBoards.length, allColumns.length);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('YouGile: sync failed —', msg);
      await this.logSyncError(msg);
    }
  }

  private getLpiProjectId(): string | undefined {
    const projects = this.getProjects();
    const projectTitle = this.plugin.settings.lpiProjectId;
    if (projectTitle) {
      const match = projects.find(p => p.title === projectTitle || p.id === projectTitle);
      if (match) return match.id;
    }
    return undefined;
  }

  private async logSync(taskCount: number, boardCount: number, columnCount: number): Promise<void> {
    if (!this.plugin?.syncLogger) return;
    await this.plugin.syncLogger.log({
      module: 'tasks',
      direction: 'from-yougile',
      action: 'sync-complete',
      itemId: '',
      status: 'success',
      details: `Задачи: ${taskCount}, доски: ${boardCount}, колонки: ${columnCount}`,
    });
  }

  private async logSyncError(error: string): Promise<void> {
    if (!this.plugin?.syncLogger) return;
    await this.plugin.syncLogger.log({
      module: 'tasks',
      direction: 'from-yougile',
      action: 'sync-complete',
      itemId: '',
      status: 'error',
      error,
    });
  }
}

export interface CachedSubtask {
  id: string;
  title: string;
}

export interface CachedTask {
  id: string;
  title: string;
  description: string;
  columnId: string;
  columnTitle: string;
  boardId: string;
  boardTitle: string;
  projectId: string;
  projectTitle: string;
  completed: boolean;
  assigned: string[];
  subtasks: CachedSubtask[];
  timestamp: number;
  cachedAt: number;
  updatedAt: string;
  deadline?: number;
}

export interface OfflineAction {
  id: string;
  type: 'create-task' | 'update-task' | 'upload-file' | 'add-info' | 'toggle-completed' | 'send-message';
  payload: Record<string, unknown>;
  createdAt: number;
  synced: boolean;
}

export interface CachedProject {
  id: string;
  title: string;
}

export interface CachedBoard {
  id: string;
  title: string;
  projectId: string;
}

export interface CachedColumn {
  id: string;
  title: string;
  boardId: string;
}

export interface CacheData {
  tasks: CachedTask[];
  projects: CachedProject[];
  boards: CachedBoard[];
  columns: CachedColumn[];
  lastSyncAt: number;
  offlineQueue: OfflineAction[];
}

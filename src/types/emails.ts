export interface MailDirection {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface MailItem {
  id: number;
  number: string;
  subject: string;
  text: string;
  author: string;
  date: string;
  direction_id: number;
  images: string[];
  mdFilePath: string;
  mdFileHash: string;
  lastSyncTime: string;
  sync_status: 'local' | 'synced' | 'conflict';
  created_at: string;
  /** ID задачи YouGile, если письмо синхронизировано */
  taskId?: string;
}

export interface EmailDbData {
  emails: MailItem[];
  directions: MailDirection[];
}

export interface ContactItem {
  id: number;
  name: string;
  phone: string;
  email: string;
  organization: string;
  position: string;
  orgType: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  taskId?: string;
  sync_status: 'local' | 'synced';
}

export interface ContactDbData {
  contacts: ContactItem[];
}

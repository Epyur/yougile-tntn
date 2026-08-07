import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  YouGileTask,
  YouGileTaskFull,
  YouGileTaskListResponse,
  CreateTaskPayload,
  YouGileProject,
  YouGileBoard,
  YouGileColumn,
  YouGileColumnListResponse,
  YouGileUser,
  YouGileGroupChat,
  YouGileChatMessage,
} from '../types/yougile';

const BASE_URL = 'https://ru.yougile.com/api-v2';

export class YouGileClient {
  private apiKey = '';

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async auth(login: string, password: string, companyId: string): Promise<string> {
    const url = `${BASE_URL}/auth/keys`;
    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password, companyId }),
    };
    const response = await requestUrl(params);
    if (response.status >= 400) {
      const text = typeof response.text === 'string' ? response.text.slice(0, 500) : `HTTP ${response.status}`;
      throw new Error(`YouGile auth error: ${text}`);
    }
    const json = response.json as Record<string, unknown>;
    const key = typeof json.key === 'string' ? json.key : '';
    if (!key) {
      throw new Error('YouGile auth: ключ не получен в ответе');
    }
    this.apiKey = key;
    return key;
  }

  private async request<T>(method: string, endpoint: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('YouGile: API ключ не получен. Выполните аутентификацию в настройках.');
    }
    const url = `${BASE_URL}${endpoint}`;
    const params: RequestUrlParam = {
      url,
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) {
      params.body = JSON.stringify(body);
    }
    console.log(`YouGile request: ${method} ${url}`, body ? params.body : '');
    let response;
    try {
      response = await requestUrl(params);
    } catch (e: unknown) {
      const statusMatch = e instanceof Error && e.message.match(/status (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const body = e instanceof Error ? e.message.slice(0, 500) : String(e);
      throw new Error(`YouGile API error (HTTP ${status || 'unknown'}): ${body}`);
    }
    if (response.status >= 400) {
      const errorMsg = typeof response.text === 'string' ? response.text.slice(0, 500) : `HTTP ${response.status}`;
      throw new Error(`YouGile API error (HTTP ${response.status}): ${errorMsg}`);
    }
    return response.json as T;
  }

  async getTasks(filter?: Record<string, unknown>): Promise<YouGileTask[]> {
    const allTasks: YouGileTask[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const paramsObj: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (filter) {
        for (const [k, v] of Object.entries(filter)) {
          paramsObj[k] = String(v);
        }
      }
      const qs = new URLSearchParams(paramsObj).toString();
      const result = await this.request<YouGileTaskListResponse>('GET', `/tasks?${qs}`);
      const items = result.content ?? [];
      allTasks.push(...items);
      if (!result.paging?.next || items.length < limit) break;
      offset += limit;
    }
    return allTasks;
  }

  async getTasksByProject(projectId: string): Promise<YouGileTask[]> {
    const boards = await this.getBoards();
    const projectBoardIds = new Set(boards.filter((b: any) => b.projectId === projectId).map((b: any) => b.id));
    const allCols = await this.getColumns();
    const projectColumnIds = new Set(allCols.filter((c: any) => projectBoardIds.has(c.boardId)).map((c: any) => c.id));
    const all = await this.getTasks();
    return all.filter(t => {
      const col = (t as any).columnId;
      if (!col) return false;
      return projectColumnIds.has(col);
    });
  }

  async getTasksExcludingProject(projectId: string): Promise<YouGileTask[]> {
    const boards = await this.getBoards();
    const projectBoardIds = new Set(boards.filter((b: any) => b.projectId === projectId).map((b: any) => b.id));
    const allCols = await this.getColumns();
    const projectColumnIds = new Set(allCols.filter((c: any) => projectBoardIds.has(c.boardId)).map((c: any) => c.id));
    const all = await this.getTasks();
    return all.filter(t => {
      const col = (t as any).columnId;
      if (!col) return true;
      return !projectColumnIds.has(col);
    });
  }

  async createTask(payload: CreateTaskPayload): Promise<{ id: string }> {
    return this.request<{ id: string }>('POST', '/tasks', payload as unknown as Record<string, unknown>);
  }

  async getTaskById(id: string): Promise<YouGileTaskFull> {
    return this.request<YouGileTask>('GET', `/tasks/${encodeURIComponent(id)}`);
  }

  async getProjects(): Promise<YouGileProject[]> {
    const result = await this.request<{ content: YouGileProject[] }>('GET', '/projects');
    return result.content ?? [];
  }

  async getBoards(): Promise<YouGileBoard[]> {
    const result = await this.request<{ content: YouGileBoard[] }>('GET', '/boards');
    return result.content ?? [];
  }

  async getColumns(boardId?: string): Promise<YouGileColumn[]> {
    const allColumns: YouGileColumn[] = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const paramsObj: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (boardId) paramsObj.board = boardId;
      const qs = new URLSearchParams(paramsObj).toString();
      const result = await this.request<YouGileColumnListResponse>('GET', `/columns?${qs}`);
      const items = result.content ?? [];
      allColumns.push(...items);
      if (!result.paging?.next || items.length < limit) break;
      offset += limit;
    }
    return allColumns;
  }

  async getColumnById(columnId: string): Promise<YouGileColumn> {
    return this.request<YouGileColumn>('GET', `/columns/${encodeURIComponent(columnId)}`);
  }

  async getUsers(): Promise<YouGileUser[]> {
    const result = await this.request<{ content: YouGileUser[] }>('GET', '/users');
    return result.content ?? [];
  }

  async updateTask(id: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.request<void>('PUT', `/tasks/${encodeURIComponent(id)}`, payload);
    } catch (e: unknown) {
      console.error('YouGile updateTask error:', e);
      throw e;
    }
  }

  async updateTaskRaw(id: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      return await this.request<Record<string, unknown>>('PUT', `/tasks/${encodeURIComponent(id)}`, payload);
    } catch (e: unknown) {
      console.error('YouGile updateTaskRaw error:', e);
      throw e;
    }
  }

  async getGroupChats(): Promise<YouGileGroupChat[]> {
    const result = await this.request<{ content: YouGileGroupChat[] }>('GET', '/group-chats');
    return result.content ?? [];
  }

  async createGroupChat(payload: Record<string, unknown>): Promise<{ id: string }> {
    return this.request<{ id: string }>('POST', '/group-chats', payload);
  }

  async getMessages(chatId: string): Promise<YouGileChatMessage[]> {
    const result = await this.request<{ content: YouGileChatMessage[] }>('GET', `/chats/${encodeURIComponent(chatId)}/messages`);
    return result.content ?? [];
  }

  async sendMessage(chatId: string, text: string): Promise<{ id: number }> {
    return this.request<{ id: number }>('POST', `/chats/${encodeURIComponent(chatId)}/messages`, {
      text,
      textHtml: `<p>${text}</p>`,
      label: '',
    });
  }

  async updateMessage(chatId: string, messageId: number, payload: Record<string, unknown>): Promise<void> {
    await this.request<void>('PUT', `/chats/${encodeURIComponent(chatId)}/messages/${messageId}`, payload);
  }

  async getTaskChatSubscribers(taskId: string): Promise<string[]> {
    return this.request<string[]>('GET', `/tasks/${encodeURIComponent(taskId)}/chat-subscribers`);
  }

  async uploadFile(arrayBuffer: ArrayBuffer, fileName: string): Promise<{ url: string; fullUrl: string }> {
    const url = `${BASE_URL}/upload-file`;
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const encoder = new TextEncoder();
    const headerBytes = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const footerBytes = encoder.encode(`\r\n--${boundary}--\r\n`);
    const combined = new Uint8Array(headerBytes.length + arrayBuffer.byteLength + footerBytes.length);
    combined.set(headerBytes, 0);
    combined.set(new Uint8Array(arrayBuffer), headerBytes.length);
    combined.set(footerBytes, headerBytes.length + arrayBuffer.byteLength);
    console.log(`YouGile upload: ${url}, file: ${fileName}, size: ${combined.length}`);
    try {
      const response = await requestUrl({
        url,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: combined.buffer as unknown as string,
      });
      if (response.status >= 400) {
        throw new Error(`YouGile upload error: ${response.status}`);
      }
      const json = response.json as { result: string; url: string; fullUrl: string };
      console.log('YouGile upload success:', json);
      return json;
    } catch (e: unknown) {
      console.error('YouGile upload error:', e);
      throw e;
    }
  }
}

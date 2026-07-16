import { requestUrl } from 'obsidian';
import type YouGilePlugin from '../main';

export interface LLMResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class LLMService {
  private plugin: YouGilePlugin;
  private lastRequestTime = 0;
  private minRequestInterval = 2000;

  constructor(plugin: YouGilePlugin) {
    this.plugin = plugin;
  }

  private getApiKey(): string | null {
    const secretName = this.plugin.settings.llmApiKeySecret;
    if (!secretName) return null;
    return this.plugin.getSecretValue(secretName);
  }

  private extractKeywords(query: string): string[] {
    const stopWords = ['это', 'как', 'так', 'вот', 'для', 'что', 'с', 'на', 'и', 'по', 'к', 'у', 'из', 'за', 'о', 'об', 'от', 'до', 'при', 'без', 'для', 'через', 'между', 'среди', 'вокруг', 'около', 'возле', 'перед', 'над', 'под', 'про', 'в', 'а', 'но', 'или', 'же', 'бы', 'да', 'нет', 'не', 'ни', 'то', 'со', 'же', 'какие', 'просто', 'перечисли', 'базе', 'подготовь', 'дай', 'представь'];
    const words = query.toLowerCase().replace(/[^\w\s\u0400-\u04FF]/g, ' ').split(/\s+/).filter(word => word.length > 2 && !stopWords.includes(word));
    return [...new Set(words)];
  }

  private buildContext(emails: Array<{ subject: string; text: string }>, directions: Array<{ name: string }>): string {
    let context = '';
    if (directions.length > 0) {
      context += `Направления: ${directions.map(d => d.name).join(', ')}\n\n`;
    }
    const maxEmails = Math.min(emails.length, 80);
    const uniqueSubjects = new Set<string>();
    let count = 0;
    for (const email of emails) {
      if (count >= maxEmails) break;
      const subject = email.subject || 'Без темы';
      if (uniqueSubjects.has(subject)) continue;
      uniqueSubjects.add(subject);
      const text = (email.text || '').replace(/\n{3,}/g, '\n\n').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
      context += `\n---\n📧 ${subject}\n📝 ${text.substring(0, 350)}${text.length > 350 ? '...' : ''}\n`;
      count++;
    }
    if (emails.length > count) {
      context += `\n... и еще ${emails.length - count} писем`;
    }
    return context;
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 3000): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
          await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
        return await fn();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const err = error as { message?: string; status?: number };
        if (err.message?.includes('429') || err.status === 429) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error('Превышено количество попыток');
  }

  async ask(question: string, fileContext = '', historyContext = ''): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('API ключ не настроен');

    const { llmModel, llmApiUrl, llmSystemPrompt } = this.plugin.settings;
    const allEmails = this.plugin.emailDb.getAllEmails();
    const directions = this.plugin.emailDb.getDirections();

    const keywords = this.extractKeywords(question);
    const emails: Array<{ subject: string; text: string }> = [];
    for (const email of allEmails) {
      const text = (email.subject || '') + ' ' + (email.text || '');
      const lowerText = text.toLowerCase();
      let matchCount = 0;
      for (const kw of keywords) {
        const matches = (lowerText.match(new RegExp(kw, 'gi')) || []).length;
        if (matches > 0) matchCount++;
      }
      if (matchCount > 0 || keywords.length === 0) {
        emails.push({ subject: email.subject, text: email.text });
      }
    }

    const dbContext = this.buildContext(emails.length > 0 ? emails : allEmails, directions);
    const userPrompt = `## КОНТЕКСТ (письма)\n\n${dbContext}${fileContext}${historyContext}\n\n## ВОПРОС:\n${question}\n\n## ОТВЕТЬ:`;

    return this.retryWithBackoff(async () => {
      const response = await requestUrl({
        url: llmApiUrl || 'https://ask.chadgpt.ru/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llmModel || 'deepseek-v4-pro',
          messages: [
            { role: 'system', content: llmSystemPrompt || 'Ты — эксперт. Отвечай на русском языке.' },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_completion_tokens: 4000,
        }),
      });

      if (response.status === 429) throw new Error('429: Too Many Requests');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.text}`);

      const data: LLMResponse = JSON.parse(response.text);
      return data.choices?.[0]?.message?.content || 'Нет ответа от LLM';
    });
  }
}

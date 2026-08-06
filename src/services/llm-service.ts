import { requestUrl } from 'obsidian';
import type YouGilePlugin from '../main';
import type {
  PresentationGeneration,
  PresentationQuestionaire,
  PresentationTemplate,
  PresentationSlide,
} from '../types/presentations';
import { normalizeIllustrationPath } from './presentation-generator';

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
          await new Promise(resolve => window.setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
        return await fn();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const err = error as { message?: string; status?: number };
        const retryable = err.status === 429 || err.status === 504
          || (typeof err.message === 'string'
            && (/(^|\s)(429|504)(\s|:|$)/.test(err.message) || err.message.startsWith('Timeout:')));
        if (retryable) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[YouGile LLM] попытка ${attempt + 1} вернула ${err.message}, повтор через ${delay}ms...`);
          await new Promise(resolve => window.setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error('Превышено количество попыток');
  }

  private async complete(system: string, user: string): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('API ключ не настроен');

    const { llmModel, llmApiUrl } = this.plugin.settings;
    return this.retryWithBackoff(async () => {
      const response = await this.requestWithTimeout({
        url: llmApiUrl || 'https://ask.chadgpt.ru/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llmModel || 'deepseek-v4-pro',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
        }),
      });

      if (response.status === 429) throw new Error('429: Too Many Requests');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.text}`);

      const data: LLMResponse = JSON.parse(response.text);
      return data.choices?.[0]?.message?.content || '';
    });
  }

  /** Выполняет HTTP-запрос с клиентским таймаутом.
   *  requestUrl в Obsidian не имеет таймаута — без этой обёртки при зависшем
   *  сервере (даже без 504) промис не завершается никогда. */
  private async requestWithTimeout(
    param: Parameters<typeof requestUrl>[0],
    timeoutMs = 180000,
  ): Promise<{ status: number; text: string }> {
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        requestUrl({ ...param, throw: false }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`Timeout: LLM не ответил за ${Math.round(timeoutMs / 1000)} сек`)),
            timeoutMs,
          );
        }),
      ]);
      return { status: response.status, text: response.text };
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }

  private extractJsonBlock(text: string): unknown {
    let cleaned = text.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) throw new Error('JSON не найден в ответе LLM');
    return JSON.parse(cleaned.substring(start, end + 1));
  }

  /** Генерация структуры презентации из анкеты по дизайн-скилу. */
  async generateSlides(
    q: PresentationQuestionaire,
    designRules: string,
    templateName: string,
  ): Promise<PresentationGeneration> {
    const system = `${designRules}

## Выходной формат
Ответь ТОЛЬКО JSON-объектом без markdown-обёртки и комментариев:
{
  "title": "Название презентации",
  "slides": [
    {
      "layout": "title|section|bullets|cards|table|photo|final",
      "heading1": "строка заголовка (акцентная)",
      "heading2": "строка заголовка (тёмная, опционально)",
      "subtitle": "повод/подзаголовок (для title и section)",
      "bullets": ["пункт 1", "пункт 2"],
      "cards": [{"title":"Заголовок карточки","body":"Текст карточки"}],
      "table": {"headers":["Колонка 1","Колонка 2"],"rows":[["значение","значение"]]},
      "speaker": "докладчик (для title и final)",
      "footer": "дата · название · №",
      "imageHint": "описание иллюстрации для слайда (если нужна)",
      "imagePath": "точный путь одной из доступных иллюстраций (если она подходит для слайда)"
    }
  ]
}

## Правила
- Первый слайд — layout "title", последний — "final".
- Финальный слайд (final) — центральный текст ВСЕГДА ровно «Спасибо за внимание»,
  без вариаций, сокращений и произвольных замен. Поле heading1 для final не заполняй
  (или ставь «Спасибо за внимание»), speaker — докладчик.
- Промежуточные слайды выбирай из: section (разделитель крупного раздела), bullets (пункты),
  cards (карточки), table (таблица), photo (фото как фон с короткими пунктами).
- Одна идея на слайд, максимум 5-6 пунктов по одной строке.
- Количество слайдов определи сам по контексту анкеты (6-16), если пользователь не указал иначе.
- footer для всех контентных слайдов: "дата · название · №" (№ заменится автоматически).
- speaker — на title и final.
- Не выдумывай факты сверх анкеты, формулируй осторожно.
- Для слайдов, где уместна иллюстрация из списка ниже, укажи её точный путь в "imagePath".
  Используй только пути из списка, не выдумывай. На один слайд — максимум одна иллюстрация.
  Титул (title) и финал (final) иллюстрации не требуют.`;

    const illList = (q.illustrations || []).map(ill => `- ${ill.path}: ${ill.description || 'без описания'}`).join('\n');

    const user = `## АНКЕТА
Тема: ${q.topic}
Аудитория: ${q.audience}
Цель: ${q.purpose}
Структура: ${q.structure}
Ключевые сообщения: ${q.keyMessages || '—'}
Тон: ${q.tone || '—'}
Докладчик: ${q.presenter || '—'}
Телефон докладчика: ${q.presenterPhone || '—'}
Email докладчика: ${q.presenterEmail || '—'}
Дата: ${q.date || '—'}
Повод (кикер): ${q.kicker || '—'}
Ориентировочное число слайдов: ${q.slideCountHint || 'по контексту'}
Шаблон оформления: ${templateName}
${illList ? `\n## ДОСТУПНЫЕ ИЛЛЮСТРАЦИИ (путь — описание)\n${illList}\n\nИспользуй их пути в поле imagePath слайдов, где они уместны.` : ''}

Сгенерируй JSON презентации. Поле subtitle титульного слайда заполни поводом (кикером), если он указан; иначе пусто.`;

    const text = await this.complete(system, user);
    let parsed: unknown;
    try {
      parsed = this.extractJsonBlock(text);
    } catch (firstErr) {
      const retry = await this.complete(system, 'Предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON по той же схеме.');
      parsed = this.extractJsonBlock(retry);
    }
    const obj = parsed as Partial<PresentationGeneration>;
    if (!obj || !Array.isArray(obj.slides)) throw new Error('LLM вернул некорректную структуру презентации');
    const illPaths = (q.illustrations || []).map(ill => ill.path);
    const contentLayouts = ['bullets', 'cards', 'table'];
    const slides = (obj.slides as PresentationSlide[]).map(s => {
      if (s.imagePath && illPaths.length > 0) {
        const norm = normalizeIllustrationPath(s.imagePath);
        const targetBase = norm.split('/').pop() || norm;
        const targetStem = targetBase.replace(/\.[a-z0-9]+$/, '');
        const matched = illPaths.find(p => normalizeIllustrationPath(p) === norm)
          || illPaths.find(p => {
            const base = normalizeIllustrationPath(p).split('/').pop() || '';
            return base === targetBase || base.replace(/\.[a-z0-9]+$/, '') === targetStem;
          });
        if (matched) s.imagePath = matched;
      }
      return s;
    });
    // Иллюстрации отображаются только на контентных слайдах (bullets/cards/table) — картинкой справа.
    // На остальных layout (title/section/photo/final) imagePath не рендерится, поэтому:
    // 1) снимаем imagePath с таких слайдов;
    // 2) распределяем все свободные иллюстрации по контентным слайдам без картинки,
    //    чтобы каждая загруженная иллюстрация гарантированно попала в презентацию.
    const used = new Set<string>(
      slides.filter(s => contentLayouts.includes(s.layout) && s.imagePath).map(s => s.imagePath as string));
    for (const s of slides) {
      if (s.imagePath && !contentLayouts.includes(s.layout)) s.imagePath = undefined;
    }
    const freeIlls = illPaths.filter(p => !used.has(p));
    if (freeIlls.length > 0) {
      let i = 0;
      for (const s of slides) {
        if (i >= freeIlls.length) break;
        if (contentLayouts.includes(s.layout) && !s.imagePath) {
          s.imagePath = freeIlls[i++];
        }
      }
    }
    return {
      title: obj.title || q.topic,
      slides: slides as PresentationGeneration['slides'],
    };
  }

  /** Мозговой штурм: LLM задаёт по одному уточняющему вопросу, пока не соберёт
   *  детали. Возвращает { done:false, question } или { done:true, summary }. */
  async brainstormNext(
    q: PresentationQuestionaire,
    log: Array<{ role: 'user' | 'assistant'; text: string }>,
    designRules: string,
    round: number,
    maxRounds: number,
  ): Promise<{ done: boolean; question?: string; summary?: string }> {
    const system = `Ты — мастер мозгового штурма по подготовке презентаций.
Твоя цель — НЕ генерировать презентацию, а собрать от автора достаточно деталей, чтобы потом из них сделать убедительные слайды.

Задавай по одному целевому вопросу за раз на русском языке. Вопрос должен уточнять СОДЕРЖАНИЕ (факты, цифры, боли, аудиторию, цель, объём, ключевые сообщения, желаемую структуру), а не оформление.

Правила:
- Сначала спроси про цель и аудиторию, если их нет в анкете.
- Затем про ключевые тезисы, которые обязательно должны попасть на слайды.
- Потом про факты/цифры/сроки и открытые вопросы.
- Не задавай больше 1 вопроса за раз.
- Когда информации достаточно (или достигнут лимит раундов ${maxRounds}) — верни done:true и summary — сжатый бриф (3-6 строк) со всеми уточнёнными деталями.

## Дизайн-скил (структура, по которой будет строиться презентация)
${designRules}

## Формат ответа — только JSON без пояснений:
{"done": false, "question": "вопрос пользователю"}
или
{"done": true, "summary": "краткий бриф с деталями"}`;

    const transcript = log.map(m => `${m.role === 'assistant' ? 'Вопрос' : 'Ответ'}: ${m.text}`).join('\n');
    const user = `## АНКЕТА
Тема: ${q.topic || '—'}
Аудитория: ${q.audience || '—'}
Цель: ${q.purpose || '—'}
Ключевые сообщения: ${q.keyMessages || '—'}
Тон: ${q.tone || '—'}
Структура: ${q.structure || '—'}
Докладчик: ${q.presenter || '—'}
Дата: ${q.date || '—'}
Ориентировочное число слайдов: ${q.slideCountHint || '—'}
Повод (кикер): ${q.kicker || '—'}

## Ход беседы
${transcript || '—'}

Раунд ${round} из ${maxRounds}. Ответь JSON по схеме.`;

    const text = await this.complete(system, user);
    let parsed: unknown;
    try {
      parsed = this.extractJsonBlock(text);
    } catch {
      return { done: round >= maxRounds, question: 'Расскажите подробнее о содержании доклада?' };
    }
    const obj = parsed as { done?: boolean; question?: string; summary?: string };
    return { done: !!obj.done, question: obj.question, summary: obj.summary };
  }

  /** Извлечение шаблона (TemplateSpec) из примера презентации. */
  async extractTemplate(example: string, templateRules: string): Promise<PresentationTemplate> {
    const user = `## ПРИМЕР ПРЕЗЕНТАЦИИ\n\n${example.substring(0, 20000)}\n\nИзвлеки шаблон и верни JSON TemplateSpec.`;
    const text = await this.complete(templateRules, user);
    let parsed: unknown;
    try {
      parsed = this.extractJsonBlock(text);
    } catch (firstErr) {
      const retry = await this.complete(templateRules, 'Предыдущий ответ не был валидным JSON. Верни ТОЛЬКО JSON TemplateSpec без пояснений.');
      parsed = this.extractJsonBlock(retry);
    }
    const obj = parsed as Partial<PresentationTemplate>;
    if (!obj || !obj.id || !obj.name) throw new Error('LLM вернул некорректный TemplateSpec');
    return obj as PresentationTemplate;
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
        }),
      });

      if (response.status === 429) throw new Error('429: Too Many Requests');
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.text}`);

      const data: LLMResponse = JSON.parse(response.text);
      return data.choices?.[0]?.message?.content || 'Нет ответа от LLM';
    });
  }
}

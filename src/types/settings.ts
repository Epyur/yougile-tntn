/** Маппинг колонка YouGile → направление письма */
export interface EmailDirectionMapping {
  columnId: string;
  directionName: string;
}

export interface YouGileSettings {
  login: string;
  companyId: string;
  apiKeySecret: string;
  defaultBoardId: string;
  selectedProjectId: string;
  calendarProjectId: string;
  calendarBoardId: string;
  calendarSelectedColumnIds: string;
  docsProjectId: string;
  docsBoardId: string;
  docsSelectedColumnIds: string;
  emailProjectId: string;
  emailBoardId: string;
  emailSelectedColumnIds: string;
  emailDbPath: string;
  emailDefaultAuthor: string;
  llmApiKeySecret: string;
  llmApiUrl: string;
  llmModel: string;
  llmSystemPrompt: string;
  docxTemplatePath: string;
  docxExportFolder: string;
  moduleCalendarEnabled: boolean;
  moduleDocumentsEnabled: boolean;
  moduleEmailsEnabled: boolean;
  moduleDashboardEnabled: boolean;
}

export const DEFAULT_SETTINGS: YouGileSettings = {
  login: '',
  companyId: '',
  apiKeySecret: '',
  defaultBoardId: '',
  selectedProjectId: '',
  calendarProjectId: '',
  calendarBoardId: '',
  calendarSelectedColumnIds: '',
  docsProjectId: '',
  docsBoardId: '',
  docsSelectedColumnIds: '',
  emailProjectId: '',
  emailBoardId: '',
  emailSelectedColumnIds: '',
  emailDbPath: 'mailer_data.json',
  emailDefaultAuthor: 'Кравченко А.А.',
  llmApiKeySecret: '',
  llmApiUrl: 'https://ask.chadgpt.ru/api/v1/chat/completions',
  llmModel: 'deepseek-v4-pro',
  llmSystemPrompt: 'Ты — эксперт по пожарной безопасности строительных материалов и систем TECHNONICOL.\n\nОтвечай на русском языке естественно и человечно, как опытный специалист, а не как структурированный отчет.\nИзбегай маркдауна, звездочек, заголовков и четких структурных разделов.\nИспользуй плавные переходы между мыслями, абзацы для удобства чтения.\nЕсли информации недостаточно — честно скажи об этом, но предложи, где можно уточнить.\nНе выдумывай факты, которых нет в базе.\nОтвечай дружелюбно и профессионально.',
  docxTemplatePath: '',
  docxExportFolder: 'Экспорт писем',
  moduleCalendarEnabled: true,
  moduleDocumentsEnabled: true,
  moduleEmailsEnabled: true,
  moduleDashboardEnabled: true,
};

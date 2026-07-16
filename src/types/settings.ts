export interface YouGileSettings {
  login: string;
  companyId: string;
  apiKeySecret: string;
  defaultBoardId: string;
  selectedProjectId: string;
  calendarProjectId: string;
  calendarBoardId: string;
}

export const DEFAULT_SETTINGS: YouGileSettings = {
  login: '',
  companyId: '',
  apiKeySecret: '',
  defaultBoardId: '',
  selectedProjectId: '',
  calendarProjectId: '',
  calendarBoardId: '',
};

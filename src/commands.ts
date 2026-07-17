import { Notice } from 'obsidian';
import type YouGilePlugin from './main';
import { TASKS_VIEW_TYPE, TasksView } from './ui/tasks-view';
import { SCHEDULE_VIEW_TYPE } from './ui/schedule-view';
import { DOCUMENTS_VIEW_TYPE } from './ui/documents-view';
import { EMAILS_VIEW_TYPE } from './ui/emails-view';
import { DASHBOARD_VIEW_TYPE } from './ui/dashboard-view';
import { SUGGESTIONS_VIEW_TYPE, SuggestionsView } from './ui/suggestions-view';
import { CONTACTS_VIEW_TYPE } from './ui/contacts-view';

export function registerCommands(plugin: YouGilePlugin): void {
  plugin.addCommand({
    id: 'create-task',
    name: 'Создать задачу',
    callback: () => {
      if (!plugin.settings.apiKeySecret || !plugin.getSecretValue(plugin.settings.apiKeySecret)) {
        new Notice('YouGile: Сначала настройте API ключ в настройках плагина');
        return;
      }
      plugin.activateView();
      window.setTimeout(() => {
        const leaf = plugin.app.workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
        const view = leaf?.view;
        if (view instanceof TasksView) {
          view.showCreateForm();
        }
      }, 300);
    },
  });

  plugin.addCommand({
    id: 'refresh-tasks',
    name: 'Обновить список задач',
    checkCallback: (checking: boolean) => {
      const leaf = plugin.app.workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
      if (checking) {
        return !!leaf;
      }
      const view = leaf?.view;
      if (view instanceof TasksView) {
        view.syncAndRender();
        new Notice('YouGile: Список задач обновлён');
      }
    },
  });

  plugin.addCommand({
    id: 'open-schedule',
    name: 'Открыть расписание мероприятий',
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.moduleCalendarEnabled) return false;
      if (checking) return true;
      plugin.activateScheduleView();
    },
  });

  plugin.addCommand({
    id: 'open-documents',
    name: 'Открыть документы',
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.moduleDocumentsEnabled) return false;
      if (!plugin.settings.apiKeySecret || !plugin.getSecretValue(plugin.settings.apiKeySecret)) {
        new Notice('YouGile: Сначала настройте API ключ в настройках плагина');
        return false;
      }
      if (checking) return true;
      plugin.activateDocumentsView();
    },
  });

  plugin.addCommand({
    id: 'open-emails',
    name: 'Открыть письма',
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.moduleEmailsEnabled) return false;
      if (checking) return true;
      plugin.activateEmailsView();
    },
  });

  plugin.addCommand({
    id: 'open-dashboard',
    name: 'Открыть дашборд',
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.moduleDashboardEnabled) return false;
      if (checking) return true;
      plugin.activateDashboardView();
    },
  });

  plugin.addCommand({
    id: 'open-suggestions',
    name: 'Открыть предложения',
    checkCallback: (checking: boolean) => {
      if (checking) return true;
      plugin.activateSuggestionsView();
    },
  });

  plugin.addCommand({
    id: 'open-contacts',
    name: 'Открыть контакты',
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.moduleContactsEnabled) return false;
      if (checking) return true;
      plugin.activateContactsView();
    },
  });
}

import { Notice } from 'obsidian';
import type YouGilePlugin from './main';
import { TASKS_VIEW_TYPE, TasksView } from './ui/tasks-view';
import { SCHEDULE_VIEW_TYPE } from './ui/schedule-view';

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
      setTimeout(() => {
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
    callback: () => {
      plugin.activateScheduleView();
    },
  });
}

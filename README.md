# YouGile Integration — Obsidian Plugin

| Русский | English |
|---------|---------|
| **YouGile Integration** — плагин для Obsidian, который добавляет панель управления задачами YouGile прямо внутри редактора. Поддерживает полный цикл работы: просмотр, создание, редактирование задач, чаты, файлы, офлайн-режим. | **YouGile Integration** is an Obsidian plugin that adds a YouGile task management panel right inside the editor. Supports the full workflow: viewing, creating, editing tasks, chats, files, and offline mode. |
| **Возможности** | **Features** |
| - **Панель задач**: список задач с фильтрами по проектам, доскам, колонкам, исполнителям, статусу и текстовому поиску. | - **Task panel**: task list with filters by projects, boards, columns, assignees, status, and text search. |
| - **Inline-детали**: просмотр задачи без модального окна, завершение/возобновление, индикатор дедлайна (зелёный/оранжевый/красный). | - **Inline details**: view task without modal dialogs, complete/resume, deadline indicator (green/orange/red). |
| - **Древовидные подзадачи**: вложенные подзадачи с возможностью перехода по клику. | - **Tree subtasks**: nested subtasks with click-to-navigate support. |
| - **Чаты**: вкладка чатов в одной панели с задачами, просмотр истории и отправка сообщений, кнопка "Перейти в чат" / "Создать чат" в деталях задачи. | - **Chats**: chats tab in the same panel as tasks, message history and sending, "Open chat" / "Create chat" buttons in task details. |
| - **Загрузка файлов**: прикрепление файлов к задаче через API YouGile. | - **File upload**: attach files to tasks via YouGile API. |
| - **Добавление информации**: textarea для дополнения описания задачи. | - **Add information**: textarea to append to task description. |
| - **Создание задач**: inline-форма с выбором проекта → доски → колонки, вводом email исполнителей, дедлайном. | - **Task creation**: inline form with project → board → column selection, assignee email input, deadline picker. |
| - **Исполнители по email**: ввод email, автоматический маппинг на ID пользователя. | - **Assignees by email**: enter email, automatic mapping to user ID. |
| - **Офлайн-режим**: очередь действий при отсутствии сети, автоматическая синхронизация при подключении (создание задач, добавление информации, завершение, загрузка файлов). | - **Offline mode**: action queue when offline, automatic sync when connection is restored (create task, add info, complete, upload file). |
| - **Индикатор синхронизации**: иконка ✅/⚠ на странице задачи. | - **Sync indicator**: ✅/⚠ icon on the task page. |
| - **Кэширование**: локальный JSON-кэш (yougile_cache.json) для проектов, досок, колонок, пользователей, задач. | - **Caching**: local JSON cache (yougile_cache.json) for projects, boards, columns, users, tasks. |
| **Установка** | **Installation** |
| 1. Скопируйте папку плагина в `<хранилище Obsidian>/.obsidian/plugins/yougile-tntn/` | 1. Copy the plugin folder to `<vault>/.obsidian/plugins/yougile-tntn/` |
| 2. Включите плагин в настройках Obsidian: Настройки → Сторонние плагины → YouGile Integration | 2. Enable the plugin in Obsidian: Settings → Community plugins → YouGile Integration |
| 3. Откройте настройки плагина и введите логин, пароль (или API-ключ) и companyId | 3. Open plugin settings and enter login, password (or API key), and companyId |
| 4. Нажмите кнопку на ленте (риббоне) или выполните команду "YouGile: Показать задачи" | 4. Click the ribbon button or run the command "YouGile: Show tasks" |
| **Требования** | **Requirements** |
| - Obsidian v1.11.4+ | - Obsidian v1.11.4+ |
| - Учётная запись YouGile (https://yougile.com) | - YouGile account (https://yougile.com) |
| - Desktop-версия Obsidian (плагин использует Node.js для SecretStorage) | - Desktop Obsidian (uses Node.js for SecretStorage) |
| **API-эндпоинты** | **API Endpoints** |
| `POST /api-v2/auth/keys` — аутентификация | `POST /api-v2/auth/keys` — authentication |
| `GET /api-v2/tasks` — список задач | `GET /api-v2/tasks` — task list |
| `GET /api-v2/tasks/{id}` — детали задачи | `GET /api-v2/tasks/{id}` — task details |
| `POST /api-v2/tasks` — создать задачу | `POST /api-v2/tasks` — create task |
| `PUT /api-v2/tasks/{id}` — обновить задачу | `PUT /api-v2/tasks/{id}` — update task |
| `GET /api-v2/projects` — список проектов | `GET /api-v2/projects` — project list |
| `GET /api-v2/boards` — список досок | `GET /api-v2/boards` — board list |
| `GET /api-v2/columns/{id}` — детали колонки | `GET /api-v2/columns/{id}` — column details |
| `GET /api-v2/users` — список пользователей | `GET /api-v2/users` — user list |
| `GET /api-v2/group-chats` — список чатов | `GET /api-v2/group-chats` — chat list |
| `POST /api-v2/group-chats` — создать чат | `POST /api-v2/group-chats` — create chat |
| `GET /api-v2/chats/{id}/messages` — сообщения чата | `GET /api-v2/chats/{id}/messages` — chat messages |
| `POST /api-v2/chats/{id}/messages` — отправить сообщение | `POST /api-v2/chats/{id}/messages` — send message |
| `PUT /api-v2/chats/{id}/messages/{mid}` — обновить сообщение | `PUT /api-v2/chats/{id}/messages/{mid}` — update message |
| `GET /api-v2/tasks/{id}/chat-subscribers` — подписчики чата | `GET /api-v2/tasks/{id}/chat-subscribers` — chat subscribers |
| `POST /api-v2/upload-file` — загрузка файла | `POST /api-v2/upload-file` — file upload |
| **Структура проекта** | **Project Structure** |
| `src/api/client.ts` — HTTP-клиент YouGile | `src/api/client.ts` — YouGile HTTP client |
| `src/database/db.ts` — локальный кэш и офлайн-очередь | `src/database/db.ts` — local cache and offline queue |
| `src/types/` — TypeScript-типы | `src/types/` — TypeScript types |
| `src/ui/settings-tab.ts` — вкладка настроек | `src/ui/settings-tab.ts` — settings tab |
| `src/ui/tasks-view.ts` — основная панель | `src/ui/tasks-view.ts` — main view panel |
| `src/commands.ts` — команды плагина | `src/commands.ts` — plugin commands |
| `src/main.ts` — точка входа плагина | `src/main.ts` — plugin entry point |
| **Сборка** | **Build** |
| `npm install` — установка зависимостей | `npm install` — install dependencies |
| `npm run dev` — разработка с hot-reload | `npm run dev` — development with hot-reload |
| `npm run build` — production-сборка | `npm run build` — production build |
| **Лицензия** | **License** |
| MIT | MIT |

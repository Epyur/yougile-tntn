# AGENTS.md — YouGile Obsidian Plugin

## Статус модулей

| № | Модуль | Статус | Файлы |
|---|--------|--------|-------|
| 1 | **Ядро**: авторизация, кэш, API-клиент | ✅ | `main.ts`, `api/client.ts`, `database/db.ts` |
| 2 | **Задачи**: список, фильтры, дерево, чаты, inline-создание | ✅ | `ui/tasks-view.ts` |
| 3 | **Документы**: таблица, детали, создание, замечания, CSV-экспорт, связанные документы, файлы | ✅ | `ui/documents-view.ts` |
| 4 | **Письма**: таблица, детали, создание, редактирование, файлы, фильтры (дата, автор, колонки, поиск 3s), экспорт HTML (буфер), экспорт CSV | ✅ | `ui/emails-view.ts`, `database/email-db.ts`, `types/emails.ts` |
| 5 | **AI-чат**: RAG по письмам, загрузка файлов, "Создать письмо" из ответа | ✅ | `ui/emails-view.ts` (ChatAIEmailModal), `services/llm-service.ts` |
| 6 | **DOCX-экспорт**: шаблон с плейсхолдерами, fallback-генерация, изображения | ✅ | `services/document-service.ts` |
| 7 | **Дашборд**: метрики, 4 графика ApexCharts, фильтры (проект, колонка, исполнитель, даты), экспорт JPG | ✅ | `ui/dashboard-view.ts` |
| 8 | **Календарь мероприятий** + фильтр Документы | ✅ | `ui/schedule-view.ts` |
| 9 | **Настройки**: логин/пароль, проекты/доски для каждого модуля, LLM, DOCX, автор по умолчанию | ✅ | `ui/settings-tab.ts`, `types/settings.ts` |

## Структура файлов

```
src/
├── api/
│   └── client.ts
├── database/
│   ├── db.ts                  # LocalDatabase (yougile_cache.json)
│   └── email-db.ts            # EmailDatabase (mailer_data.json)
├── services/
│   ├── document-service.ts    # DOCX генерация (jszip + docx)
│   └── llm-service.ts         # AI-чат с RAG
├── types/
│   ├── cache.ts               # CachedTask, OfflineAction, …
│   ├── emails.ts              # MailItem, MailDirection, EmailDbData
│   ├── settings.ts            # YouGileSettings + DEFAULT_SETTINGS
│   └── yougile.ts             # YouGileTask, CreateTaskPayload, …
├── ui/
│   ├── dashboard-view.ts      # Дашборд (ApexCharts, метрики, фильтры, JPG-экспорт)
│   ├── documents-view.ts      # Документы (таблица, детали, замечания, CSV, HTML-экспорт)
│   ├── emails-view.ts         # Письма (таблица, create/edit, файлы, AI-чат, HTML-экспорт)
│   ├── schedule-view.ts       # Календарь мероприятий
│   ├── settings-tab.ts        # Все настройки
│   └── tasks-view.ts          # Задачи (список, дерево, чаты)
├── commands.ts
└── main.ts
```

## API-эндпоинты

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| POST | /api-v2/auth/keys | Аутентификация |
| GET | /api-v2/tasks | Список задач |
| GET | /api-v2/tasks/{id} | Детали задачи |
| POST | /api-v2/tasks | Создать задачу |
| PUT | /api-v2/tasks/{id} | Обновить задачу |
| GET | /api-v2/projects | Список проектов |
| GET | /api-v2/boards | Список досок |
| GET | /api-v2/columns/{id} | Детали колонки |
| GET | /api-v2/users | Список пользователей |
| GET | /api-v2/group-chats | Список чатов |
| POST | /api-v2/group-chats | Создать чат |
| GET | /api-v2/chats/{id}/messages | История сообщений |
| POST | /api-v2/chats/{id}/messages | Отправить сообщение |
| PUT | /api-v2/chats/{id}/messages/{mid} | Обновить сообщение |
| GET | /api-v2/tasks/{id}/chat-subscribers | Подписчики чата задачи |
| POST | /api-v2/upload-file | Загрузка файла |

## Ключевые решения

- **Письма хранятся локально** в `mailer_data.json` + дублируются в YouGile как задачи (`type: "email"` в description JSON)
- **Assigned** в задачах писем — UUID пользователя, найденный по `settings.login` через `db.getUsers()`
- **Файлы** загружаются на YouGile через `POST /upload-file`, URL хранится в `email.images[]`
- **Офлайн-очередь** для create/update email + upload file; при синке taskId сохраняется в локальную БД
- **DOCX**: поддержка шаблонов (замена `{{Номер}}`, `{{Текст}}` и т.д.) и fallback-генерация через `docx` lib
- **Дашборд**: ApexCharts (donut, bar, area), фильтры (проект, колонка, исполнитель, даты), экспорт JPG (scale 2x)
- **Экспорт HTML**: копирование полной таблицы в буфер обмена (письма — `№исх/дата|Приложение|Тема|Содержание`, документы — `№ п/п|Название|Тип|Срок|Куратор|Ссылки`)
- **Экспорт CSV**: BOM + `;` разделитель, файл в папку `Экспорт`

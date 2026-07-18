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
| 7 | **Дашборд**: метрики, 4 графика ApexCharts, фильтры (проект, доска, колонка, исполнитель, даты, подзадачи, дедлайны), экспорт JPG/CSV | ✅ | `ui/dashboard-view.ts` |
| 8 | **Календарь мероприятий**: месяц, день, фильтр Документы, создание/редактирование, отчёт, материнская задача + автозавершение, проверка дедлайна | ✅ | `ui/schedule-view.ts` |
| 9 | **Настройки**: складные блоки с toggle, проекты/доски через dropdown, LLM, DOCX, автор | ✅ | `ui/settings-tab.ts`, `types/settings.ts` |
| 10 | **Предложения**: таблица, создание, детали, редактирование, завершение, офлайн-очередь | ✅ | `ui/suggestions-view.ts` |
| 11 | **Контакты**: таблица, создание, редактирование, детали, поиск, фильтр по колонкам, QR-код (vCard, красный, 250×250), локальная JSON БД, синхронизация с YouGile | ✅ | `ui/contacts-view.ts`, `database/contact-db.ts`, `types/contacts.ts` |
| 12 | **LPI (Лаборатория пожарных испытаний)**: таблица, детали (read-only), локальная JSON БД yourbase/lpi_data.json, toggle в настройках (по умолч. false), проект/доска/колонка жёстко заданы | ✅ | `ui/lpi-view.ts`, `types/lpi.ts` |
| 13 | **AssigneeSelector**: переиспользуемый компонент выбора пользователей (чекбоксы + email) | ✅ | `ui/assignee-selector.ts` |

## Структура файлов

```
src/
├── api/
│   └── client.ts                  # YouGileClient — все API-запросы
├── database/
│   ├── db.ts                      # LocalDatabase (yougile_cache.json)
│   ├── email-db.ts                # EmailDatabase (mailer_data.json)
│   └── contact-db.ts              # ContactDatabase (contacts_data.json)
├── services/
│   ├── document-service.ts        # DOCX генерация (jszip + docx)
│   └── llm-service.ts             # AI-чат с RAG
├── types/
│   ├── cache.ts                   # CachedTask, OfflineAction, …
│   ├── contacts.ts                # ContactItem, ContactDbData
│   ├── emails.ts                  # MailItem, MailDirection, EmailDbData
│   ├── settings.ts                # YouGileSettings + DEFAULT_SETTINGS
│   └── yougile.ts                 # YouGileTask, CreateTaskPayload, …
├── ui/
│   ├── assignee-selector.ts       # Переиспользуемый компонент выбора пользователей
│   ├── contacts-view.ts           # Контакты (таблица, create/edit, детали, QR-код)
│   ├── dashboard-view.ts          # Дашборд (ApexCharts, метрики, фильтры, JPG/CSV)
│   ├── documents-view.ts          # Документы (таблица, детали, замечания, CSV, HTML)
│   ├── emails-view.ts             # Письма (таблица, create/edit, файлы, AI-чат, HTML)
│   ├── schedule-view.ts           # Календарь мероприятий
│   ├── settings-tab.ts            # Настройки: 6 складных блоков + toggle модулей
│   ├── suggestions-view.ts        # Предложения (таблица, create/edit, детали, завершение)
│   └── tasks-view.ts              # Задачи (список, дерево, чаты)
├── commands.ts
└── main.ts
```

## API-эндпоинты

| Метод | Endpoint | Назначение |
|-------|----------|------------|
| POST | /api-v2/auth/keys | Аутентификация |
| GET | /api-v2/tasks | Список задач (с пагинацией) |
| GET | /api-v2/tasks/{id} | Детали задачи |
| POST | /api-v2/tasks | Создать задачу |
| PUT | /api-v2/tasks/{id} | Обновить задачу |
| GET | /api-v2/projects | Список проектов |
| GET | /api-v2/boards | Список досок |
| GET | /api-v2/columns | Список колонок (с пагинацией, опциональный `board`) |
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

- **Все БД хранятся** в папке `yourbase/` относительно корня хранилища: `yourbase/yougile_cache.json`, `yourbase/mailer_data.json`, `yourbase/contacts_data.json`; пути жёстко прописаны в коде, не настраиваются
- **Письма хранятся локально** в `yourbase/mailer_data.json` + дублируются в YouGile как задачи (`type: "email"` в description JSON); название направления (`direction_name`) хранится прямо в письме, а не только как числовой `direction_id`
- **Контакты хранятся локально** в `yourbase/contacts_data.json` + дублируются как задачи (`type: "contact"`, `completed: true`)
- **Assigned** в задачах — UUID пользователя, найденный по `settings.login` через `db.getUsers()`
- **Файлы** загружаются на YouGile через `POST /upload-file`, URL хранится в `email.images[]`
- **Офлайн-очередь** для create/update email + upload file; при синке `taskId` сохраняется в локальную БД
- **DOCX**: поддержка шаблонов (замена `{{Номер}}`, `{{Текст}}` и т.д.) и fallback-генерация через `docx` lib
- **Дашборд**: ApexCharts (donut, bar, area), фильтры (проект, доска, колонка, исполнитель, даты), чекбоксы "Учитывать подзадачи" и "Показать дедлайны", экспорт JPG (scale 2x) и CSV
- **Динамика озадачивания**: график с двумя сериями ("Поступило задач" / "Задач решено"), отсечки дедлайнов, даты от первой задачи до сегодня
- **Экспорт HTML**: копирование полной таблицы в буфер обмена (письма, документы)
- **Экспорт CSV**: BOM + `;` разделитель, файл в папку `Экспорт`
- **Модули настраиваются**: каждый модуль (Календарь, Документы, Письма, Дашборд, Контакты) можно включить/отключить в настройках; отключённый модуль скрывает вьюху, ribbon-иконку и команды
- **Предложения** — всегда включены (без toggle), используют жёстко заданные проект="Развитие плагина", board="Предложения", columns=["Предложения", "Ошибки"]
- **Стабильность дашборда**: отмена предыдущего таймаута рендера, защита от `destroy()` на null, предотвращение race condition при быстрой смене фильтров
- **Inline-стили для чекбоксов**: все чекбоксы используют `element.style.*` вместо CSS-класса `mailer-cb` для надёжного отображения в разных темах Obsidian
- **Материнская задача в календаре**: при создании мероприятия можно выбрать родительскую задачу (поиск по всем проектам), опционально включить автозавершение родителя при завершении мероприятия; проверка дедлайна родителя с предупреждением
- **QR-код контакта**: генерируется через библиотеку `qrcode`, vCard, красный цвет (#FF0000), 250×250px
- **Приоритет предложений**: выбор из фиксированного набора (Критичный, Высокий, Средний, Просто идея), по умолчанию Средний
- **AssigneeSelector**: переиспользуемый компонент выбора пользователей (чекбоксы со списком + ручной ввод email)
- **Уведомление об обновлении**: при первом запуске после обновления показывается модалка со списком изменений; версия сохраняется в `settings.shownVersion`, повторно не показывается до следующего обновления
- **onLayoutReady для модалки обновления**: модалка открывается через `onLayoutReady()`, чтобы избежать TypeError "e.isShown is not a function" — Obsidian ожидает, что `isShown` будет методом Component'а, но в Modal это boolean-свойство; открытие после готовности layout исключает попадание модалки в component tree во время инициализации
- **Updater plugin** (``C:\Obsidian\mailers\.obsidian\plugins\updater\`) не является источником ошибки `isShown` — в нём нет вызовов `isShown()`; его код сводится к fetch → сравнение версий → download → disablePlugin/enablePlugin
- **safeRegisterView**: Обёртка для `registerView()` с `try-catch` — предотвращает ошибку "Attempting to register an existing view type" при перезапуске плагина через updater (view-типы не очищаются из реестра при disablePlugin)
- **Updater: разделение TARGET_DIR/TARGET_ID**: Для путей к файлам используется `TARGET_DIR` (имя папки плагина `yougile-tntn`), для disablePlugin/enablePlugin — `TARGET_ID` (ID плагина из манифеста `obsidian-yougile`), чтобы файлы скачивались в правильную директорию
- **Updater: очистка require.cache**: Перед enablePlugin удаляется закешированный модуль `main.js` через `delete require.cache[resolve(path)]`, чтобы загружался новый код с диска

## Настройки плагина

Настройки разделены на 6 складных блоков. У блоков «Календарь», «Документы», «Письма», «Дашборд» и «Контакты» есть toggle — чекбокс включения/отключения модуля.

| Блок | Поля | Toggle |
|------|------|--------|
| Базовые настройки | companyId, логин, пароль, API-ключ, доска по умолч. | нет (всегда включён) |
| Календарь | проект, доска (dropdown) | `moduleCalendarEnabled` |
| Документы | проект, доска (dropdown) | `moduleDocumentsEnabled` |
| Письма | проект, доска, автор, AI-ключ, URL, модель, системный промпт, DOCX-шаблон/папка | `moduleEmailsEnabled` |
| Контакты | проект, доска | `moduleContactsEnabled` |
| Дашборд | без настроек | `moduleDashboardEnabled` |
| LPI | без настроек | `moduleLpiEnabled` (по умолч. false) |

## Правила версионирования и коммитов

### Версионирование
- Каждый раз при изменении AGENTS.md необходимо повышать версию в `manifest.json` (major.minor.patch)
- Добавлять описание всех изменений (на русском языке) в массив `CHANGELOG` в `src/main.ts` под новой версией

### Коммиты
- Каждый раз при изменении AGENTS.md формировать **summary** и **description** для git-коммита на **английском языке**
- Summary: одно предложение, глагол в наст.вр., начинается с типа (fix/feat/refactor/chore)
- Description: список изменений в виде буллетов с указанием файлов

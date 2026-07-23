# AGENTS.md — YouGile Obsidian Plugin

## Статус модулей

| № | Модуль | Статус | Файлы |
|---|--------|--------|-------|
| 1 | **Ядро**: авторизация, кэш, API-клиент | ✅ | `main.ts`, `api/client.ts`, `database/db.ts` |
| 2 | **Задачи**: список, фильтры, дерево, чаты (вкладка group-chats + встроенный в детали задачи с файлами), inline-создание | ✅ | `ui/tasks-view.ts` |
| 3 | **Документы**: таблица, детали, создание, замечания, CSV-экспорт, связанные документы, файлы | ✅ | `ui/documents-view.ts` |
| 4 | **Письма**: таблица, детали, создание, редактирование, файлы, фильтры (дата, автор, колонки, поиск 3s), экспорт HTML (буфер), экспорт CSV | ✅ | `ui/emails-view.ts`, `database/email-db.ts`, `types/emails.ts` |
| 5 | **AI-чат**: RAG по письмам, загрузка файлов, "Создать письмо" из ответа | ✅ | `ui/emails-view.ts` (ChatAIEmailModal), `services/llm-service.ts` |
| 6 | **DOCX-экспорт**: шаблон с плейсхолдерами, fallback-генерация, изображения | ✅ | `services/document-service.ts` |
| 7 | **Дашборд**: метрики, 4 графика ApexCharts, фильтры (проект, доска, колонка, исполнитель, даты, подзадачи, дедлайны), экспорт JPG/CSV | ✅ | `ui/dashboard-view.ts` |
| 8 | **Календарь мероприятий**: месяц, день, фильтр Документы, создание/редактирование, отчёт, материнская задача + автозавершение, проверка дедлайна | ✅ | `ui/schedule-view.ts` |
| 9 | **Настройки**: складные блоки с toggle, проекты/доски через dropdown, LLM, DOCX, автор | ✅ | `ui/settings-tab.ts`, `types/settings.ts` |
| 10 | **Предложения**: таблица, создание, детали, редактирование, завершение, офлайн-очередь | ✅ | `ui/suggestions-view.ts` |
| 11 | **Контакты**: таблица, создание, редактирование, детали, поиск, фильтр по колонкам, QR-код (vCard, красный, 250×250), локальная JSON БД, синхронизация с YouGile | ✅ | `ui/contacts-view.ts`, `database/contact-db.ts`, `types/contacts.ts` |
| 12 | **LPI (Лаборатория пожарных испытаний)**: таблица (9 колонок: ● индикатор, №, материал, дата создания, статус, дата протокола, результат испытания, оценка, действия с кнопкой "Отправить в YouGile"), дашборд (5 графиков ApexCharts: статус, поступление/завершение по месяцам, оценка соответствия, топ продуктов), фильтр продуктов для дашборда, дата-фильтры (заявки + протоколы), чекбоксы "Серийная/Опытная продукция", фильтр "Подтверждаемый показатель" с человеческими названиями, per-product compliance donuts, кнопки "SQL → Локально" (загрузка данных из SQLite) и "Синхронизация YouGile" (без SQL — прямая загрузка, с SQL — модальное окно с поштучным подтверждением расхождений + автоимпорт новых заявок из YouGile), статус active/new/completed из поля БД LIMS, детали (config-driven: поля, секции, subquery-запросы из конфига), кнопка "Отправить в YouGile", локальная JSON БД yourbase/lpi_data.json, sql.js (WASM) для чтения внешней SQLite, Schema Browser (просмотр схемы БД), Query Runner в деталях (произвольные SQL-запросы с {{placeholders}}), Config Editor (редактор конфига отображения yourbase/lpi_view_config.json), настройка пути к SQLite БД, toggle в настройках (по умолч. false), проект/доска/колонка жёстко заданы, индикатор синхронизации с YouGile (зелёный/серый круг) | ✅ | `ui/lpi-view.ts`, `types/lpi.ts`, `types/lpi-config.ts`, `services/lpi-schema-service.ts`, `ui/lpi-schema-modal.ts` |
| 13 | **AssigneeSelector**: переиспользуемый компонент выбора пользователей (чекбоксы + email + setSelectedIds) | ✅ | `ui/assignee-selector.ts` |
| 14 | **Редактирование задачи**: в деталях задачи (задачи-вьюха) добавлена кнопка "Редактировать" — форма с title, description, project/board/column, assignees, deadline | ✅ | `ui/tasks-view.ts` |
| 15 | **ScheduleView → TasksView**: вызов `openTaskDetail()` через публичный API вместо прямого доступа к private-членам | ✅ | `ui/tasks-view.ts`, `ui/schedule-view.ts` |
| 16 | **SyncLogger**: журнал всех синхронизаций (LPI, Письма, Контакты, Задачи, офлайн-очередь), запись в `yourbase/sync_log.json`, модальное окно с фильтрацией, ribbon-иконка, команда | ✅ | `services/sync-logger.ts`, `main.ts`, `db.ts`, `email-db.ts`, `contact-db.ts`, `lpi-view.ts`, `tasks-view.ts` |

## Структура файлов

```
src/
├── api/
│   └── client.ts                  # YouGileClient — все API-запросы
├── database/
│   ├── db.ts                      # LocalDatabase (yougile_cache.json)
│   ├── email-db.ts                # EmailDatabase (mailer_data.json)
│   └── contact-db.ts              # ContactDatabase (contacts_data.json) (удалён lpi-db — всё в lpi_data.json)
├── services/
│   ├── document-service.ts        # DOCX генерация (jszip + docx)
│   ├── llm-service.ts             # AI-чат с RAG
│   ├── lpi-schema-service.ts      # Schema Service — чтение метаданных SQLite
│   └── sync-logger.ts             # Журнал синхронизации (SyncLogger + SyncLogModal)
├── types/
│   ├── cache.ts                   # CachedTask, OfflineAction, …
│   ├── contacts.ts                # ContactItem, ContactDbData
│   ├── emails.ts                  # MailItem, MailDirection, EmailDbData
│   ├── lpi-config.ts              # LpiViewConfig + DEFAULT_CONFIG
│   ├── settings.ts                # YouGileSettings + DEFAULT_SETTINGS
│   ├── sql.js.d.ts                # Type declarations for sql.js
│   └── yougile.ts                 # YouGileTask, CreateTaskPayload, …
├── ui/
│   ├── assignee-selector.ts       # Переиспользуемый компонент выбора пользователей
│   ├── contacts-view.ts           # Контакты (таблица, create/edit, детали, QR-код)
│   ├── dashboard-view.ts          # Дашборд (ApexCharts, метрики, фильтры, JPG/CSV)
│   ├── documents-view.ts          # Документы (таблица, детали, замечания, CSV, HTML)
│   ├── emails-view.ts             # Письма (таблица, create/edit, файлы, AI-чат, HTML)
│   ├── lpi-schema-modal.ts        # Schema Browser — просмотр схемы SQLite БД
│   ├── schedule-view.ts           # Календарь мероприятий
│   ├── settings-tab.ts            # Настройки: 7 складных блоков + toggle модулей
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
- **LPI дашборд**: 6 графиков ApexCharts (status donut, incoming/completed monthly bar, compliance donut, test result donut, top products horizontal bar); фильтр продуктов через модалку (search + select/deselect all); дата-фильтры (дата создания заявки, дата протокола); чекбоксы "Серийная продукция" (ЕКН цифровой) / "Опытная продукция" (ЕКН отсутствует) — независимые; перцептуальные compliance donuts при выборе нескольких продуктов; deferred render через setTimeout (100ms) для стабильности; графики на четырёх рядах (2+2+1+1)
- **LPI таблица**: 7 колонок; active-статус жёлтый, completed — зелёный; у active protocol_date показывается как "—" (без fallback-даты)
- **LPI завершение заявок**: всё хранится в едином `lpi_data.json` (поля `completedLocally`, `completedAt`, `taskId`), без отдельного файла; синхронизация через YouGile-задачи с `type:"lpi_data"` (или `"lpi_completed"` для старых задач) при загрузке; `taskId` проставляется только при явной отправке через syncItemToYougile
- **LPI статус**: терминальные статусы — `completed` и `received` (оба → "Завершена"); `isEffectivelyActive()` проверяет `completedLocally` в первую очередь, статус из SQLite не может откатить `completedLocally: true` обратно
- **LPI детали заявки**: 3 блока (Детали заявки, Результаты измерений, Выводы), все поля read-only (пустые — "—"), "Результат испытания" и "Общая оценка соответствия" — жирным, цветная Оценка (зелёный/красный/серый)"
- **LPI завершение**: только через LIMS (статус `received`) или YouGile-задачи (тип `lpi_data` или `lpi_completed`, `completed: true`); кнопка "Завершить заявку" из деталей удалена
- **LPI синхронизация (изменена в v0.5.3s)**:
  - **YouGile → плагин**: `syncFromTasks()` матчит задачи по `aggregate_id` И по `application_external_id` (второй — fallback для разных станций); `taskId` локальным записям НЕ проставляется; `completedLocally` обновляется только если у записи уже есть `taskId`, совпадающий с YouGile-задачей
  - **Плагин → YouGile**: `syncItemToYougile()` при создании задачи использует статус из SQLite (`application_status`), а не `completedLocally` — "новая" не создаётся завершённой; при обновлении существующей завершает задачу только если был переход active→terminal
  - **Отсечка авто-синхронизации при загрузке из SQL**: `parseInt(application_external_id) < 642` — заявки с номером меньше 642 не создаются в YouGile автоматически
  - **Ручная отправка** (кнопки "📤" в таблице и в деталях): без ограничений, отправляет любую заявку
  - **Кэш YouGile-задач**: `yougileTasksByExtId` (Map `application_external_id → task`) строится при `syncFromTasks()`, используется только для статуса `completedLocally`, не для `taskId`
- **ScheduleView → TasksView**: `openTaskDetail()` — публичный API-метод, заменяющий прямой доступ к `private detailViewActive`, `detailTaskId` и `renderTaskDetail()` из `ScheduleView`

## Настройки плагина

Настройки разделены на 7 складных блоков. У блоков «Календарь», «Документы», «Письма», «Дашборд», «Контакты» и «LPI» есть toggle — чекбокс включения/отключения модуля. Блок LPI по умолчанию свёрнут.

| Блок | Поля | Toggle |
|------|------|--------|
| Базовые настройки | companyId, логин, пароль, API-ключ, доска по умолч. | нет (всегда включён) |
| Календарь | проект, доска (dropdown) | `moduleCalendarEnabled` |
| Документы | проект, доска (dropdown) | `moduleDocumentsEnabled` |
| Письма | проект, доска, автор, AI-ключ, URL, модель, системный промпт, DOCX-шаблон/папка | `moduleEmailsEnabled` |
| Контакты | проект, доска | `moduleContactsEnabled` |
| Дашборд | без настроек | `moduleDashboardEnabled` |
| LPI | путь к SQLite БД (кнопка "Обзор..."), проект, доска, колонка (dropdown) | `moduleLpiEnabled` (по умолч. false) |

## Правила версионирования и коммитов

### Версионирование
- Каждый раз при изменении AGENTS.md необходимо повышать версию в `manifest.json` (major.minor.patch) **если пользователь не сказал иначе**
- Добавлять описание всех изменений (на русском языке) в массив `CHANGELOG` в `src/main.ts` под новой версией
- Если пользователь называет номер сборки, который уже был использован ранее (уже есть в CHANGELOG или в git-тегах), необходимо указать на это и предложить следующий свободный номер

### Коммиты
- Каждый раз при изменении AGENTS.md формировать **summary** и **description** для git-коммита на **английском языке**
- Summary: одно предложение, глагол в наст.вр., начинается с типа (fix/feat/refactor/chore)
- Description: список изменений в виде буллетов с указанием файлов

> **Важно**: без явной команды пользователя не выполнять `git commit` и `git push`.

# AGENTS.md — YouGile Obsidian Plugin

## Сборка и проверка

- `npm run dev` — esbuild watch-режим; `npm run build` — production-сборка. Обе пишут `main.js` в корень репозитория, который является **живой папкой установленного плагина** в хранилище `C:\Obsidian\mailers`.
- **В `package.json` нет тестов, линтера и typecheck-скрипта.** Единственная проверка типов — `npx tsc --noEmit`. Никогда не запускайте `tsc` без `--noEmit`: в `tsconfig.json` задан `outDir: "./"`, и скомпилированный JS будет выброшен в корень репозитория.
- **`npm run build` не проверяет типы** (esbuild срезает их). На данный момент `npx tsc --noEmit` даёт ~48 известных ошибок (в осн. `presentation-generator.ts`, `emails-view.ts`, `dashboard-view.ts`, сигнатуры `onClose` ItemView, нет типов у `qrcode`). Не исправляйте весь задел — просто не добавляйте новых ошибок.
- Сборка автоматически копирует `node_modules/sql.js/dist/sql-wasm.wasm` в корень — файл обязателен для модуля LPI в рантайме.
- `main.js` **закоммичен** в git (вопреки `.rules/obsidian-plugin-rules.md`): после изменений пересоберите его и включите в коммит.
- **`.rules/obsidian-plugin-rules.md` устарел и местами противоречит коду** — ориентируйтесь на этот файл и на код:
  - он запрещает инлайн-стили `element.style.*`, но чекбоксы намеренно используют их (см. «Ключевые решения»)
  - он утверждает, что собранные `main.js`/`manifest.json`/`styles.css` не хранятся в репозитории — на деле `main.js` закоммичен
  - рекомендует нейминг `views/*.view.ts`, в коде — `ui/*-view.ts`
- `yougile-api.json` / `yougile-api-pretty.json` — дампы ответов YouGile API, удобно сверять схемы при правке `api/client.ts`. `instruction.md` — пользовательская инструкция (на неё ссылается README).

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
| 12 | **LPI (Лаборатория пожарных испытаний)**: таблица (9 колонок: ● индикатор, №, материал, дата создания, статус, дата протокола, результат испытания, оценка, действия: 📥 из SQL, 📤 в YouGile), фильтры (дата создания, статус), дашборд (6 графиков), фильтры дашборда (даты, продукты, методы, серийная/опытная), per-product donuts, кнопка "SQL → Локально" (только новые заявки), автоимпорт из YouGile, единый статус по protocol_date, детали (config-driven + редактирование формы), Schema Browser, Query Runner, Config Editor, метаданные updatedAt/updatedBy, задачи LPI исключены из общего кэша | ✅ | `ui/lpi-view.ts`, `ui/lpi-sync.ts`, `ui/lpi-dashboard.ts`, `ui/lpi-detail.ts`, `ui/lpi-modals.ts`, `ui/lpi-utils.ts`, `types/lpi.ts`, `types/lpi-config.ts`, `services/lpi-schema-service.ts`, `ui/lpi-schema-modal.ts` |
| 13 | **AssigneeSelector**: переиспользуемый компонент выбора пользователей (чекбоксы + email + setSelectedIds) | ✅ | `ui/assignee-selector.ts` |
| 14 | **Редактирование задачи**: в деталях задачи (задачи-вьюха) добавлена кнопка "Редактировать" — форма с title, description, project/board/column, assignees, deadline | ✅ | `ui/tasks-view.ts` |
| 15 | **ScheduleView → TasksView**: вызов `openTaskDetail()` через публичный API вместо прямого доступа к private-членам | ✅ | `ui/tasks-view.ts`, `ui/schedule-view.ts` |
| 16 | **SyncLogger**: журнал всех синхронизаций (LPI, Письма, Контакты, Задачи, офлайн-очередь), запись в `yourbase/sync_log.json`, модальное окно с фильтрацией, ribbon-иконка, команда | ✅ | `services/sync-logger.ts`, `main.ts`, `db.ts`, `email-db.ts`, `contact-db.ts`, `lpi-view.ts`, `tasks-view.ts` |
| 17 | **Презентации**: анкета → мозговой штурм → LLM (JSON) → generic-рендер HTML по TemplateSpec, шаблоны JSON (встроенный «Технониколь» + извлечение из примера через LLM), загрузка иллюстраций и фонов (папка `presentation_pics`, base64 в HTML; фоны — для всех типов слайдов: титул/контент/фото/финальный), позиционирование элементов титула/финала в шаблоне, затемнение фонов, индикатор генерации (элемент сразу в списке, статусы `generating`/`error`), полноэкранный режим (панель скрывается), переключение мышью (левая/правая), автопоказ по времени + зацикливание, эффекты перехода (fade/сдвиг), прогресс-бар, настройки «⚙ Показ», печать PDF без полей, финальный слайд «Спасибо за внимание», отправка в чат задачи YouGile, черновики с повтором генерации, дизайн-скил в `yourbase/presentation_rules/` | ✅ | `ui/presentations-view.ts`, `ui/presentation-modals.ts`, `services/presentation-generator.ts`, `services/presentation-templates.ts`, `database/presentations-db.ts`, `types/presentations.ts` |

## Структура файлов

```
src/
├── api/
│   └── client.ts                  # YouGileClient — все API-запросы
├── database/
│   ├── db.ts                      # LocalDatabase (yougile_cache.json)
│   ├── email-db.ts                # EmailDatabase (mailer_data.json)
│   ├── contact-db.ts              # ContactDatabase (contacts_data.json) (удалён lpi-db — всё в lpi_data.json)
│   └── presentations-db.ts        # PresentationsDatabase (presentations_data.json)
├── services/
│   ├── document-service.ts        # DOCX генерация (jszip + docx)
│   ├── llm-service.ts             # AI-чат с RAG + генерация презентаций (слайды, штурм, шаблоны)
│   ├── lpi-schema-service.ts      # Schema Service — чтение метаданных SQLite
│   ├── presentation-generator.ts  # Презентации: рендер HTML (TemplateSpec, posCss, изображения, полноэкранный режим)
│   ├── presentation-templates.ts  # Презентации: шаблоны TemplateSpec (JSON) + дизайн-скил
│   └── sync-logger.ts             # Журнал синхронизации (SyncLogger + SyncLogModal)
├── types/
│   ├── cache.ts                   # CachedTask, OfflineAction, …
│   ├── contacts.ts                # ContactItem, ContactDbData
│   ├── emails.ts                  # MailItem, MailDirection, EmailDbData
│   ├── lpi-config.ts              # LpiViewConfig + DEFAULT_CONFIG
│   ├── presentations.ts           # Презентации: TemplateSpec, слайды, анкета, черновики
│   ├── settings.ts                # YouGileSettings + DEFAULT_SETTINGS
│   ├── sql.js.d.ts                # Type declarations for sql.js
│   └── yougile.ts                 # YouGileTask, CreateTaskPayload, …
├── ui/
│   ├── assignee-selector.ts       # Переиспользуемый компонент выбора пользователей
│   ├── contacts-view.ts           # Контакты (таблица, create/edit, детали, QR-код)
│   ├── dashboard-view.ts          # Дашборд (ApexCharts, метрики, фильтры, JPG/CSV)
│   ├── documents-view.ts          # Документы (таблица, детали, замечания, CSV, HTML)
│   ├── emails-view.ts             # Письма (таблица, create/edit, файлы, AI-чат, HTML)
│   ├── lpi-view.ts                # LPI: основной view (таблица, фильтры, роутинг)
│   ├── lpi-sync.ts                # LPI: синхронизация (YouGile, SQLite, индивид. операции)
│   ├── lpi-dashboard.ts           # LPI: дашборд (ApexCharts, фильтры дашборда)
│   ├── lpi-detail.ts              # LPI: детали заявки + SQL Query Runner
│   ├── lpi-modals.ts              # LPI: модалки (ProductFilter, MethodFilter, YougileSync, ConfigEditor, LpiChanges)
│   ├── lpi-utils.ts               # LPI: утилиты (статусы, отображение)
│   ├── lpi-schema-modal.ts        # Schema Browser — просмотр схемы SQLite БД
│   ├── presentation-modals.ts     # Презентации: модалки (анкета, штурм, предпросмотр, шаблон, изображения, выбор задачи)
│   ├── presentations-view.ts      # Презентации (список, черновики, экспорт, отправка в чат YouGile)
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
- **LLM: до 5 моделей** — `llmModels: string[]` (один `llmApiUrl` и `llmApiKeySecret` на все) + `llmDefaultModel`; модель запроса разрешается через `LLMService.resolveModel(override)`; селекторы — в чате писем и во вьюхе презентаций; миграция `llmModel` → `llmModels` в `loadSettings()`
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
- **LPI таблица**: 9 колонок (● индикатор, №, материал, дата, статус, дата протокола, результат, оценка, действия); фильтры (дата, статус); две кнопки в колонке действий (📥 из SQL, 📤 в YouGile)
- **LPI статус**: единый — active/completed по наличию `protocol_date`; `completedLocally` удалён
- **LPI загрузка из SQL**: групповая — только новые заявки (отсутствующие в плагине и YouGile); индивидуальная — через 📥 в таблице
- **LPI синхронизация с YouGile**: матчинг по `application_external_id`; приоритет YouGile для `protocol_date`; задачи LPI исключены из общего кэша (фильтр по проекту)
- **LPI детали заявки**: 3 блока (Детали заявки, Результаты измерений, Выводы), все поля read-only (пустые — "—"), "Результат испытания" и "Общая оценка соответствия" — жирным, цветная Оценка (зелёный/красный/серый)"
- **LPI завершение**: только через LIMS (статус `received`) или YouGile-задачи (тип `lpi_data` или `lpi_completed`, `completed: true`); кнопка "Завершить заявку" из деталей удалена
- **LPI синхронизация (изменена в v0.5.3s)**:
  - **YouGile → плагин**: `syncFromTasks()` матчит задачи по `aggregate_id` И по `application_external_id` (второй — fallback для разных станций); `taskId` локальным записям НЕ проставляется; `completedLocally` обновляется только если у записи уже есть `taskId`, совпадающий с YouGile-задачей
  - **Плагин → YouGile**: `syncItemToYougile()` при создании задачи использует статус из SQLite (`application_status`), а не `completedLocally` — "новая" не создаётся завершённой; при обновлении существующей завершает задачу только если был переход active→terminal
  - **Отсечка авто-синхронизации при загрузке из SQL**: `parseInt(application_external_id) < 642` — заявки с номером меньше 642 не создаются в YouGile автоматически
  - **Ручная отправка** (кнопки "📤" в таблице и в деталях): без ограничений, отправляет любую заявку
  - **Кэш YouGile-задач**: `yougileTasksByExtId` (Map `application_external_id → task`) строится при `syncFromTasks()`, используется только для статуса `completedLocally`, не для `taskId`
- **LPI связи по application_id**: В SQLite заявки идентифицируются по `external_id` (человеческий номер, например "12345"), но все межтабличные связи используют UUID `application_id`. При загрузке из SQL добавляется `a.application_id` в запрос; в деталях и Schema Browser `{{application_id}}` подставляется автоматически. Для обращений к связанным таблицам через FK на `applications.application_id` генерируются двухшаговые запросы (сначала SELECT application_id FROM applications WHERE external_id = '...', затем работа с application_id). В авто-генерации Schema Browser и Query Runner FK на `applications.application_id` обрабатываются через `{{application_id}}`, остальные FK — через `{{column_name}}`.
- **ScheduleView → TasksView**: `openTaskDetail()` — публичный API-метод, заменяющий прямой доступ к `private detailViewActive`, `detailTaskId` и `renderTaskDetail()` из `ScheduleView`
- **Презентации**: модуль генерирует HTML-презентации из анкеты через LLM; шаблоны TemplateSpec хранятся в `yourbase/presentation_templates/*.json`, дизайн-скил в `yourbase/presentation_rules/`; пользовательские шаблоны имеют приоритет над встроенными с тем же id
- **Презентации: изображения**: при загрузке копируются в `presentation_pics/` с предсказуемыми путями (`<имя>.jpg`, при конфликте `-2`, `-3`), в HTML встраиваются как base64 (самодостаточный файл для распространения); старые data URI поддерживаются
- **Презентации: позиционирование**: элементы титульного и финального слайдов настраиваются в шаблоне через `pos` (пресет `align` + координаты left/top/right/bottom в cqw/cqh); финальный блок — абсолютный контейнер `.fin-block`
- **Презентации: затемнение фона**: настраивается в модалке «Изображения» (per-slide `bgDarken`, 0..1) и в шаблоне (`overlayOpacity`); применяется ко всем типам слайдов с фоном (титул/контент/photo/финальный)
- **Презентации: индикатор генерации**: `PresentationItem.status` (`generating`/`error`) — элемент создаётся сразу и появляется в списке с мигающим маркером `.mailer-blink`; при ошибке — кнопка перегенерации; «зависшие» генерации старше 10 мин помечаются `error` при `onOpen` (`markStaleGenerating`)
- **Презентации: полноэкранный режим**: в режиме «Слайды» слайд масштабируется под площадь экрана (16:9, `width:min(100vw, 100vh*16/9)`), кнопка «⛶ Экран»/клавиша F; панель управления `.toolbar` скрывается через `:fullscreen .toolbar { display:none }`; печать PDF — слайды занимают весь лист (`@page size:13.333in 7.5in; margin:0`)
- **Презентации: управление слайдами**: левый клик по слайду = вперёд, правый (`contextmenu` + preventDefault) = назад; клавиатура (стрелки/Space/Home/End) и свайп сохранены; автопоказ `setInterval` (интервал из шаблона/настроек «⚙ Показ», кнопка ▶/⏸ Авто, остановка на последнем слайде без loop); эффекты перехода через классы `slide-in/out-*` (fade/slide/none); прогресс-бар `.progress`; зацикливание `slideLoop` (навигация по модулю). Кэш HTML инвалидируется через `PRESENTATION_RENDER_VERSION`
- **Презентации: финальный слайд**: всегда «Спасибо за внимание» (требование в системном промпте + фиксированный рендер, игнорирующий heading1)
- **Презентации: кэш HTML**: привязан к версии рендера (`renderVersion`) и версии шаблона (`templateVersion` = mtime JSON-файла) — правки шаблона применяются сразу

## Настройки плагина

Настройки разделены на 8 складных блоков. У блоков «Календарь», «Документы», «Письма», «Дашборд», «Контакты», «LPI» и «Презентации» есть toggle — чекбокс включения/отключения модуля. Блок LPI по умолчанию свёрнут.

| Блок | Поля | Toggle |
|------|------|--------|
| Базовые настройки | companyId, логин, пароль, API-ключ, доска по умолч. | нет (всегда включён) |
| Календарь | проект, доска (dropdown) | `moduleCalendarEnabled` |
| Документы | проект, доска (dropdown) | `moduleDocumentsEnabled` |
| Письма | проект, доска, автор, AI-ключ, URL, модели LLM (до 5) + модель по умолчанию, системный промпт, DOCX-шаблон/папка | `moduleEmailsEnabled` |
| Контакты | проект, доска | `moduleContactsEnabled` |
| Дашборд | без настроек | `moduleDashboardEnabled` |
| LPI | путь к SQLite БД (кнопка "Обзор..."), проект, доска, колонка (dropdown) | `moduleLpiEnabled` (по умолч. false) |
| Презентации | кнопка "Открыть", шаблон по умолчанию (dropdown) | `modulePresentationsEnabled` |

## Правила версионирования и коммитов

### Версионирование
- Версия повышается в `manifest.json` (major.minor.patch) **только по прямому указанию пользователя**. Правки самого `AGENTS.md` (документация) версию **не** повышают.
- Добавлять описание всех изменений (на русском языке) в массив `CHANGELOG` в `src/main.ts` под новой версией
- Если пользователь называет номер сборки, который уже был использован ранее (уже есть в CHANGELOG или в git-тегах), необходимо указать на это и предложить следующий свободный номер

### Текущая версия: 0.8.8 (релиз)
- **Презентации**: WYSIWYG-редактор содержания (кнопка «✏️ Содержание») — правка текстов, списков, карточек, таблиц; добавление/удаление/перемещение слайдов; смена макета; живое превью. Единая сборка HTML — `buildPresentationHtml()` в `presentation-generator.ts` (`src/ui/presentation-editor.ts`, `src/ui/presentations-view.ts`).
- **Презентации**: предупреждение о потере ручных правок при перегенерации.
- **Типы**: добавлен `src/types/qrcode.d.ts` — устранены 2 ошибки типов qrcode (tsc 48 → 46).

- **Письма**: исправлена синхронизация с YouGile — в `syncAndRender()` убран `emailDb.init()` после `syncFromTasks()`, который перечитывал `mailer_data.json` и затирал свежие данные (гонка с недожданным `save()`); `syncFromTasks()` стал async и дожидается сохранения. Вьюха синхронизируется при открытии, ошибки `db.sync()` перехватываются.
- **Контакты**: `syncFromTasks()` дожидается сохранения в `contacts_data.json`.

- **LPI дашборд**: исправлена группировка графика «Завершение заявок по месяцам» — дата протокола нормализуется в месяц (YYYY-MM) через хелпер `toMonthKey()` (поддерживает ISO и ДД.ММ.ГГГГ), вместо ошибочной группировки по дням.
- **LLM: до 5 моделей** — в настройках блок «Письма → AI помощник» теперь позволяет задать до 5 моделей (одни API-ключ и URL) и модель по умолчанию; селекторы выбора модели добавлены в чат AI по письмам и во вьюху «Презентации» (генерация, мозговой штурм, извлечение шаблона). Разрешение модели — `LLMService.resolveModel()`: явный выбор → `llmDefaultModel` → первая из `llmModels` → legacy `llmModel` → дефолт. Миграция старого поля `llmModel` в `llmModels` — в `loadSettings()`.
- **⚠️ Требует проверки**: 0.8.4 (дата завершения `completeAt`) — после синка убедиться, что все завершённые задачи получили `completeAt` в `yourbase/yougile_cache.json` и повторные синки больше не перезапрашивают одни и те же задачи. Для задач, завершённых через плагин до фикса, дата ≈ момент до-простановки (исходную дату API не хранил).
- **Презентации (0.8.3)**: фоновые изображения применяются ко всем типам слайдов (контентные bullets/cards/table, финальный), в «Изображениях» исправлена нумерация селектов (`bg:title` + `bg:1..bg:N-1`); индикатор генерации — элемент сразу появляется в списке со статусом `generating` (мигающий маркер), при ошибке — `error` с кнопкой перегенерации; «зависшие» генерации старше 10 мин помечаются ошибкой при `onOpen`.

### Коммиты
- Каждый раз при изменении AGENTS.md формировать **summary** и **description** для git-коммита на **английском языке**
- Summary: одно предложение, глагол в наст.вр., начинается с типа (fix/feat/refactor/chore)
- Description: список изменений в виде буллетов с указанием файлов

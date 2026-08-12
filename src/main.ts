import { App, Plugin, Notice, Modal, Setting, WorkspaceLeaf } from 'obsidian';
import { YouGileSettings, DEFAULT_SETTINGS } from './types/settings';
import { YouGileClient } from './api/client';
import { YouGileSettingTab } from './ui/settings-tab';
import { TASKS_VIEW_TYPE, TasksView } from './ui/tasks-view';
import { SCHEDULE_VIEW_TYPE, ScheduleView } from './ui/schedule-view';
import { DOCUMENTS_VIEW_TYPE, DocumentsView } from './ui/documents-view';
import { EMAILS_VIEW_TYPE, EmailsView } from './ui/emails-view';
import { DASHBOARD_VIEW_TYPE, DashboardView } from './ui/dashboard-view';
import { SUGGESTIONS_VIEW_TYPE, SuggestionsView } from './ui/suggestions-view';
import { CONTACTS_VIEW_TYPE, ContactsView } from './ui/contacts-view';
import { LPI_VIEW_TYPE, LpiView } from './ui/lpi-view';
import { PRESENTATIONS_VIEW_TYPE, PresentationsView } from './ui/presentations-view';
import { registerCommands } from './commands';
import { LocalDatabase } from './database/db';
import { EmailDatabase } from './database/email-db';
import { ContactDatabase } from './database/contact-db';
import { PresentationsDatabase } from './database/presentations-db';
import { LLMService } from './services/llm-service';
import { PresentationTemplatesService } from './services/presentation-templates';
import { SyncLogger, SyncLogModal } from './services/sync-logger';

const PASSWORD_SECRET_ID = 'yougile-password';

const CHANGELOG: Record<string, string[]> = {
  '0.8.8': [
    'Презентации: новый WYSIWYG-редактор содержания (кнопка «✏️ Содержание») — правка заголовков, текстов, маркированных списков (добавление/удаление пунктов), карточек и таблиц (строки/столбцы); добавление, удаление и перемещение слайдов; смена макета с сохранением совместимых полей; живое превью обновляется в реальном времени',
    'Презентации: единая сборка HTML вынесена в buildPresentationHtml() — просмотр, экспорт и редактор используют общий код',
    'Презентации: при перегенерации показывается предупреждение, что ручные правки содержания будут потеряны',
    'Типы: добавлена декларация qrcode.d.ts — устранены 2 ошибки типов (tsc 48 → 46)',
  ],
  '0.8.7': [
    'Письма: исправлена синхронизация с YouGile — из syncAndRender убран вызов emailDb.init() после syncFromTasks, который перечитывал mailer_data.json с диска и затирал только что синхронизированные данные (save() не дожидался — гонка). syncFromTasks стал async и корректно сохраняет результат',
    'Письма: вьюха теперь синхронизируется при открытии (onOpen), а не только по кнопке «🔄»; ошибки db.sync() перехватываются с уведомлением, а не молча обрывают обновление списка',
    'Контакты: syncFromTasks дожидается сохранения в contacts_data.json, чтобы результат синхронизации не терялся',
  ],
  '0.8.6': [
    'LPI дашборд: исправлена группировка графика «Завершение заявок по месяцам» — дата протокола теперь нормализуется в месяц (YYYY-MM) независимо от формата (ISO или ДД.ММ.ГГГГ), вместо ошибочной группировки по дням',
  ],
  '0.8.5': [
    'Настройки: поддержка до 5 моделей LLM с одним API-ключом и URL (список моделей + модель по умолчанию)',
    'Письма: селектор выбора модели LLM в чате с AI помощником',
    'Презентации: селектор выбора модели LLM в вьюхе (генерация, мозговой штурм, извлечение шаблона)',
  ],
  '0.8.4': [
    'Дашборд: исправлена загрузка даты завершения (completeAt) — YouGile не записывает её при завершении через API, поэтому для задач без даты выполняется повторное завершение (PUT completed:true), после которого API фиксирует completedTimestamp',
    'Дашборд: повторный backfill даты завершения ограничен троттлингом 12 ч, чтобы не перезапрашивать задачи на каждом синке',
  ],
  '0.8.3': [
    'Презентации: фоновые изображения применяются ко всем типам слайдов — контентным (bullets/cards/table) и финальному, а не только к титульному',
    'Презентации: в настройках «Изображения» исправлена нумерация и доступен выбор фона для финального слайда',
    'Презентации: индикатор генерации — новая презентация сразу появляется в списке с мигающим маркером «Генерация…», по завершении превращается в готовую, при ошибке показывается статус с кнопкой перегенерации',
  ],
  '0.8.2': [
    'Презентации: панель управления скрывается в полноэкранном режиме (⛶ Экран / F)',
    'Презентации: переключение слайдов левой/правой кнопкой мыши (левая — вперёд, правая — назад)',
    'Презентации: автопереключение слайдов по времени (интервал настраивается, кнопка ▶/⏸ Авто в панели)',
    'Презентации: эффекты перехода между слайдами — Fade / Fade+сдвиг / без эффекта',
    'Презентации: прогресс-бар в режиме «Слайды» (включается/выключается)',
    'Презентации: зацикливание показа (после последнего слайда — снова первый)',
    'Презентации: настройки показа (⚙ Показ) — интервал, эффект, прогресс-бар, зацикливание; дефолты из шаблона',
  ],
  '0.8.1': [
    'Дашборд: «Динамика озадачивания» использует реальную дату завершения (completeAt из GET /tasks/{id}), а не дату создания',
    'Дашборд: дата-фильтры (с/по) учитывают дату создания ИЛИ завершения задачи',
    'Дашборд: в CSV-экспорт добавлена колонка «Завершена»',
    'Синхронизация: для завершённых задач дозагружается дата завершения (батчами по 5, троттлинг повторных попыток 12 ч), кэшируется в yougile_cache.json',
    'Синхронизация: защита от повторного входа (db.sync) — одновременные вызовы не дублируют запросы',
    'Синхронизация: заголовки подзадач переиспользуются из кэша, а не запрашиваются каждый раз',
  ],
  '0.8.0': [
    'Новый модуль «Презентации»: создание HTML-презентаций из анкеты через LLM (мозговой штурм, черновики с повтором генерации)',
    'Презентации: шаблоны оформления TemplateSpec (JSON) — встроенный «Технониколь» + извлечение шаблона из примера через LLM',
    'Презентации: загрузка иллюстраций (в анкете) и фонов слайдов; изображения копируются в папку presentation_pics с предсказуемыми путями, в HTML встраиваются как base64',
    'Презентации: позиционирование элементов титульного и финального слайдов в шаблоне (пресеты выравнивания + координаты в cqw/cqh)',
    'Презентации: управление затемнением фоновых изображений (в настройках изображений + overlayOpacity в шаблоне)',
    'Презентации: полноэкранный режим с масштабированием слайдов под площадь экрана (кнопка ⛶ / клавиша F)',
    'Презентации: печать PDF без полей — слайды занимают весь лист',
    'Презентации: финальный слайд всегда «Спасибо за внимание» (в промпте и рендере)',
    'Презентации: отправка презентации в чат задачи YouGile (файл → ссылка → тег <a>)',
    'Презентации: кэш HTML привязан к версии шаблона (mtime) — правки шаблона применяются сразу',
    'LLM: ретраи для 504/429 с экспоненциальной задержкой и клиентский таймаут запросов',
    'Настройки: пароль и API-ключ LLM через поле с типом password (стабильный ID секрета)',
  ],
  '0.7.6': [
    'LPI: исправлена синхронизация YouGile → локаль — null из YouGile перезаписывает локальное значение',
    'LPI: исправлен пропуск изменений при пустых значениях в YouGile (убрано условие && rv)',
  ],
  '0.7.5': [
    'LPI: исправлено исчезновение меню при переходе на дашборд — дочерний контейнер вместо корневого',
  ],
  '0.7.4': [
    'LPI: исправлены перепутанные статусы в donut-графике дашборда',
  ],
  '0.7.3': [
    'LPI: исправлено дублирование фильтров в дашборде — container.empty() перед рендером',
  ],
  '0.7.2': [
    'LPI: исправлена синхронизация YouGile — при выборе YouGile копируются все поля',
    'LPI: исправлено сравнение статуса — теперь по protocol_date, а не application_status',
  ],
  '0.7.1': [
    'LPI: детали заявки — все поля рендерятся как форма (input/select/textarea)',
    'LPI: кнопка "✏ Редактировать" переключает поля в активный режим',
    'LPI: редактирование доступно только при подключённой SQLite БД',
    'LPI: при сохранении изменения отправляются в YouGile и обновляются локально',
    'LPI: исправлено отображение даты протокола (ДД.ММ.ГГГГ → input[type=date])',
  ],
  '0.7.0': [
    'LPI: рефакторинг — модуль разбит на 6 файлов (lpi-view, lpi-sync, lpi-dashboard, lpi-detail, lpi-modals, lpi-utils)',
    'LPI: добавлены фильтры по дате создания и статусу в таблицу',
    'LPI: автоимпорт новых заявок из YouGile (всех статусов)',
    'LPI: загрузка из SQL только новых заявок (отсутствующих в плагине и YouGile)',
    'LPI: две иконки в колонке Действия — 📥 (обновить из SQL) и 📤 (отправить в YouGile)',
    'LPI: единый статус active/completed на основе protocol_date (completedLocally удалён)',
    'LPI: задачи лаборатории не попадают в общий кэш yougile_cache.json (фильтр по проекту)',
    'LPI: матчинг заявок с YouGile по application_external_id (не по taskId)',
    'LPI: приоритет YouGile как источника истины для protocol_date',
    'LPI: обновление taskId при синке (исправлено зацикливание при дублях)',
    'LPI: добавлены метаданные updatedAt/updatedBy',
    'LPI: диалог изменений LpiChangesModal для отображения расхождений',
    'LPI: уведомление о количестве изменённых полей при обновлении из SQL',
  ],
  '0.6.2': [
    'Добавлена вкладка "Расписание мероприятий" с динамическим календарём, переключением месяцев, просмотром дня',
    'Настройки расписания: выбор проекта/доски/колонки через выпадающие списки в GUI',
    'Вкладка "Задачи": добавлен фильтр "Все задачи" / "Мероприятия", в режиме "Мероприятия" фильтрация по настройкам календаря',
    'Форма создания мероприятия: название, место, аудитория, ответственный, дата, время, дополнительная информация, материнская задача',
    'Поля мероприятия (кроме ответственного) передаются как JSON в description, ответственный — в assigned, дата+время окончания — в deadline',
    'Проект, доска и колонка для мероприятий задаются только в настройках (не меняются при создании)',
    'В режиме "Все задачи с дедлайном" клик по задаче открывает её в стандартной вкладке "Задачи"',
  ],
  '0.2.0': [
    'Исправлена загрузка календаря (пустая страница из-за addClass с пробелами)',
    'Добавлен фильтр по доске в дашборд',
    'Добавлены подписи над фильтрами дашборда',
    'Добавлен поиск и фильтр по колонкам в Контакты',
    'Тип организации теперь хранится как ID колонки (динамическое разрешение названия)',
    'Исправлен каскад фильтров в Задачах (доски фильтруются по выбранному проекту)',
    'Все чекбоксы переведены на inline-стили (стабильное отображение в любых темах Obsidian)',
    'Кнопки "Обновить" унифицированы на 🔄',
    'Добавлено уведомление об обновлении (это окно) с историей изменений',
  ],
  '0.2.1': [
    'Исправлен баг "e.isShown is not a function" — модалка обновления открывается через onLayoutReady',
    'Обновлён AGENTS.md с правилами версионирования и коммитов',
    'Синхронизация полей модуля Предложения с настройками',
  ],
  '0.2.2': [
    'Исправлен баг "Attempting to register an existing view type" после перезапуска плагина updater\'ом',
    'Updater: исправлен путь скачивания файлов (TARGET_DIR vs TARGET_ID)',
    'Updater: очистка require.cache перед enablePlugin для применения изменений',
  ],
  '0.2.3': [
    'Все базы данных перенесены в папку yourbase/ относительно корня хранилища',
    'Пути к БД жёстко прописаны в коде (yourbase/yougile_cache.json, yourbase/mailer_data.json, yourbase/contacts_data.json)',
    'Удалены настройки "Путь к базе писем" и "Путь к базе контактов"',
  ],
  '0.2.4': [
    'Исправлена ошибка "getDirectionName is not a function", из-за которой не открывались детали письма',
    'Исправлен syncFromTasks — использовал неверные имена полей (topic, content вместо subject, text)',
    'Название направления (direction_name) теперь хранится прямо в теле письма, а не только как числовой direction_id',
    'Все существующие письма переформатированы: direction_name проставлен по direction_id',
  ],
  '0.3.0': [
    'Добавлен модуль "Лаборатория пожарных испытаний" (toggle в настройках, по умолчанию выключен)',
    'Модуль LPI читает данные из yourbase/lpi_data.json, отображает таблицу и детали заявок',
    'Проект, доска и колонка настроены жёстко (Лаборатория пожарных испытаний / Заявки / Заявки)',
    'Добавлен автор manifest.json: Е.Полищук',
  ],
  '0.3.1': [
    'Таблица LPI: добавлены колонки "Дата создания заявки", "Статус" (всего 6 колонок)',
    'Статус "Активна" отображается жёлтым, "Завершена" — зелёным',
    'У active-заявок в колонке "Дата протокола" показывается "—" (вместо fallback-даты 01.03.2026)',
    'Добавлен дашборд LPI с 4 графиками ApexCharts: статус (donut), заявки по месяцам (bar), оценка соответствия (donut), топ продуктов (bar)',
    'Добавлен модальный фильтр продуктов для дашборда (выбор любого количества из 174 уникальных продуктов)',
    'Переключение между режимами Таблица / Дашборд через кнопки в шапке',
  ],
  '0.3.5': [
    'Дашборд LPI: добавлены фильтры по датам (дата создания заявки с/по, дата протокола с/по)',
    'Дашборд LPI: добавлены чекбоксы "Серийная продукция" (если ЕКН цифровой) и "Опытная продукция" (независимые)',
    'График "Топ продуктов": полные названия (перенос на несколько строк), убраны цифры на барах, растянут на всю ширину',
    'При выборе нескольких продуктов: топ-продуктов заменён на круговые диаграммы соответствия по каждому продукту, общий круг остаётся',
    'Модальное окно выбора продуктов: показывает только продукты после всех фильтров, исправлен поиск',
  ],
  '0.4.0': [
    'LPI: завершение заявок — данные сохраняются в lpi_data.json (вместо отдельного lpi_completed.json)',
    'LPI: вкладка "Завершённые": поле выбора даты протокола (по умолч. сегодня), кнопка "Обновить" для чтения SQLite, таблица результатов, кнопка "Отправить" для пакетного завершения',
    'LPI: пакетное завершение — все найденные записи добавляются в lpi_data.json + создаются задачи YouGile с dateStart/dateEnd',
    'LPI: удалён lpi-db.ts (всё хранится в lpi_data.json как в письмах)',
    'Подключена библиотека sql.js (WASM) для чтения внешней SQLite БД',
  ],
  '0.4.1': [
    'Детали заявки LPI: переименованы поля ("Воспламенение ватки" → "Падение горящих капель расплава", "Соответствие по ватке" → "Соответствие по горящим каплям")',
    'Детали заявки LPI: поля сгруппированы в три блока (Детали заявки, Результаты измерений, Выводы), все поля отображаются всегда (пустые — как "—")',
    'Выводы в деталях заявки: "Результат испытания" и "Общая оценка соответствия" выделены жирным, Оценка цветная (зелёный/красный/серый)',
    'Дашборд LPI: добавлен фильтр "Подтверждаемый показатель" с человеческими названиями методов',
    'Дашборд LPI: фильтр продуктов показывает все продукты из полного списка (независимо от других фильтров)',
    'Дашборд LPI: график "Заявки по месяцам" разделён на "Поступление" и "Завершение" (всего 5 графиков)',
    'Таблица LPI: добавлена колонка "Результат испытания" (agg_gen_group)',
    'Исправлена ошибка поиска — null-safe вызовы toLowerCase() для полей с возможными null-значениями',
  ],
  '0.4.2': [
    'Настройки LPI: кнопка "Обзор..." для выбора SQLite БД через диалог Windows',
    'Исправлена загрузка SQLite — используется fs.existsSync/fs.readFileSync вместо adapter.exists/readBinary для внешних путей',
    'Нормализация слэшей в путях к БД (\\ → /)',
  ],
  '0.4.3': [
    'Настройки LPI: кнопка "Обзор..." переведена на Electron dialog.showOpenDialog (исправлен выбор внешних файлов)',
    'Добавлен fallback через input[type=file] если Electron API недоступен',
    'sql-wasm.wasm читается через fs.readFileSync из папки плагина (не через vault adapter)',
    'Если sql-wasm.wasm не найден локально — скачивается с GitHub raw (для пользователей updater)',
  ],
  '0.4.4': [
    'Бамп версии для активации updater на пользовательских машинах',
  ],
  '0.4.5': [
    'LPI: вкладка "Завершённые" переименована в "Зарегистрировать изменения в БД"',
    'LPI: синхронизация читает все записи из aggregated_results и сравнивает с локальной БД',
    'LPI: новые заявки создаются как задачи YouGile (активные/завершённые в зависимости от protocol_date)',
    'LPI: активные задачи с появившейся датой протокола автоматически завершаются',
    'Задачи: подзадачи в деталях выводятся списком с маркерами (вместо одной строки)',
  ],
  '0.4.6': [
    'Задачи: чат перенесён в детали задачи (встроенный, с отправкой файлов/изображений)',
    'Задачи: в чат добавлена загрузка файлов — изображения оборачиваются в <img>, остальные — в <a>',
    'Задачи: групповая вкладка "Чаты" восстановлена (список group-chats + загрузка по ID задачи)',
    'LPI: добавлена кнопка "Обновить" на вкладку таблицы (загрузка всех данных из SQLite в локальную БД)',
    'LPI: исправлено отображение статуса "new" — теперь показывается как "Новая" (вместо "Завершена")',
    'LPI: статус active/completed теперь определяется из поля application_status БД LIMS (не по protocol_date)',
    'LPI: исправлено создание задач YouGile — columnId: undefined вместо пустой строки',
  ],
  '0.4.7': [
    'LPI: детали заявки — поля переведены в редактируемые (input) с кнопкой сохранения',
    'LPI: результаты измерений и выводы остались read-only',
  ],
  '0.4.8': [
    'LPI: добавлены настройки проекта/доски/колонки в блоке LPI (выпадающие списки)',
    'LPI: создание задач использует колонку из настроек вместо undefined',
  ],
  '0.4.9': [
    'LPI: статус received теперь считается завершённым (TERMINAL_STATUSES)',
    'LPI: добавлен isEffectivelyActive — completedLocally блокирует откат статуса',
    'LPI: детали заявки переведены в read-only, удалена кнопка "Завершить заявку"',
    'LPI: кнопка "Обновить" теперь также вызывает syncFromTasks для YouGile-завершений',
  ],
  '0.4.10': [
    'LPI дашборд: добавлена круговая диаграмма "Результаты испытания" (agg_gen_group)',
  ],
  '0.4.11': [
    'LPI дашборд: разбиение результатов испытания по продуктам (per-product test result donuts)',
  ],
  '0.6.1': [
    'LPI: в загрузку SQL добавлено поле application_id (UUID) для обеспечения связей между таблицами по FK',
    'LPI: Schema Browser — авто-генерация запросов учитывает FK на applications.application_id (двухшаговое разрешение через external_id → application_id)',
    'LPI: Query Runner — авто-заполнение SQL использует {{application_id}} вместо некорректного {{aggregate_id}} для таблиц, связанных через application_id',
    'LPI: loadViewConfig всегда использует актуальный loadQuery из DEFAULT_CONFIG (совместимость со старыми конфигами)',
  ],
  '0.6.0': [
    'LPI: детали заявки переведены на config-driven рендеринг — поля, секции и подзапросы управляются через yourbase/lpi_view_config.json',
    'LPI: добавлен Schema Browser (кнопка "📐 Схема БД") — просмотр таблиц, колонок, FK, генерация шаблонов запросов',
    'LPI: добавлен Query Runner в деталях — произвольные SQL-запросы с подстановкой {{aggregate_id}}/{{application_external_id}}, результат в таблице',
    'LPI: добавлен Config Editor (кнопка "⚙ Редактор конфига") — редактирование конфига через текстовое поле',
    'LPI: добавлен LpiSchemaService — сервис для чтения метаданных SQLite (sqlite_master, PRAGMA table_info, PRAGMA foreign_key_list)',
    'LPI: добавлена поддержка subquery-секций в деталях — SQL-запросы, выполняемые при открытии заявки, с отображением в виде вложенной таблицы',
    'Настройки LPI: добавлен выбор источника конфига ("Файл" / "По умолчанию")',
  ],
  '0.5.4s': [
    'Добавлен журнал синхронизации: все операции синхронизации (LPI, Письма, Контакты, Задачи, офлайн-очередь) логируются в yourbase/sync_log.json',
    'Добавлена иконка "history" на ribbon для открытия журнала синхронизации',
    'Добавлена команда "Журнал синхронизации" для открытия модального окна с фильтрацией по модулю, направлению и статусу',
    'Журнал содержит: время, модуль, направление (→YouGile/←YouGile/локально), действие, ID, название, статус (✅/❌/⏭) и детали',
  ],
  '0.5.3s': [
    'LPI: syncFromTasks обновляет completedLocally только при наличии taskId',
    'LPI: syncItemToYougile при создании задачи использует статус из SQLite (не completedLocally)',
  ],
  '0.5.3': [
    'LPI: удалены ошибочные taskId из lpi_data.json (проставлялись syncFromTasks)',
    'LPI: отсечка авто-синхронизации изменена — external_id < 642 (вместо даты 2026-07-20)',
    'LPI: syncFromTasks больше не проставляет taskId локальным записям',
    'LPI: кнопка "📤" отправляет любую заявку без ограничения по external_id',
    'LPI: loadFromSqliteToLocal не использует кэш yougileTasksByExtId для taskId',
  ],
  '0.5.2': [
    'LPI: статус в таблице всегда показывает application_status (не жёстко "Завершена")',
    'LPI: в детали заявки и таблицу добавлена кнопка "Отправить в YouGile" (неактивна без SQLite)',
    'LPI: "Синхронизация YouGile" без SQL → прямая загрузка, с SQL → модалка расхождений',
    'ScheduleView: прямой доступ к private-членам TasksView заменён на публичный API openTaskDetail()',
  ],
  '0.5.1': [
    'LPI: кнопка "Обновить" разделена на "SQL → Локально" и "Синхронизация YouGile"',
    'LPI: при синхронизации YouGile → плагин заявки без локального соответствия импортируются автоматически',
    'LPI: расхождения по заявкам показываются в модальном окне с поштучным подтверждением',
    'Исправлен unsafe cast getTaskById: тип возврата изменён с YouGileTask на YouGileTaskFull',
  ],
  '0.5.0': [
    'LPI: существующие заявки с taskId больше не перезаписываются в YouGile при каждом "Обновить"',
    'LPI: при синхронизации YouGile→плагин используется дополнительное сопоставление по application_external_id (не только по taskId)',
    'LPI: добавлена временная отсечка — заявки созданные до 20.07.2026 не синхронизируются с YouGile',
    'Исправлен ContactItem.id: number → string (устранена ошибка сравнения числовых и строковых ID)',
    'Исправлена синхронизация контактов: note→notes, убрано поле completed, добавлены missing поля',
  ],
  '0.4.12': [
    'LPI: удалена вкладка "Зарегистрировать изменения в БД"',
    'LPI: синхронизация SQL → YouGile выполняется при нажатии "Обновить" на вкладке "Таблица"',
    'LPI: при обновлении создаются/обновляются задачи YouGile, полный JSON всех полей в description, завершённые заявки отмечаются completed: true',
    'LPI: блок настроек теперь сворачиваемый, по умолчанию свёрнут, каскадное обновление колонок при смене проекта/доски',
    'Задачи: добавлена кнопка "Редактировать" в деталях (название, описание, проект/доска/колонка, исполнители, дедлайн)',
    'AssigneeSelector: добавлен метод setSelectedIds для предзаполнения при редактировании',
    'LPI: устранена ошибка HTTP 400 (убраны поля dateEnd/dateStart из updateTask)',
    'LPI: type в description задач изменён на "lpi_data" (единый тип для всех LPI-задач)',
  ],
};

class ChangelogModal extends Modal {
  private version: string;
  private changes: string[];

  constructor(app: App, version: string, changes: string[]) {
    super(app);
    this.version = version;
    this.changes = changes;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: `✅ YouGile Integration обновлён до v${this.version}` });
    contentEl.createEl('hr');
    const list = contentEl.createEl('ul');
    for (const change of this.changes) {
      list.createEl('li', { text: change });
    }
    contentEl.createEl('hr');
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('OK').setCta().onClick(() => this.close()));
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default class YouGilePlugin extends Plugin {
  settings!: YouGileSettings;
  client!: YouGileClient;
  db!: LocalDatabase;
  emailDb!: EmailDatabase;
  contactDb!: ContactDatabase;
  presentationsDb!: PresentationsDatabase;
  presentationTemplates!: PresentationTemplatesService;
  llmService!: LLMService;
  syncLogger!: SyncLogger;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.client = new YouGileClient();
    const apiKey = this.getSecretValue(this.settings.apiKeySecret);
    if (apiKey) {
      this.client.setApiKey(apiKey);
    }

    this.db = new LocalDatabase(this.app, this);
    await this.db.init();
    await this.db.sync();
    this.normalizeProjectBoardSettings();

    const currentVersion = this.manifest.version;
    if (this.settings.shownVersion !== currentVersion && CHANGELOG[currentVersion]) {
      this.settings.shownVersion = currentVersion;
      await this.saveSettings();
      this.app.workspace.onLayoutReady(() => {
        new ChangelogModal(this.app, currentVersion, CHANGELOG[currentVersion]).open();
      });
    }

    this.emailDb = new EmailDatabase(this.app);
    await this.emailDb.init();

    this.contactDb = new ContactDatabase(this.app);
    await this.contactDb.init();

    this.presentationsDb = new PresentationsDatabase(this.app);
    await this.presentationsDb.init();

    this.presentationTemplates = new PresentationTemplatesService(this);
    await this.presentationTemplates.init();

    this.llmService = new LLMService(this);

    this.syncLogger = new SyncLogger(this.app);
    await this.syncLogger.init();

    this.addSettingTab(new YouGileSettingTab(this.app, this));

    this.safeRegisterView(TASKS_VIEW_TYPE, (leaf) => new TasksView(leaf, this));
    if (this.settings.moduleCalendarEnabled) {
      this.safeRegisterView(SCHEDULE_VIEW_TYPE, (leaf) => new ScheduleView(leaf, this));
    }
    if (this.settings.moduleDocumentsEnabled) {
      this.safeRegisterView(DOCUMENTS_VIEW_TYPE, (leaf) => new DocumentsView(leaf, this));
    }
    if (this.settings.moduleEmailsEnabled) {
      this.safeRegisterView(EMAILS_VIEW_TYPE, (leaf) => new EmailsView(leaf, this));
    }
    if (this.settings.moduleDashboardEnabled) {
      this.safeRegisterView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    }
    this.safeRegisterView(SUGGESTIONS_VIEW_TYPE, (leaf) => new SuggestionsView(leaf, this));
    if (this.settings.moduleContactsEnabled) {
      this.safeRegisterView(CONTACTS_VIEW_TYPE, (leaf) => new ContactsView(leaf, this));
    }
    if (this.settings.moduleLpiEnabled) {
      this.safeRegisterView(LPI_VIEW_TYPE, (leaf) => new LpiView(leaf, this));
    }
    if (this.settings.modulePresentationsEnabled) {
      this.safeRegisterView(PRESENTATIONS_VIEW_TYPE, (leaf) => new PresentationsView(leaf, this));
    }

    this.addRibbonIcon('list-todo', 'YouGile', () => {
      this.activateView();
    });

    if (this.settings.moduleCalendarEnabled) {
      this.addRibbonIcon('calendar', 'Расписание мероприятий', () => {
        this.activateScheduleView();
      });
    }

    if (this.settings.moduleDocumentsEnabled) {
      this.addRibbonIcon('file-text', 'Документы', () => {
        this.activateDocumentsView();
      });
    }

    if (this.settings.moduleEmailsEnabled) {
      this.addRibbonIcon('mail', 'Письма', () => {
        this.activateEmailsView();
      });
    }

    if (this.settings.moduleDashboardEnabled) {
      this.addRibbonIcon('bar-chart', 'Дашборд', () => {
        this.activateDashboardView();
      });
    }
    this.addRibbonIcon('lightbulb', 'Предложения', () => {
      this.activateSuggestionsView();
    });
    if (this.settings.moduleContactsEnabled) {
      this.addRibbonIcon('user', 'Контакты', () => {
        this.activateContactsView();
      });
    }
    if (this.settings.moduleLpiEnabled) {
      this.addRibbonIcon('flame', 'Лаборатория пожарных испытаний', () => {
        this.activateLpiView();
      });
    }
    if (this.settings.modulePresentationsEnabled) {
      this.addRibbonIcon('presentation', 'Презентации', () => {
        this.activatePresentationsView();
      });
    }

    this.addRibbonIcon('history', 'Журнал синхронизации', () => {
      new SyncLogModal(this.app, this.syncLogger).open();
    });

    registerCommands(this);
  }

  private safeRegisterView(type: string, viewCreator: (leaf: WorkspaceLeaf) => any): void {
    this.registerView(type as any, viewCreator as any);
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(TASKS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SCHEDULE_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DOCUMENTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(EMAILS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(SUGGESTIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(CONTACTS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(LPI_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(PRESENTATIONS_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData() as Partial<YouGileSettings>) || {};
    // Миграция старого одиночного поля llmModel → список llmModels
    if (!Array.isArray(data.llmModels) || data.llmModels.length === 0) {
      if (data.llmModel) {
        data.llmModels = [data.llmModel];
        data.llmDefaultModel = data.llmDefaultModel || data.llmModel;
      } else {
        data.llmModels = [];
      }
    }
    data.llmModels = (data.llmModels || []).filter(m => typeof m === 'string').slice(0, 5);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    this.normalizeProjectBoardSettings();
    await this.saveData(this.settings);
    const apiKey = this.getSecretValue(this.settings.apiKeySecret);
    if (apiKey) {
      this.client.setApiKey(apiKey);
    }
  }

  private normalizeProjectBoardSettings(): void {
    const pairs: Array<{ projectKey: keyof YouGileSettings; boardKey: keyof YouGileSettings }> = [
      { projectKey: 'calendarProjectId', boardKey: 'calendarBoardId' },
      { projectKey: 'docsProjectId', boardKey: 'docsBoardId' },
      { projectKey: 'emailProjectId', boardKey: 'emailBoardId' },
      { projectKey: 'contactProjectId', boardKey: 'contactBoardId' },
    ];
    const projects = this.db.getProjects();
    const boards = this.db.getBoards();
    for (const pair of pairs) {
      const pVal = this.settings[pair.projectKey] as string;
      const bVal = this.settings[pair.boardKey] as string;
      if (pVal && !projects.some(p => p.id === pVal)) {
        const byTitle = projects.find(p => p.title === pVal);
        if (byTitle) (this.settings[pair.projectKey] as string) = byTitle.id;
      }
      if (bVal && !boards.some(b => b.id === bVal)) {
        const byTitle = boards.find(b => b.title === bVal);
        if (byTitle) (this.settings[pair.boardKey] as string) = byTitle.id;
      }
    }
  }

  getSecretValue(secretName: string): string | null {
    if (!secretName) {
      return null;
    }
    try {
      return this.app.secretStorage?.getSecret(secretName) ?? null;
    } catch {
      return null;
    }
  }

  saveSecret(secretName: string, value: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, value);
    } catch {
      console.error('YouGile: Failed to save secret', secretName);
    }
  }

  getPassword(): string | null {
    return this.getSecretValue(PASSWORD_SECRET_ID);
  }

  savePassword(password: string): void {
    this.saveSecret(PASSWORD_SECRET_ID, password);
  }

  async authenticate(): Promise<void> {
    const password = this.getPassword();
    if (!this.settings.login || !password || !this.settings.companyId) {
      throw new Error('Заполните логин, пароль и ID компании в настройках');
    }
    const key = await this.client.auth(
      this.settings.login,
      password,
      this.settings.companyId,
    );
    const secretName = `yougile-apikey-${Date.now()}`;
    this.saveSecret(secretName, key);
    this.settings.apiKeySecret = secretName;
    await this.saveSettings();
    new Notice('YouGile: API ключ получен и сохранён защищённо');
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TASKS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: TASKS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateScheduleView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SCHEDULE_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: SCHEDULE_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateDocumentsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DOCUMENTS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: DOCUMENTS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateEmailsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(EMAILS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: EMAILS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateDashboardView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateSuggestionsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SUGGESTIONS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: SUGGESTIONS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateContactsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CONTACTS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: CONTACTS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activateLpiView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(LPI_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: LPI_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async activatePresentationsView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(PRESENTATIONS_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: PRESENTATIONS_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

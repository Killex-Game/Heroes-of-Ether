# Карта проекта

Здесь перечислены исходники по назначению. Быстрый поиск задачи — в [README](../README.md).
Старые названия можно найти в [таблице переименований](file-renames.json).

## Сервер

| Файл | Назначение |
| --- | --- |
| [src/server/accounts/account-benefits.js](../src/server/accounts/account-benefits.js) | Сроки VIP/Premium, множители наград и ежедневные бонусы. |
| [src/server/accounts/lite-account.js](../src/server/accounts/lite-account.js) | lite-account.js |
| [src/server/admin/moderation.js](../src/server/admin/moderation.js) | moderation.js |
| [src/server/admin/owner-access.js](../src/server/admin/owner-access.js) | owner-access.js |
| [src/server/admin/owner-service.js](../src/server/admin/owner-service.js) | owner-service.js |
| [src/server/admin/reserved-name.js](../src/server/admin/reserved-name.js) | reserved-name.js |
| [src/server/arena/accessory-abilities.js](../src/server/arena/accessory-abilities.js) | accessory-abilities.js |
| [src/server/arena/accessory-passives.js](../src/server/arena/accessory-passives.js) | accessory-passives.js |
| [src/server/arena/arena-directory.js](../src/server/arena/arena-directory.js) | Распределение мест между изолированными игровыми комнатами.  * Один экземпляр принадлежит одному координатору. Межпроцессных блокировок здесь нет.  * Комнаты starting необходимо создать в worker и подтвердить через markReady().  * Модуль не запускает серверы, не арендует машины и не читает рабочие профили. |
| [src/server/arena/arena-hazards.js](../src/server/arena/arena-hazards.js) | arena-hazards.js |
| [src/server/arena/arena-names.js](../src/server/arena/arena-names.js) | arena-names.js |
| [src/server/arena/arena-rooms.js](../src/server/arena/arena-rooms.js) | arena-rooms.js |
| [src/server/arena/arena-simulation.js](../src/server/arena/arena-simulation.js) | Серверная симуляция арены: движение, масса, деление, кормление, поглощение и снимки состояния. |
| [src/server/arena/circle-overlap.js](../src/server/arena/circle-overlap.js) | Геометрия пересечения кругов. |
| [src/server/arena/mass-accrual.js](../src/server/arena/mass-accrual.js) | Накопление только за наблюдавшееся время жизни, без оплаты пауз сервера. |
| [src/server/arena/mass-kill-bonus.js](../src/server/arena/mass-kill-bonus.js) | Бонус за накопленную массу и учёт порогов за одну жизнь. |
| [src/server/arena/profile-player-lookup.js](../src/server/arena/profile-player-lookup.js) | A notification batch is synchronous. Build its fallback index only when a |
| [src/server/arena/projectile-combat.js](../src/server/arena/projectile-combat.js) | Полёт и столкновения бустеров, отражения, ловушки и удерживаемый меч. |
| [src/server/arena/projectile-route.js](../src/server/arena/projectile-route.js) | Короткий маршрут кастета снаружи физических контуров шаров. |
| [src/server/arena/quest-actions.js](../src/server/arena/quest-actions.js) | Server-only, bounded receipt sequence per life. Nothing is added to room snapshots. |
| [src/server/arena/room-step.js](../src/server/arena/room-step.js) | The same step is used by the local server and the isolated process benchmark. |
| [src/server/arena/snapshot-timers.js](../src/server/arena/snapshot-timers.js) | Snapshot timer projection. Keep own-key order and the exact deadline test, |
| [src/server/arena/socket-frames.js](../src/server/arena/socket-frames.js) | socket-frames.js |
| [src/server/arena/spatial-collision-index.js](../src/server/arena/spatial-collision-index.js) | Пространственный индекс для поиска соседних шаров. |
| [src/server/arena/state-stream.js](../src/server/arena/state-stream.js) | Передача актуального состояния арены без накопления старых снимков. |
| [src/server/arena/state-worker-policy.js](../src/server/arena/state-worker-policy.js) | Resource limits, not gameplay rules. Memory values are MiB; deadlines are ms. |
| [src/server/arena/state-worker.js](../src/server/arena/state-worker.js) | Presentation only: this thread never opens profiles or runs game mechanics. |
| [src/server/arena/state-workers.js](../src/server/arena/state-workers.js) | Bounded room replication workers. One authoritative simulation/profile store  * remains in game-server. Only network snapshots cross this boundary. |
| [src/server/arena/tick-clock.js](../src/server/arena/tick-clock.js) | Keep the 50 ms cadence even when the OS wakes a timer a few ms late. |
| [src/server/arena/turbo-ability.js](../src/server/arena/turbo-ability.js) | Запас и переключение способности Турбо за одну жизнь. |
| [src/server/arena/visibility.js](../src/server/arena/visibility.js) | Replication only: physics always sees the complete room. |
| [src/server/arena/worker-food-transfer.js](../src/server/arena/worker-food-transfer.js) | Internal worker transport, not the client protocol. Each room keeps only |
| [src/server/arena/worker-part-transfer.js](../src/server/arena/worker-part-transfer.js) | Internal presentation transport only. Float64 preserves the simulation's |
| [src/server/boosters/booster-catalog.js](../src/server/boosters/booster-catalog.js) | Каталог, цены, длительности и правила применения бустеров. |
| [src/server/boosters/booster-effects.js](../src/server/boosters/booster-effects.js) | Изменение массы и частей шара от бустеров, поджог и периодические эффекты. |
| [src/server/chat/chat-service.js](../src/server/chat/chat-service.js) | Чат арены живёт в памяти сервера; последние сообщения кланов сохраняются отдельно. |
| [src/server/clans/clan-appearance.js](../src/server/clans/clan-appearance.js) | clan-appearance.js |
| [src/server/clans/clan-chest-rewards.js](../src/server/clans/clan-chest-rewards.js) | Выдача, получение, хранение и открытие клановых сундуков. |
| [src/server/clans/clan-competition-service.js](../src/server/clans/clan-competition-service.js) | Расписание битв, группы лиг, подсчёт результатов и выдача наград. |
| [src/server/clans/clan-level-progress.js](../src/server/clans/clan-level-progress.js) | Расчёт уровня клана и прогресса до следующего уровня. |
| [src/server/clans/clan-season-trophies.js](../src/server/clans/clan-season-trophies.js) | clan-season-trophies.js |
| [src/server/clans/clan-service.js](../src/server/clans/clan-service.js) | Создание кланов, состав, роли, заявки, казна и оружейная. |
| [src/server/clans/member-history.js](../src/server/clans/member-history.js) | member-history.js |
| [src/server/events/black-friday-chests.js](../src/server/events/black-friday-chests.js) | black-friday-chests.js |
| [src/server/events/black-friday-orders.js](../src/server/events/black-friday-orders.js) | Four independent slots, random tier order, bounded daily quotas. |
| [src/server/events/black-friday.js](../src/server/events/black-friday.js) | black-friday.js |
| [src/server/events/easter-hunt.js](../src/server/events/easter-hunt.js) | easter-hunt.js |
| [src/server/events/event-activities.js](../src/server/events/event-activities.js) | Installed companion activities share the parent launch ID and exact lifetime. |
| [src/server/events/event-album.js](../src/server/events/event-album.js) | event-album.js |
| [src/server/events/event-manager.js](../src/server/events/event-manager.js) | event-manager.js |
| [src/server/events/event-packs.js](../src/server/events/event-packs.js) | Only reviewed, installed content can be selected by an uploaded manifest. |
| [src/server/events/event-run-lookup.js](../src/server/events/event-run-lookup.js) | event-run-lookup.js |
| [src/server/events/life-collectibles.js](../src/server/events/life-collectibles.js) | Each event supplies its own life counters; the result dialog consumes one common format. |
| [src/server/events/lucky-week.js](../src/server/events/lucky-week.js) | lucky-week.js |
| [src/server/game-server.js](../src/server/game-server.js) | HTTP API, WebSocket, игровой цикл и корректное завершение сервера. |
| [src/server/http/request-rate-limits.js](../src/server/http/request-rate-limits.js) | Ограничение частоты HTTP/WebSocket запросов. |
| [src/server/http/static-file-server.js](../src/server/http/static-file-server.js) | Безопасная потоковая выдача браузерных файлов и изображений. |
| [src/server/http/trusted-proxy.js](../src/server/http/trusted-proxy.js) | trusted-proxy.js |
| [src/server/persistence/mongodb-config.js](../src/server/persistence/mongodb-config.js) | mongodb-config.js |
| [src/server/persistence/mongodb-health.js](../src/server/persistence/mongodb-health.js) | Read-only diagnostic. No profile data, URI, writer ID or credentials in output. |
| [src/server/persistence/mongodb-state.js](../src/server/persistence/mongodb-state.js) | No imports from the simulation. All hashing, file reads and network I/O run |
| [src/server/persistence/mongodb-sync.js](../src/server/persistence/mongodb-sync.js) | mongodb-sync.js |
| [src/server/persistence/mongodb-worker.js](../src/server/persistence/mongodb-worker.js) | mongodb-worker.js |
| [src/server/pets/arena-pets.js](../src/server/pets/arena-pets.js) | arena-pets.js |
| [src/server/pets/pet-service.js](../src/server/pets/pet-service.js) | pet-service.js |
| [src/server/profiles/accessory-access.js](../src/server/profiles/accessory-access.js) | accessory-access.js |
| [src/server/profiles/appearance-test-access.js](../src/server/profiles/appearance-test-access.js) | appearance-test-access.js |
| [src/server/profiles/arena-booster-queue.js](../src/server/profiles/arena-booster-queue.js) | arena-booster-queue.js |
| [src/server/profiles/arena-profile-copy.js](../src/server/profiles/arena-profile-copy.js) | Arena profiles are validated, persisted JSON trees. Copy their mutable data |
| [src/server/profiles/arena-progress-batched-shards.js](../src/server/profiles/arena-progress-batched-shards.js) | arena-progress-batched-shards.js |
| [src/server/profiles/arena-progress-preparer.js](../src/server/profiles/arena-progress-preparer.js) | arena-progress-preparer.js |
| [src/server/profiles/arena-progress-shard-worker.js](../src/server/profiles/arena-progress-shard-worker.js) | arena-progress-shard-worker.js |
| [src/server/profiles/arena-progress-shards.js](../src/server/profiles/arena-progress-shards.js) | arena-progress-shards.js |
| [src/server/profiles/arena-progress-worker.js](../src/server/profiles/arena-progress-worker.js) | arena-progress-worker.js |
| [src/server/profiles/copy-record.js](../src/server/profiles/copy-record.js) | copy-record.js |
| [src/server/profiles/gift-catalog.js](../src/server/profiles/gift-catalog.js) | gift-catalog.js |
| [src/server/profiles/gift-effects.js](../src/server/profiles/gift-effects.js) | gift-effects.js |
| [src/server/profiles/immutable-receipt-delta.js](../src/server/profiles/immutable-receipt-delta.js) | Process-local provenance for internally constructed immutable receipt buckets. |
| [src/server/profiles/immutable-table-delta.js](../src/server/profiles/immutable-table-delta.js) | Internal provenance for sealed copy-on-write tables. Never accept these hints |
| [src/server/profiles/league-appearance.js](../src/server/profiles/league-appearance.js) | league-appearance.js |
| [src/server/profiles/legacy-currency-text.js](../src/server/profiles/legacy-currency-text.js) | Только отображение старых системных наград. Сохранения и квитанции не меняем. |
| [src/server/profiles/nickname-rules.js](../src/server/profiles/nickname-rules.js) | nickname-rules.js |
| [src/server/profiles/operation-receipts.js](../src/server/profiles/operation-receipts.js) | Immutable arena-operation ledger. Keep every receipt, including previous |
| [src/server/profiles/player-social.js](../src/server/profiles/player-social.js) | Приглашения в брак и подарки: обе стороны меняются одной транзакцией. |
| [src/server/profiles/profile-batch.js](../src/server/profiles/profile-batch.js) | Only the synchronous preparation phase owns this table. It is sealed before |
| [src/server/profiles/profile-booster-worker.js](../src/server/profiles/profile-booster-worker.js) | profile-booster-worker.js |
| [src/server/profiles/profile-checkpoint-worker.js](../src/server/profiles/profile-checkpoint-worker.js) | profile-checkpoint-worker.js |
| [src/server/profiles/profile-index.js](../src/server/profiles/profile-index.js) | profile-index.js |
| [src/server/profiles/profile-journal.js](../src/server/profiles/profile-journal.js) | Durable small commits; full JSON checkpoints are built outside the arena thread. |
| [src/server/profiles/profile-store.js](../src/server/profiles/profile-store.js) | Загрузка и атомарное сохранение профилей, транзакции и публичные представления. |
| [src/server/profiles/profile-transfer.js](../src/server/profiles/profile-transfer.js) | profile-transfer.js |
| [src/server/profiles/profile-validation.js](../src/server/profiles/profile-validation.js) | Проверка ника, пола и ссылки VK; правила изменения личных данных. |
| [src/server/profiles/season-trophy-history.js](../src/server/profiles/season-trophy-history.js) | season-trophy-history.js |
| [src/server/profiles/settlement-cache.js](../src/server/profiles/settlement-cache.js) | settlement-cache.js |
| [src/server/profiles/transaction-history.js](../src/server/profiles/transaction-history.js) | История экономики сохраняется атомарно вместе с балансом и receipts. |
| [src/server/profiles/wardrobe-state.js](../src/server/profiles/wardrobe-state.js) | wardrobe-state.js |
| [src/server/progression/achievement-stages.js](../src/server/progression/achievement-stages.js) | Порог и накопленный прогресс отдельных степеней достижений. |
| [src/server/progression/activity-achievements.js](../src/server/progression/activity-achievements.js) | Достижения за посещения, расходы, клановую активность и время игры. |
| [src/server/progression/arena-objectives.js](../src/server/progression/arena-objectives.js) | Private, bounded projection. Never build treasury, achievement or shop catalogues here. |
| [src/server/progression/chest-bonuses.js](../src/server/progression/chest-bonuses.js) | chest-bonuses.js |
| [src/server/progression/daily-login.js](../src/server/progression/daily-login.js) | daily-login.js |
| [src/server/progression/experience-progression.js](../src/server/progression/experience-progression.js) | Уровни, опыт за арену, ограничения начисления и боевые достижения. |
| [src/server/progression/owned-accessory-count.js](../src/server/progression/owned-accessory-count.js) | owned-accessory-count.js |
| [src/server/progression/personal-quests.js](../src/server/progression/personal-quests.js) | personal-quests.js |
| [src/server/progression/quest-opponents.js](../src/server/progression/quest-opponents.js) | One opponent per assigned quest/order, identified by persistent profile ID. |
| [src/server/progression/quest-receipts.js](../src/server/progression/quest-receipts.js) | Immutable, sharded per-life receipts. Legacy `seen` remains readable and is |
| [src/server/progression/social-calendar.js](../src/server/progression/social-calendar.js) | social-calendar.js |
| [src/server/progression/title-chest-rewards.js](../src/server/progression/title-chest-rewards.js) | Титулы, величие и содержимое сундуков за титулы. |
| [src/server/progression/treasury-capacity.js](../src/server/progression/treasury-capacity.js) | treasury-capacity.js |
| [src/server/rankings/daily-leaderboards.js](../src/server/rankings/daily-leaderboards.js) | Суточные рейтинги игроков и смена расчётного дня. |
| [src/server/rankings/daily-ranking-notices.js](../src/server/rankings/daily-ranking-notices.js) | Уведомление сохраняется вместе с призом, прочтение не выдаёт награду повторно. |
| [src/server/rankings/event-leaderboards.js](../src/server/rankings/event-leaderboards.js) | event-leaderboards.js |
| [src/server/rankings/hall-of-fame.js](../src/server/rankings/hall-of-fame.js) | Read-only hall: earned titles, current committed greatness, bounded public rows. |
| [src/server/roulette/roulette-service.js](../src/server/roulette/roulette-service.js) | roulette-service.js |
| [src/server/runtime/local-network-addresses.js](../src/server/runtime/local-network-addresses.js) | Адреса этого сервера для игроков в той же локальной сети. |
| [src/server/runtime/maintenance.js](../src/server/runtime/maintenance.js) | maintenance.js |
| [src/server/runtime/performance-monitor.js](../src/server/runtime/performance-monitor.js) | performance-monitor.js |
| [src/server/runtime/player-presence.js](../src/server/runtime/player-presence.js) | Кратковременное присутствие в лобби; соединение с ареной учитывается отдельно. |
| [src/server/runtime/process-lock.js](../src/server/runtime/process-lock.js) | Защита файла сохранений от одновременного запуска двух серверов. |
| [src/server/runtime/server-settings.js](../src/server/runtime/server-settings.js) | Read and validate startup settings before opening data files or MongoDB. |
| [src/server/shop/promotion-offers.js](../src/server/shop/promotion-offers.js) | promotion-offers.js |
| [src/server/testing/arena-bot-brain.js](../src/server/testing/arena-bot-brain.js) | arena-bot-brain.js |
| [src/server/testing/arena-test-bots.js](../src/server/testing/arena-test-bots.js) | Тестовые кланы, составы и боты, активные при присутствии живого игрока. |
| [src/server/testing/battle-population.js](../src/server/testing/battle-population.js) | battle-population.js |
| [src/server/testing/bronze-population.js](../src/server/testing/bronze-population.js) | bronze-population.js |
| [src/server/testing/championship-opponents.js](../src/server/testing/championship-opponents.js) | Explicit local fixture, never an automatic population or reward generator. |
| [src/server/testing/extra-battle-clans.js](../src/server/testing/extra-battle-clans.js) | Explicit offline fixture: prepare everything in memory; never run on server startup. |
| [src/server/testing/lobby-bots.js](../src/server/testing/lobby-bots.js) | lobby-bots.js |
| [src/server/testing/population-names.js](../src/server/testing/population-names.js) | Explicit offline preparation only. Human names and clan identities are untouched. |
| [src/server/testing/sandbox-population.js](../src/server/testing/sandbox-population.js) | sandbox-population.js |

## Клиент и стили

| Файл | Назначение |
| --- | --- |
| [public/admin.html](../public/admin.html) | admin.html |
| [public/arena/accessory-renderer.js](../public/arena/accessory-renderer.js) | Рисование шапки и бабочки на шаре. |
| [public/arena/body-renderer.js](../public/arena/body-renderer.js) | Bounded raster caches. Only static painting is cached, never game state. |
| [public/arena/easter-renderer.js](../public/arena/easter-renderer.js) | easter-renderer.js |
| [public/arena/food-and-frame-renderer.js](../public/arena/food-and-frame-renderer.js) | Частицы еды, рамки аккаунтов и отдельные ободки лиг на арене. |
| [public/arena/game-audio.js](../public/arena/game-audio.js) | Музыка лобби и звуки арены с раздельными настройками. |
| [public/arena/shield-renderer.js](../public/arena/shield-renderer.js) | Рисование действующих щитов вокруг шара. |
| [public/blocked.html](../public/blocked.html) | blocked.html |
| [public/game-client.js](../public/game-client.js) | Главный браузерный контроллер: лобби, WebSocket, ввод и цикл рисования арены. |
| [public/index.html](../public/index.html) | Разметка страницы и порядок подключения модулей и CSS. |
| [public/maintenance.html](../public/maintenance.html) | maintenance.html |
| [public/shared/accessory-catalog.js](../public/shared/accessory-catalog.js) | Общие параметры аксессуаров для сервера и клиента. |
| [public/shared/achievement-badge.js](../public/shared/achievement-badge.js) | Общее золотое обрамление витрины и уведомлений; иллюстрация сохраняет свою палитру. |
| [public/shared/achievement-notifications.js](../public/shared/achievement-notifications.js) | Учёт прочитанных уведомлений о полученных степенях. |
| [public/shared/arena-backgrounds.js](../public/shared/arena-backgrounds.js) | Список фонов, выбор нового фона и браузерная отрисовка текстуры. |
| [public/shared/arena-camera-and-layout.js](../public/shared/arena-camera-and-layout.js) | Математика камеры, плавного масштаба, радиуса и подписей шаров. |
| [public/shared/arena-motion.js](../public/shared/arena-motion.js) | Отрисовка позиций между серверными шагами, без изменения игровой физики. |
| [public/shared/arena-names.js](../public/shared/arena-names.js) | Один справочник для списка арен, подсказок и серверных ответов. |
| [public/shared/arena-wire.js](../public/shared/arena-wire.js) | Compact state transport. The game receives the same complete player objects. |
| [public/shared/booster-cooldowns.js](../public/shared/booster-cooldowns.js) | Расчёт клиентских таймеров перезарядки по серверному состоянию. |
| [public/shared/booster-effect-renderer.js](../public/shared/booster-effect-renderer.js) | Значки активных эффектов, их расположение и пламя на горящем шаре. |
| [public/shared/clan-competition-rules.js](../public/shared/clan-competition-rules.js) | Общие правила лиг и описания степеней клановых сундуков. |
| [public/shared/clan-crest-art-data.js](../public/shared/clan-crest-art-data.js) | Сгенерированные данные форм, цветов и символов гербов. Генерируется из исходного набора: не изменять SVG данные вручную. |
| [public/shared/clan-crest-rules.js](../public/shared/clan-crest-rules.js) | Проверка параметров герба и SVG представление. |
| [public/shared/clan-crest-symbols-prism.js](../public/shared/clan-crest-symbols-prism.js) | Generated gold Prizm symbols; build evidence: docs/artwork/ui-corrections-20261031. |
| [public/shared/clan-crest-symbols-refined.js](../public/shared/clan-crest-symbols-refined.js) | Existing Prizm identities, refined detail. Sources: docs/artwork/crest-refined-20261108. |
| [public/shared/clan-crest-variants.js](../public/shared/clan-crest-variants.js) | Дополнительные формы и геральдические поля. Авторская геометрия проекта. |
| [public/shared/control-state.js](../public/shared/control-state.js) | A pending request blocks duplicate actions without looking like a game-rule lock. |
| [public/shared/daily-login-rewards.js](../public/shared/daily-login-rewards.js) | daily-login-rewards.js |
| [public/shared/daily-ranking-rules.js](../public/shared/daily-ranking-rules.js) | Общие правила призов и регалий суточных рейтингов. |
| [public/shared/easter-rules.js](../public/shared/easter-rules.js) | easter-rules.js |
| [public/shared/interface-theme.js](../public/shared/interface-theme.js) | Палитры интерфейса. Сохраняем светлоту деталей, объём SVG и контраст подписей. |
| [public/shared/league-appearance.js](../public/shared/league-appearance.js) | Общие идентификаторы оформления; сервер проверяет доступ к каждой лиге. |
| [public/shared/menu-notifications.js](../public/shared/menu-notifications.js) | Новые предметы отмечаются один раз; ожидающие действия остаются до выполнения. |
| [public/shared/pet-rules.js](../public/shared/pet-rules.js) | Общие отображаемые правила питомцев; покупки и применение подтверждает сервер. |
| [public/shared/platform-contract.js](../public/shared/platform-contract.js) | Stable identifiers retained for existing sessions, preferences and network clients. |
| [public/shared/player-identity.js](../public/shared/player-identity.js) | Каталог базовых скинов, подписи игроков и значки титулов. |
| [public/shared/progression-asset-paths.js](../public/shared/progression-asset-paths.js) | Пути к изображениям достижений, лиг, титулов и сундуков. |
| [public/shared/projectile-renderer.js](../public/shared/projectile-renderer.js) | Сглаживание, поворот и рисование летящих и удерживаемых бустеров. |
| [public/shared/quick-slot-rules.js](../public/shared/quick-slot-rules.js) | Клавиши слотов, их количество и перестановка предметов. |
| [public/shared/release-notes.js](../public/shared/release-notes.js) | Update this manifest for each public release; its ID is the acknowledgement key. |
| [public/shared/request-identifiers.js](../public/shared/request-identifiers.js) | Идентификаторы операций: работают и на localhost/HTTPS, и по HTTP в локальной сети. |
| [public/shared/roulette-rules.js](../public/shared/roulette-rules.js) | Общие описания призов. Результат вращения определяет только сервер. |
| [public/shared/skin-collection-preview.js](../public/shared/skin-collection-preview.js) | Shared permanent avatar collections and authoritative base prices. |
| [public/shared/virtual-product-catalog.js](../public/shared/virtual-product-catalog.js) | Единый каталог тестовых покупок за голоса: цены и выдаваемые продукты. |
| [public/styles/base/fonts.css](../public/styles/base/fonts.css) | Шрифт Inter и одинаковая ширина цифр. |
| [public/styles/base/page-and-arena.css](../public/styles/base/page-and-arena.css) | Базовые стили страницы, арены, HUD и стартовой разметки. |
| [public/styles/components/account-dialog.css](../public/styles/components/account-dialog.css) | Карточки аккаунтов и блок статусов профиля. |
| [public/styles/components/achievement-dialog.css](../public/styles/components/achievement-dialog.css) | Карточки достижений, фильтры, степени и Карьера. |
| [public/styles/components/arena-objectives.css](../public/styles/components/arena-objectives.css) | arena-objectives.css |
| [public/styles/components/arena-picker.css](../public/styles/components/arena-picker.css) | arena-picker.css |
| [public/styles/components/arena-touch-controls.css](../public/styles/components/arena-touch-controls.css) | arena-touch-controls.css |
| [public/styles/components/arena-transition.css](../public/styles/components/arena-transition.css) | Opaque, inexpensive curtain. No blur or heavyweight artwork during loading. |
| [public/styles/components/avatar-placement.css](../public/styles/components/avatar-placement.css) | Портреты не меняют размер шара, аксессуаров и рамки.    Обратная окружность clip-path остаётся на месте при сдвиге самого рисунка. |
| [public/styles/components/black-friday.css](../public/styles/components/black-friday.css) | Event-only UI. No running animation, canvas or timer on the arena. |
| [public/styles/components/clan-and-ranking-details.css](../public/styles/components/clan-and-ranking-details.css) | Индикаторы клана и игроков, ровные фильтры и десять строк рейтинга в окне. |
| [public/styles/components/clan-battle-panel.css](../public/styles/components/clan-battle-panel.css) | Таблицы участников и лиг, шкала битвы и личная награда. |
| [public/styles/components/clan-crest-editor.css](../public/styles/components/clan-crest-editor.css) | Сетка и элементы редактора гербов. |
| [public/styles/components/clan-dialog.css](../public/styles/components/clan-dialog.css) | Основная структура окон клана и управления участниками. |
| [public/styles/components/currency-purchase-dialog.css](../public/styles/components/currency-purchase-dialog.css) | Карточки пополнения валюты. |
| [public/styles/components/daily-ranking-notice.css](../public/styles/components/daily-ranking-notice.css) | daily-ranking-notice.css |
| [public/styles/components/easter-hunt.css](../public/styles/components/easter-hunt.css) | easter-hunt.css |
| [public/styles/components/event-album.css](../public/styles/components/event-album.css) | event-album.css |
| [public/styles/components/event-announcement.css](../public/styles/components/event-announcement.css) | event-announcement.css |
| [public/styles/components/event-lobby.css](../public/styles/components/event-lobby.css) | Event decoration replaces only the plain lobby (including its Premium tint).    Static vector patterns: no canvas, filters, animation or per-frame work.    Explicit colours keep event art independent of the chosen control palette. |
| [public/styles/components/events-page.css](../public/styles/components/events-page.css) | Ночной маршрут событий. Декорации не меняют геометрию карточек. |
| [public/styles/components/experience-progress.css](../public/styles/components/experience-progress.css) | Полосы опыта, результат жизни и уведомления об уровне. |
| [public/styles/components/game-interactions.css](../public/styles/components/game-interactions.css) | Keep forms editable while game art and labels behave like application UI. |
| [public/styles/components/game-loading.css](../public/styles/components/game-loading.css) | Initial loading is independent of the player's not-yet-loaded theme. |
| [public/styles/components/hall-of-fame.css](../public/styles/components/hall-of-fame.css) | The hall is a separate, sleeping lobby scene. Static SVG gradients; only opacity and transforms animate. |
| [public/styles/components/league-appearance.css](../public/styles/components/league-appearance.css) | Лиги используют самостоятельные векторные рамки и две композиции фона. |
| [public/styles/components/lobby-progress.css](../public/styles/components/lobby-progress.css) | Прогресс над персонажем: опыт по центру, величие слева, аккаунты справа. |
| [public/styles/components/lobby-wallet-accessories.css](../public/styles/components/lobby-wallet-accessories.css) | The profile reserves the full ornament; balances and actions stay together. |
| [public/styles/components/maintenance.css](../public/styles/components/maintenance.css) | maintenance.css |
| [public/styles/components/menu-icons.css](../public/styles/components/menu-icons.css) | Размеры иконок меню и валют. |
| [public/styles/components/menu-notifications.css](../public/styles/components/menu-notifications.css) | menu-notifications.css |
| [public/styles/components/mock-payment-dialog.css](../public/styles/components/mock-payment-dialog.css) | Компактная платёжная симуляция поверх витрины. |
| [public/styles/components/pets.css](../public/styles/components/pets.css) | Full-screen pet sanctuary, isolated from compact game dialogs. |
| [public/styles/components/player-chat.css](../public/styles/components/player-chat.css) | Постоянная читаемая палитра чата и золотая окантовка. |
| [public/styles/components/promotions.css](../public/styles/components/promotions.css) | promotions.css |
| [public/styles/components/quest-treasury.css](../public/styles/components/quest-treasury.css) | quest-treasury.css |
| [public/styles/components/quests.css](../public/styles/components/quests.css) | quests.css |
| [public/styles/components/quick-slot-editor.css](../public/styles/components/quick-slot-editor.css) | Редактор быстрых слотов и состояние перетаскивания. |
| [public/styles/components/ranking-layout.css](../public/styles/components/ranking-layout.css) | One footer position for every board; the outer dialog size is unchanged. |
| [public/styles/components/release-notes.css](../public/styles/components/release-notes.css) | release-notes.css |
| [public/styles/components/roulette.css](../public/styles/components/roulette.css) | roulette.css |
| [public/styles/components/shop-and-quick-slots.css](../public/styles/components/shop-and-quick-slots.css) | Магазин бустеров, инвентарь и панель быстрых слотов. |
| [public/styles/components/shop-sections.css](../public/styles/components/shop-sections.css) | Разделы магазина и инвентаря, коллекции и переключатели. |
| [public/styles/components/skin-and-wardrobe-dialogs.css](../public/styles/components/skin-and-wardrobe-dialogs.css) | Внешний вид выбора скинов и гардероба. |
| [public/styles/components/sky-lobby.css](../public/styles/components/sky-lobby.css) | The landscape never participates in layout or catches pointer events. |
| [public/styles/components/system-notifications.css](../public/styles/components/system-notifications.css) | Keep the original message nodes for their owners, but never reserve layout space. |
| [public/styles/components/title-and-chest-panels.css](../public/styles/components/title-and-chest-panels.css) | Витрина титулов и окна сундуков. |
| [public/styles/components/title-earned-dialog.css](../public/styles/components/title-earned-dialog.css) | title-earned-dialog.css |
| [public/styles/layout/dialog-and-menu-sizing.css](../public/styles/layout/dialog-and-menu-sizing.css) | Финальная геометрия окон, меню, шкал и вместимость коллекций. |
| [public/styles/layout/lobby-grid.css](../public/styles/layout/lobby-grid.css) | Базовая сетка лобби. |
| [public/styles/layout/responsive-interface.css](../public/styles/layout/responsive-interface.css) | Перенос и прокрутка без zoom: одинаковые доступные кнопки в основных движках. |
| [public/styles/layout/responsive-viewport.css](../public/styles/layout/responsive-viewport.css) | Адаптивные размеры лобби, диалогов и сеток. |
| [public/styles/owner-admin.css](../public/styles/owner-admin.css) | owner-admin.css |
| [public/styles/owner-events.css](../public/styles/owner-events.css) | owner-events.css |
| [public/styles/theme/account-colors.css](../public/styles/theme/account-colors.css) | Единая насыщенная палитра корон и подписей VIP/Premium. |
| [public/styles/theme/base-palette-materials.css](../public/styles/theme/base-palette-materials.css) | Generated by scripts/assets/build-base-palette.cjs. |
| [public/styles/theme/base-palette.css](../public/styles/theme/base-palette.css) | Approved base interface: Azure and Champagne. Geometry is unchanged. |
| [public/styles/theme/game-controls.css](../public/styles/theme/game-controls.css) | Общая тема кнопок, панелей, полей и рамок. |
| [public/styles/theme/interface-pack-palettes.css](../public/styles/theme/interface-pack-palettes.css) | Generated by scripts/assets/build-interface-pack-palettes.cjs. |
| [public/styles/theme/interface-packs.css](../public/styles/theme/interface-packs.css) | Visual packs change materials, never the original window/card geometry. |
| [public/styles/theme/interface-themes.css](../public/styles/theme/interface-themes.css) | Generated by scripts/assets/build-interface-themes.js. |
| [public/styles/theme/lobby-colors-and-controls.css](../public/styles/theme/lobby-colors-and-controls.css) | Насыщенный фон лобби, кнопки, тумблеры и декоративные эффекты. |
| [public/styles/theme/prism-buttons.css](../public/styles/theme/prism-buttons.css) | Prism supplies the material, the selected interface theme supplies its colour.    Geometry stays in the existing window/menu styles. |
| [public/styles/theme/profile-and-clan-details.css](../public/styles/theme/profile-and-clan-details.css) | Детали аватаров, профилей, рейтингов, кланов и коллекций. |
| [public/ui/accounts/account-dialog.js](../public/ui/accounts/account-dialog.js) | Окно VIP/Premium, активация и подписи срока действия. |
| [public/ui/admin/blocked-account.js](../public/ui/admin/blocked-account.js) | blocked-account.js |
| [public/ui/admin/event-manager.js](../public/ui/admin/event-manager.js) | event-manager.js |
| [public/ui/admin/owner-panel.js](../public/ui/admin/owner-panel.js) | owner-panel.js |
| [public/ui/admin/transaction-journal.js](../public/ui/admin/transaction-journal.js) | transaction-journal.js |
| [public/ui/arena/touch-controls.js](../public/ui/arena/touch-controls.js) | touch-controls.js |
| [public/ui/boosters/booster-tooltip.js](../public/ui/boosters/booster-tooltip.js) | Подсказка с описанием бустера при наведении и фокусе. |
| [public/ui/boosters/quick-slot-editor.js](../public/ui/boosters/quick-slot-editor.js) | Выбор, перестановка и перетаскивание бустеров в быстрые слоты. |
| [public/ui/boosters/shop-and-inventory-dialog.js](../public/ui/boosters/shop-and-inventory-dialog.js) | Магазин, инвентарь, быстрые слоты и отправка применения бустера. |
| [public/ui/chat/player-chat.js](../public/ui/chat/player-chat.js) | Общий вывод сообщений, компактный чат арены и приватный чат клана. |
| [public/ui/clans/clan-battle-and-treasury.js](../public/ui/clans/clan-battle-and-treasury.js) | Битва, таймер, шкала счёта, награды и Сокровищница. |
| [public/ui/clans/clan-crest-editor.js](../public/ui/clans/clan-crest-editor.js) | Редактор герба: выбор формы, цвета и символа. |
| [public/ui/clans/clan-crest-renderer.js](../public/ui/clans/clan-crest-renderer.js) | Рисование герба из растровых слоёв и кеш изображений. |
| [public/ui/clans/clan-dialog.js](../public/ui/clans/clan-dialog.js) | Окно клана: навигация, участники, управление и запросы к API. |
| [public/ui/clans/clan-preview.js](../public/ui/clans/clan-preview.js) | Public roster and battle, kept separate from the viewer's clan controls. |
| [public/ui/cosmetics/accessory-ability-ui.js](../public/ui/cosmetics/accessory-ability-ui.js) | Отдельный запас бустеров надетых аксессуаров на текущую жизнь. |
| [public/ui/cosmetics/league-appearance.js](../public/ui/cosmetics/league-appearance.js) | Независимый выбор фона лобби, рамки и мини-фона с серверным сохранением. |
| [public/ui/cosmetics/skin-and-wardrobe-dialogs.js](../public/ui/cosmetics/skin-and-wardrobe-dialogs.js) | Скины, гардероб, аксессуары и наборы аккаунтов. |
| [public/ui/layout/arena-transition.js](../public/ui/layout/arena-transition.js) | A light transition curtain, dismissed only after the destination is ready. |
| [public/ui/layout/dialog-content-layout.js](../public/ui/layout/dialog-content-layout.js) | Пагинация коллекций и подгонка содержимого окон по высоте. |
| [public/ui/layout/game-interactions.js](../public/ui/layout/game-interactions.js) | Native page dragging is separate from the intentional inventory drag-and-drop. |
| [public/ui/layout/game-loading.js](../public/ui/layout/game-loading.js) | Startup gate: server profile + runtime + decoded lobby assets, never a fake timer. |
| [public/ui/layout/maintenance.js](../public/ui/layout/maintenance.js) | One small status request; no arena redraw, image readback or profile reload. |
| [public/ui/layout/modal-stack.js](../public/ui/layout/modal-stack.js) | Порядок модальных окон, закрытие и восстановление фокуса. |
| [public/ui/layout/release-notes.js](../public/ui/layout/release-notes.js) | release-notes.js |
| [public/ui/layout/system-notifications.js](../public/ui/layout/system-notifications.js) | Сообщения об операциях показываются поверх интерфейса, не меняя его размеры. |
| [public/ui/layout/viewport-layout.js](../public/ui/layout/viewport-layout.js) | Подстройка лобби и окон под размеры экрана. |
| [public/ui/lobby/arena-picker.js](../public/ui/lobby/arena-picker.js) | arena-picker.js |
| [public/ui/lobby/menu-notifications.js](../public/ui/lobby/menu-notifications.js) | menu-notifications.js |
| [public/ui/lobby/promotion-banners.js](../public/ui/lobby/promotion-banners.js) | Баннеры VIP/Premium, события и кнопка статусов. |
| [public/ui/lobby/sky-scene.js](../public/ui/lobby/sky-scene.js) | Animate lobby water and fire in the painted landscape's source coordinates.    One GPU surface, no image readback, no work while the arena is visible. |
| [public/ui/pets/pet-dialog.js](../public/ui/pets/pet-dialog.js) | pet-dialog.js |
| [public/ui/profile/online-presence.js](../public/ui/profile/online-presence.js) | Обновляем присутствие открытого клиента, не записывая его в профиль на диске. |
| [public/ui/profile/player-awards.js](../public/ui/profile/player-awards.js) | Личная витрина: постоянные кубки, регалии и листание без переноса строк. |
| [public/ui/profile/player-social.js](../public/ui/profile/player-social.js) | Брак по взаимному согласию и подтверждаемая отправка подарков. |
| [public/ui/profile/profile-editor-dialog.js](../public/ui/profile/profile-editor-dialog.js) | Редактор ника, пола и ссылки VK. |
| [public/ui/profile/public-player-dialog.js](../public/ui/profile/public-player-dialog.js) | Просмотр другого игрока, аватар, награды и ссылка VK. |
| [public/ui/progression/achievement-dialog.js](../public/ui/progression/achievement-dialog.js) | Коллекция достижений, фильтры, детали и Карьера. |
| [public/ui/progression/arena-objectives.js](../public/ui/progression/arena-objectives.js) | arena-objectives.js |
| [public/ui/progression/black-friday.js](../public/ui/progression/black-friday.js) | black-friday.js |
| [public/ui/progression/chest-opening-dialog.js](../public/ui/progression/chest-opening-dialog.js) | Подтверждение открытия сундука и показ полученных наград. |
| [public/ui/progression/collection-earned-dialog.js](../public/ui/progression/collection-earned-dialog.js) | Награды полной коллекции: один показ с сохранением отметки в профиле. |
| [public/ui/progression/easter-hunt-page.js](../public/ui/progression/easter-hunt-page.js) | Альбом и обмен Пасхальной охоты. Все награды подтверждает сервер. |
| [public/ui/progression/event-album.js](../public/ui/progression/event-album.js) | Постоянный альбом изображений событий. |
| [public/ui/progression/event-announcement.js](../public/ui/progression/event-announcement.js) | event-announcement.js |
| [public/ui/progression/events-page.js](../public/ui/progression/events-page.js) | Каталог событий: кольцо вокруг Удачной недели, доступ определяется текущим запуском. |
| [public/ui/progression/experience-progress.js](../public/ui/progression/experience-progress.js) | Шкалы опыта, уведомление о новом уровне и итоги жизни. |
| [public/ui/progression/greatness-label.js](../public/ui/progression/greatness-label.js) | Единое отображение значка и числового значения величия. |
| [public/ui/progression/quest-dialog.js](../public/ui/progression/quest-dialog.js) | quest-dialog.js |
| [public/ui/progression/title-earned-dialog.js](../public/ui/progression/title-earned-dialog.js) | Одноразовое уведомление о новом титуле. Отметка хранится в профиле. |
| [public/ui/rankings/daily-ranking-notice.js](../public/ui/rankings/daily-ranking-notice.js) | daily-ranking-notice.js |
| [public/ui/rankings/hall-of-fame.js](../public/ui/rankings/hall-of-fame.js) | Seven fixed pedestals. Live portraits and lightweight, visibility-bound lighting. |
| [public/ui/rankings/leaderboard-dialog.js](../public/ui/rankings/leaderboard-dialog.js) | Окно рейтингов игроков и кланов. |
| [public/ui/roulette/roulette-dialog.js](../public/ui/roulette/roulette-dialog.js) | roulette-dialog.js |
| [public/ui/shop/currency-purchase-dialog.js](../public/ui/shop/currency-purchase-dialog.js) | Окно пополнения игровых валют и предложения магазина. |
| [public/ui/shop/mock-payment-dialog.js](../public/ui/shop/mock-payment-dialog.js) | Подтверждение тестовой покупки. Реальных платёжных запросов здесь нет. |
| [public/ui/shop/promotion-dialog.js](../public/ui/shop/promotion-dialog.js) | promotion-dialog.js |

## Служебные команды

| Файл | Назначение |
| --- | --- |
| [scripts/artwork/build-arena-objectives.cjs](../scripts/artwork/build-arena-objectives.cjs) | build-arena-objectives.cjs |
| [scripts/artwork/build-black-friday-achievements.cjs](../scripts/artwork/build-black-friday-achievements.cjs) | build-black-friday-achievements.cjs |
| [scripts/artwork/build-black-friday-expansion.cjs](../scripts/artwork/build-black-friday-expansion.cjs) | build-black-friday-expansion.cjs |
| [scripts/artwork/build-black-friday-v2.cjs](../scripts/artwork/build-black-friday-v2.cjs) | build-black-friday-v2.cjs |
| [scripts/artwork/build-black-friday.cjs](../scripts/artwork/build-black-friday.cjs) | build-black-friday.cjs |
| [scripts/artwork/build-crest-expansion.cjs](../scripts/artwork/build-crest-expansion.cjs) | build-crest-expansion.cjs |
| [scripts/artwork/build-currency-packs.cjs](../scripts/artwork/build-currency-packs.cjs) | Копируем оригиналы imagegen и уменьшаем их для интерфейса, не меняя рисунок. |
| [scripts/artwork/build-daily-stars-v2.cjs](../scripts/artwork/build-daily-stars-v2.cjs) | Package the generated transparent artwork; no drawing or alpha reconstruction. |
| [scripts/artwork/build-easter-achievements.cjs](../scripts/artwork/build-easter-achievements.cjs) | build-easter-achievements.cjs |
| [scripts/artwork/build-easter-assets.cjs](../scripts/artwork/build-easter-assets.cjs) | build-easter-assets.cjs |
| [scripts/artwork/build-ether-packs.cjs](../scripts/artwork/build-ether-packs.cjs) | Экспорт оригиналов imagegen: только прозрачные поля и масштаб для карточек. |
| [scripts/artwork/build-pet-levels.cjs](../scripts/artwork/build-pet-levels.cjs) | Technical export only: image_gen supplies alpha and artwork; this script never |
| [scripts/artwork/build-premium-avatars.cjs](../scripts/artwork/build-premium-avatars.cjs) | Только упаковка сгенерированных прозрачных оригиналов; рисунок и alpha не дорисовываются. |
| [scripts/artwork/compose-achievement.cjs](../scripts/artwork/compose-achievement.cjs) | Deterministic assembly. New artwork must contain the illustration only, without a frame. |
| [scripts/artwork/compose-pet-level-achievements.cjs](../scripts/artwork/compose-pet-level-achievements.cjs) | Fit complete generated characters inside the single canonical achievement frame. |
| [scripts/benchmarks/arena-cast-draft.cjs](../scripts/benchmarks/arena-cast-draft.cjs) | arena-cast-draft.cjs |
| [scripts/benchmarks/arena-hazards-performance.js](../scripts/benchmarks/arena-hazards-performance.js) | arena-hazards-performance.js |
| [scripts/benchmarks/arena-progress-history-draft.cjs](../scripts/benchmarks/arena-progress-history-draft.cjs) | arena-progress-history-draft.cjs |
| [scripts/benchmarks/arena-source-override.cjs](../scripts/benchmarks/arena-source-override.cjs) | Benchmark-only preload: compare a saved source revision without changing live files. |
| [scripts/benchmarks/audit-capacity.cjs](../scripts/benchmarks/audit-capacity.cjs) | Recover only the synthetic benchmark's private WAL and verify observed ACKs. |
| [scripts/benchmarks/baseline-progress.cjs](../scripts/benchmarks/baseline-progress.cjs) | Local benchmark only. Load saved sources without changing the running game. |
| [scripts/benchmarks/baseline-state.cjs](../scripts/benchmarks/baseline-state.cjs) | Test-only preload: compare saved replication sources without editing the  * running game's files. Worker threads inherit this preload; clients do not. |
| [scripts/benchmarks/booster-physics.cjs](../scripts/benchmarks/booster-physics.cjs) | Deterministic offline replay. Run in a dedicated Node process from the game root. |
| [scripts/benchmarks/browser-input-load.cjs](../scripts/benchmarks/browser-input-load.cjs) | Real browser input loop, synthetic accounts only; never loads saved players. |
| [scripts/benchmarks/browser-long-session.cjs](../scripts/benchmarks/browser-long-session.cjs) | Real browser input loop, synthetic accounts only; never loads saved players. |
| [scripts/benchmarks/capacity-assessment.cjs](../scripts/benchmarks/capacity-assessment.cjs) | Diagnostic targets, not a certification of browser FPS or long-run stability. |
| [scripts/benchmarks/clan-appearance-input-cache.cjs](../scripts/benchmarks/clan-appearance-input-cache.cjs) | clan-appearance-input-cache.cjs |
| [scripts/benchmarks/clan-score-copy.cjs](../scripts/benchmarks/clan-score-copy.cjs) | clan-score-copy.cjs |
| [scripts/benchmarks/collision-performance.js](../scripts/benchmarks/collision-performance.js) | Измерение производительности поиска столкновений. |
| [scripts/benchmarks/collision-source-equivalence.cjs](../scripts/benchmarks/collision-source-equivalence.cjs) | Compare the saved pre-optimization implementation with the current source. |
| [scripts/benchmarks/event-lifecycle.cjs](../scripts/benchmarks/event-lifecycle.cjs) | Trusted local baseline sources only. No game server, profile data or DB needed. |
| [scripts/benchmarks/event-order-capture.cjs](../scripts/benchmarks/event-order-capture.cjs) | event-order-capture.cjs |
| [scripts/benchmarks/experimental-food-delta.cjs](../scripts/benchmarks/experimental-food-delta.cjs) | Isolated transport probe; authoritative mechanics never read these tables. |
| [scripts/benchmarks/experimental-food-json.cjs](../scripts/benchmarks/experimental-food-json.cjs) | Local transport experiment. Not loaded by the game. |
| [scripts/benchmarks/experimental-food-transfer.cjs](../scripts/benchmarks/experimental-food-transfer.cjs) | Local benchmark only. Differential inter-thread food transport; no physics. |
| [scripts/benchmarks/experimental-incremental-settlement.cjs](../scripts/benchmarks/experimental-incremental-settlement.cjs) | Test-only preload: exercise existing behavioral tests with the optional |
| [scripts/benchmarks/experimental-packed-parts/state-transfer.js](../scripts/benchmarks/experimental-packed-parts/state-transfer.js) | Internal worker transport only. Float64 keeps the exact simulation values; |
| [scripts/benchmarks/experimental-packed-parts/state-transfer.test.js](../scripts/benchmarks/experimental-packed-parts/state-transfer.test.js) | state-transfer.test.js |
| [scripts/benchmarks/experimental-packed-parts/state-worker.experimental.js](../scripts/benchmarks/experimental-packed-parts/state-worker.experimental.js) | Presentation only: this thread never opens profiles or runs game mechanics. |
| [scripts/benchmarks/experimental-packed-parts/state-workers.experimental.js](../scripts/benchmarks/experimental-packed-parts/state-workers.experimental.js) | Bounded room replication workers. One authoritative simulation/profile store  * remains in game-server. Only network snapshots cross this boundary. |
| [scripts/benchmarks/experimental-part-transfer.cjs](../scripts/benchmarks/experimental-part-transfer.cjs) | Local benchmark only: transfer exact Float64 part fields, never physics. |
| [scripts/benchmarks/experimental-snapshot-tables.cjs](../scripts/benchmarks/experimental-snapshot-tables.cjs) | Isolated lossless worker transport probe. No game mechanics or network changes. |
| [scripts/benchmarks/experimental-socket-write.cjs](../scripts/benchmarks/experimental-socket-write.cjs) | Benchmark only: not imported by the game. Preserve the ws frame bytes while  * comparing one contiguous write with ws's standard two-buffer writev path. |
| [scripts/benchmarks/experimental-state-transfer.cjs](../scripts/benchmarks/experimental-state-transfer.cjs) | Test-only transport experiment; never imported by the live server. |
| [scripts/benchmarks/experimental-static-food-transfer.cjs](../scripts/benchmarks/experimental-static-food-transfer.cjs) | Benchmark only: compare sparse inter-thread food changes to full cloning. |
| [scripts/benchmarks/experimental-step-workers/graph-delta.js](../scripts/benchmarks/experimental-step-workers/graph-delta.js) | Private, lossless, bidirectional checkpoint transport. This is deliberately |
| [scripts/benchmarks/experimental-step-workers/step-state.js](../scripts/benchmarks/experimental-step-workers/step-state.js) | Internal checkpoint, NOT a client snapshot. Preserve Maps/Sets and shared |
| [scripts/benchmarks/experimental-step-workers/step-worker.js](../scripts/benchmarks/experimental-step-workers/step-worker.js) | step-worker.js |
| [scripts/benchmarks/experimental-step-workers/step-workers.js](../scripts/benchmarks/experimental-step-workers/step-workers.js) | step-workers.js |
| [scripts/benchmarks/experimental-worker-heap.cjs](../scripts/benchmarks/experimental-worker-heap.cjs) | Local benchmark only: measure bounded young-generation size. |
| [scripts/benchmarks/feed-compaction.cjs](../scripts/benchmarks/feed-compaction.cjs) | feed-compaction.cjs |
| [scripts/benchmarks/food-grid-sweep.cjs](../scripts/benchmarks/food-grid-sweep.cjs) | food-grid-sweep.cjs |
| [scripts/benchmarks/food-ordinal-cache.cjs](../scripts/benchmarks/food-ordinal-cache.cjs) | food-ordinal-cache.cjs |
| [scripts/benchmarks/food-ordinals.cjs](../scripts/benchmarks/food-ordinals.cjs) | food-ordinals.cjs |
| [scripts/benchmarks/food-worker-transport.cjs](../scripts/benchmarks/food-worker-transport.cjs) | Isolated transport comparison; not a room/client capacity result. |
| [scripts/benchmarks/hazard-replenishment.cjs](../scripts/benchmarks/hazard-replenishment.cjs) | hazard-replenishment.cjs |
| [scripts/benchmarks/hazard-step-cost.cjs](../scripts/benchmarks/hazard-step-cost.cjs) | hazard-step-cost.cjs |
| [scripts/benchmarks/journal-fields.cjs](../scripts/benchmarks/journal-fields.cjs) | Replay real in-memory profile drafts. Storage, sockets and physics are not timed. |
| [scripts/benchmarks/load-ack-audit.cjs](../scripts/benchmarks/load-ack-audit.cjs) | Explicit synthetic-client evidence. Session tokens never enter the artifact. |
| [scripts/benchmarks/lobby-profile-tables.cjs](../scripts/benchmarks/lobby-profile-tables.cjs) | lobby-profile-tables.cjs |
| [scripts/benchmarks/mongodb-capacity.cjs](../scripts/benchmarks/mongodb-capacity.cjs) | Explicit diagnostic: fresh synthetic databases only, never hero_ether. |
| [scripts/benchmarks/mongodb-load-store.cjs](../scripts/benchmarks/mongodb-load-store.cjs) | mongodb-load-store.cjs |
| [scripts/benchmarks/mongodb-room-fixture.cjs](../scripts/benchmarks/mongodb-room-fixture.cjs) | Synthetic world only. Never reads or changes the live profiles file. |
| [scripts/benchmarks/numeric-spatial-grid.cjs](../scripts/benchmarks/numeric-spatial-grid.cjs) | Compare a supplied baseline and a source transform without changing the game. |
| [scripts/benchmarks/packet-codec-comparison.cjs](../scripts/benchmarks/packet-codec-comparison.cjs) | packet-codec-comparison.cjs |
| [scripts/benchmarks/physics-grid-equivalence.cjs](../scripts/benchmarks/physics-grid-equivalence.cjs) | Run identical complete arena steps with the old/new grid. The old grid is |
| [scripts/benchmarks/physics-methods.cjs](../scripts/benchmarks/physics-methods.cjs) | Deterministic offline method comparison; no sockets, storage or production data. |
| [scripts/benchmarks/physics-small-work.cjs](../scripts/benchmarks/physics-small-work.cjs) | Exact deterministic all-booster replay. Baseline methods run in the same |
| [scripts/benchmarks/profile-batch-equivalence.cjs](../scripts/benchmarks/profile-batch-equivalence.cjs) | profile-batch-equivalence.cjs |
| [scripts/benchmarks/profile-draft-reconciliation.cjs](../scripts/benchmarks/profile-draft-reconciliation.cjs) | Compare complete progress drafts, not isolated helper-call timings. |
| [scripts/benchmarks/profile-transfer-table.cjs](../scripts/benchmarks/profile-transfer-table.cjs) | profile-transfer-table.cjs |
| [scripts/benchmarks/profile-workers.cjs](../scripts/benchmarks/profile-workers.cjs) | profile-workers.cjs |
| [scripts/benchmarks/progress-equivalence.cjs](../scripts/benchmarks/progress-equivalence.cjs) | Deterministic old/new source oracle. Synthetic profiles; no live store. |
| [scripts/benchmarks/quest-receipt-batch.cjs](../scripts/benchmarks/quest-receipt-batch.cjs) | Isolated receipt copy-cost comparison. Both paths retain the same receipts. |
| [scripts/benchmarks/resident-room-processes/child.cjs](../scripts/benchmarks/resident-room-processes/child.cjs) | child.cjs |
| [scripts/benchmarks/resident-room-processes/durable-casts.cjs](../scripts/benchmarks/resident-room-processes/durable-casts.cjs) | Experimental room IPC integration. The parent is the only profile writer. |
| [scripts/benchmarks/resident-room-processes/independent-progress.cjs](../scripts/benchmarks/resident-room-processes/independent-progress.cjs) | independent-progress.cjs |
| [scripts/benchmarks/resident-room-processes/input-state.cjs](../scripts/benchmarks/resident-room-processes/input-state.cjs) | Headless movement bots consume only these public/own fields. The optional |
| [scripts/benchmarks/resident-room-processes/peer-inputs.cjs](../scripts/benchmarks/resident-room-processes/peer-inputs.cjs) | peer-inputs.cjs |
| [scripts/benchmarks/resident-room-processes/peers.cjs](../scripts/benchmarks/resident-room-processes/peers.cjs) | peers.cjs |
| [scripts/benchmarks/resident-room-processes/progress-cursor.cjs](../scripts/benchmarks/resident-room-processes/progress-cursor.cjs) | A bounded receipt window supplements the permanent committed sequence. An |
| [scripts/benchmarks/resident-room-processes/progress-sink.cjs](../scripts/benchmarks/resident-room-processes/progress-sink.cjs) | Experimental single writer. No separate ProfileStore/WAL writer in a room. |
| [scripts/benchmarks/resident-room-processes/room-casts.cjs](../scripts/benchmarks/resident-room-processes/room-casts.cjs) | Experimental two-phase cast boundary. No disk work runs in this process. |
| [scripts/benchmarks/resident-room-processes/room-fixture.cjs](../scripts/benchmarks/resident-room-processes/room-fixture.cjs) | Load fixture, not a replacement for authenticated production joins/purchases. |
| [scripts/benchmarks/resident-room-processes/room-profile.cjs](../scripts/benchmarks/resident-room-processes/room-profile.cjs) | Only data consumed by the resident simulation. Persistent wallets, quest |
| [scripts/benchmarks/resident-room-processes/run.cjs](../scripts/benchmarks/resident-room-processes/run.cjs) | run.cjs |
| [scripts/benchmarks/resident-room-processes/services.cjs](../scripts/benchmarks/resident-room-processes/services.cjs) | Optional real HTTP lobby and Atlas mirror for the isolated resident fixture. |
| [scripts/benchmarks/resident-room-processes/socket-inputs.cjs](../scripts/benchmarks/resident-room-processes/socket-inputs.cjs) | Isolated load adapter. Production authentication/admission is deliberately |
| [scripts/benchmarks/resident-room-processes/transport.cjs](../scripts/benchmarks/resident-room-processes/transport.cjs) | Experimental transport adapter for the isolated benchmark only. |
| [scripts/benchmarks/reuse-spatial-insert.cjs](../scripts/benchmarks/reuse-spatial-insert.cjs) | reuse-spatial-insert.cjs |
| [scripts/benchmarks/room-capacity.cjs](../scripts/benchmarks/room-capacity.cjs) | Runs loopback arenas with synthetic profiles. No listener uses a game port.  * node scripts/benchmarks/room-capacity.cjs [shared\|isolated] [3\|5\|7\|10]  * "isolated" is an experiment: each server has its own temporary profile store. |
| [scripts/benchmarks/room-input-clients.cjs](../scripts/benchmarks/room-input-clients.cjs) | room-input-clients.cjs |
| [scripts/benchmarks/room-input-load.cjs](../scripts/benchmarks/room-input-load.cjs) | Isolated 35-player room. Synthetic profiles only, no production data/config writes. |
| [scripts/benchmarks/room-lobby-clients.cjs](../scripts/benchmarks/room-lobby-clients.cjs) | Synthetic HTTP lobby clients in a separate process, alongside the arena driver. |
| [scripts/benchmarks/settlement-probe.cjs](../scripts/benchmarks/settlement-probe.cjs) | settlement-probe.cjs |
| [scripts/benchmarks/snapshot-hotpaths.cjs](../scripts/benchmarks/snapshot-hotpaths.cjs) | Isolated deterministic snapshots/economy scans. No sockets or saved profiles.  * Run with a test-only baseline loader to compare identical output and cost. |
| [scripts/benchmarks/spatial-buffer-sweep.cjs](../scripts/benchmarks/spatial-buffer-sweep.cjs) | spatial-buffer-sweep.cjs |
| [scripts/benchmarks/state-broadcast.cjs](../scripts/benchmarks/state-broadcast.cjs) | Deterministic presentation-only replay. No listeners, profiles or game data.  * Optional BASELINE_STREAM points at a saved state-stream.js for byte comparison.  * Hashing is outside the timed region; no browser rendering or socket I/O here. |
| [scripts/benchmarks/state-frame-copy.cjs](../scripts/benchmarks/state-frame-copy.cjs) | Main-thread preparation only; excludes OS socket writes and worker allocation. |
| [scripts/benchmarks/state-payload.cjs](../scripts/benchmarks/state-payload.cjs) | Offline packet-size diagnostic with real room physics and all booster types.  * No sockets, saved profiles or inventory claims. Not a capacity benchmark. |
| [scripts/benchmarks/table-comparison-cache.cjs](../scripts/benchmarks/table-comparison-cache.cjs) | table-comparison-cache.cjs |
| [scripts/benchmarks/trace-durability.cjs](../scripts/benchmarks/trace-durability.cjs) | Diagnostic preloader for isolated benchmarks. Never imported by the server. |
| [scripts/benchmarks/trace-stalls.cjs](../scripts/benchmarks/trace-stalls.cjs) | Opt-in diagnostics for synthetic runs, never imported by the game. |
| [scripts/benchmarks/verify-arena-hud.cjs](../scripts/benchmarks/verify-arena-hud.cjs) | verify-arena-hud.cjs |
| [scripts/benchmarks/visibility-cells.cjs](../scripts/benchmarks/visibility-cells.cjs) | Deterministic AoI comparison, including index construction for each snapshot. |
| [scripts/benchmarks/worker-food-cache.cjs](../scripts/benchmarks/worker-food-cache.cjs) | worker-food-cache.cjs |
| [scripts/benchmarks/worker-part-transfer.cjs](../scripts/benchmarks/worker-part-transfer.cjs) | worker-part-transfer.cjs |
| [scripts/deployment/maintenance.cjs](../scripts/deployment/maintenance.cjs) | Перед обновлением: on, затем дождаться оповещения (1 сек) и штатно остановить сервер.  * Флаг сохраняется при перезапуске. Снимать через off только после проверки готовности.  * На VPS install-maintenance-nginx.sh устанавливает страницу, независимую от Node.  * /api/service-status доступен без создания профиля, при закрытом входе. |
| [scripts/deployment/mongodb-check.cjs](../scripts/deployment/mongodb-check.cjs) | mongodb-check.cjs |
| [scripts/deployment/mongodb-data.cjs](../scripts/deployment/mongodb-data.cjs) | init/verify are offline; export always writes a NEW directory, never live data. |
| [scripts/deployment/mongodb-health.cjs](../scripts/deployment/mongodb-health.cjs) | mongodb-health.cjs |
| [scripts/development/apply-arena-population.cjs](../scripts/development/apply-arena-population.cjs) | Explicit owner-approved offline fixture, never loaded by the game server. |
| [scripts/development/apply-community-population.cjs](../scripts/development/apply-community-population.cjs) | Explicit owner-approved offline operation, never imported by the game server. |
| [scripts/development/doctor.cjs](../scripts/development/doctor.cjs) | Read-only local diagnostics. Does not open ProfileStore, acquire a writer or connect to Atlas. |
| [scripts/development/finish-black-friday-ui.cjs](../scripts/development/finish-black-friday-ui.cjs) | finish-black-friday-ui.cjs |
| [scripts/development/grant-coins.js](../scripts/development/grant-coins.js) | Локальная подготовка тестовых данных: grant-coins. |
| [scripts/development/grant-hall-heroes.js](../scripts/development/grant-hall-heroes.js) | grant-hall-heroes.js |
| [scripts/development/grant-test-inventory.js](../scripts/development/grant-test-inventory.js) | Локальная подготовка тестовых данных: grant-test-inventory. |
| [scripts/development/manage-test-bots.js](../scripts/development/manage-test-bots.js) | Локальная подготовка тестовых данных: manage-test-bots. |
| [scripts/development/reset-for-release.cjs](../scripts/development/reset-for-release.cjs) | Explicit, offline owner operation. Never imported by the game server. |
| [scripts/development/seed-bronze-population.cjs](../scripts/development/seed-bronze-population.cjs) | seed-bronze-population.cjs |
| [scripts/development/seed-championship-opponents.cjs](../scripts/development/seed-championship-opponents.cjs) | seed-championship-opponents.cjs |
| [scripts/development/seed-extra-battle-clans.js](../scripts/development/seed-extra-battle-clans.js) | seed-extra-battle-clans.js |
| [scripts/development/upgrade-black-friday-v2.cjs](../scripts/development/upgrade-black-friday-v2.cjs) | upgrade-black-friday-v2.cjs |
| [scripts/documentation/build-clan-guide.py](../scripts/documentation/build-clan-guide.py) | Сборка PDF гайда по кланам. |
| [scripts/documentation/build-reference-docs.js](../scripts/documentation/build-reference-docs.js) | Справочники формируются из текущих каталогов и комментариев модулей. |
| [scripts/network/allow-local-players.ps1](../scripts/network/allow-local-players.ps1) | allow-local-players.ps1 |
| [scripts/network/start-test-tunnel.js](../scripts/network/start-test-tunnel.js) | Временный сетевой туннель для тестировщика. |
| [scripts/testing/check-events.cjs](../scripts/testing/check-events.cjs) | check-events.cjs |
| [scripts/testing/check-project-structure.js](../scripts/testing/check-project-structure.js) | Проверка переносов: импорты, HTML/CSS, каталоги изображений и список переименований. |
| [scripts/testing/event-checks.cjs](../scripts/testing/event-checks.cjs) | event-checks.cjs |
| [scripts/testing/run-tests.js](../scripts/testing/run-tests.js) | Запускаем только модульные и сетевые проверки. Браузерные сценарии запускаются отдельно. |

## Модульные тесты

| Файл | Назначение |
| --- | --- |
| [tests/unit/absorption-live-rules.test.js](../tests/unit/absorption-live-rules.test.js) | Модульные проверки игровых правил. |
| [tests/unit/absorption-order.test.js](../tests/unit/absorption-order.test.js) | absorption-order.test.js |
| [tests/unit/accessory-abilities.test.js](../tests/unit/accessory-abilities.test.js) | accessory-abilities.test.js |
| [tests/unit/accessory-achievement.test.js](../tests/unit/accessory-achievement.test.js) | accessory-achievement.test.js |
| [tests/unit/achievement-notices.test.js](../tests/unit/achievement-notices.test.js) | Модульные проверки игровых правил. |
| [tests/unit/achievement-reward-update.test.js](../tests/unit/achievement-reward-update.test.js) | achievement-reward-update.test.js |
| [tests/unit/advanced-boosters.test.js](../tests/unit/advanced-boosters.test.js) | Модульные проверки игровых правил. |
| [tests/unit/arena-and-progression-regressions.test.js](../tests/unit/arena-and-progression-regressions.test.js) | Модульные проверки игровых правил. |
| [tests/unit/arena-appearance-cache.test.js](../tests/unit/arena-appearance-cache.test.js) | arena-appearance-cache.test.js |
| [tests/unit/arena-award-settlement.test.js](../tests/unit/arena-award-settlement.test.js) | arena-award-settlement.test.js |
| [tests/unit/arena-bot-brain.test.js](../tests/unit/arena-bot-brain.test.js) | arena-bot-brain.test.js |
| [tests/unit/arena-cast-draft.test.js](../tests/unit/arena-cast-draft.test.js) | arena-cast-draft.test.js |
| [tests/unit/arena-chests-update.test.js](../tests/unit/arena-chests-update.test.js) | Модульные проверки игровых правил. |
| [tests/unit/arena-clan-rules.test.js](../tests/unit/arena-clan-rules.test.js) | Модульные проверки игровых правил. |
| [tests/unit/arena-departure.test.js](../tests/unit/arena-departure.test.js) | arena-departure.test.js |
| [tests/unit/arena-fade-causes.test.js](../tests/unit/arena-fade-causes.test.js) | arena-fade-causes.test.js |
| [tests/unit/arena-flow-regressions.test.js](../tests/unit/arena-flow-regressions.test.js) | arena-flow-regressions.test.js |
| [tests/unit/arena-hazards.test.js](../tests/unit/arena-hazards.test.js) | arena-hazards.test.js |
| [tests/unit/arena-motion.test.js](../tests/unit/arena-motion.test.js) | arena-motion.test.js |
| [tests/unit/arena-movement-retention.test.js](../tests/unit/arena-movement-retention.test.js) | arena-movement-retention.test.js |
| [tests/unit/arena-objectives.test.js](../tests/unit/arena-objectives.test.js) | arena-objectives.test.js |
| [tests/unit/arena-profile-copy.test.js](../tests/unit/arena-profile-copy.test.js) | arena-profile-copy.test.js |
| [tests/unit/arena-progress-history-draft.test.js](../tests/unit/arena-progress-history-draft.test.js) | arena-progress-history-draft.test.js |
| [tests/unit/arena-simulation.test.js](../tests/unit/arena-simulation.test.js) | Модульные проверки игровых правил. |
| [tests/unit/arena-size.test.js](../tests/unit/arena-size.test.js) | arena-size.test.js |
| [tests/unit/arena-step-delta.test.js](../tests/unit/arena-step-delta.test.js) | arena-step-delta.test.js |
| [tests/unit/arena-step-workers.test.js](../tests/unit/arena-step-workers.test.js) | arena-step-workers.test.js |
| [tests/unit/arena-visibility.test.js](../tests/unit/arena-visibility.test.js) | arena-visibility.test.js |
| [tests/unit/arena-wire.test.js](../tests/unit/arena-wire.test.js) | arena-wire.test.js |
| [tests/unit/black-friday-arena-orders.test.js](../tests/unit/black-friday-arena-orders.test.js) | black-friday-arena-orders.test.js |
| [tests/unit/black-friday-case.test.js](../tests/unit/black-friday-case.test.js) | black-friday-case.test.js |
| [tests/unit/black-friday-coupon-chests.test.js](../tests/unit/black-friday-coupon-chests.test.js) | black-friday-coupon-chests.test.js |
| [tests/unit/black-friday-expanded-chests.test.js](../tests/unit/black-friday-expanded-chests.test.js) | black-friday-expanded-chests.test.js |
| [tests/unit/black-friday-four-orders.test.js](../tests/unit/black-friday-four-orders.test.js) | black-friday-four-orders.test.js |
| [tests/unit/black-friday-order-balance.test.js](../tests/unit/black-friday-order-balance.test.js) | black-friday-order-balance.test.js |
| [tests/unit/black-friday-owner-credit.test.js](../tests/unit/black-friday-owner-credit.test.js) | black-friday-owner-credit.test.js |
| [tests/unit/black-friday-prize-receipts.test.js](../tests/unit/black-friday-prize-receipts.test.js) | black-friday-prize-receipts.test.js |
| [tests/unit/black-friday-progress-copy.test.js](../tests/unit/black-friday-progress-copy.test.js) | black-friday-progress-copy.test.js |
| [tests/unit/black-friday-stages.test.js](../tests/unit/black-friday-stages.test.js) | black-friday-stages.test.js |
| [tests/unit/black-friday.test.js](../tests/unit/black-friday.test.js) | black-friday.test.js |
| [tests/unit/body-render-cache.test.js](../tests/unit/body-render-cache.test.js) | body-render-cache.test.js |
| [tests/unit/booster-async-rebase.test.js](../tests/unit/booster-async-rebase.test.js) | booster-async-rebase.test.js |
| [tests/unit/booster-async-validation.test.js](../tests/unit/booster-async-validation.test.js) | booster-async-validation.test.js |
| [tests/unit/booster-batch-capacity.test.js](../tests/unit/booster-batch-capacity.test.js) | booster-batch-capacity.test.js |
| [tests/unit/booster-catalog.test.js](../tests/unit/booster-catalog.test.js) | Модульные проверки игровых правил. |
| [tests/unit/booster-document-changes.test.js](../tests/unit/booster-document-changes.test.js) | booster-document-changes.test.js |
| [tests/unit/booster-independent-input.test.js](../tests/unit/booster-independent-input.test.js) | booster-independent-input.test.js |
| [tests/unit/booster-level-access.test.js](../tests/unit/booster-level-access.test.js) | booster-level-access.test.js |
| [tests/unit/booster-retry-fairness.test.js](../tests/unit/booster-retry-fairness.test.js) | booster-retry-fairness.test.js |
| [tests/unit/booster-timing.test.js](../tests/unit/booster-timing.test.js) | Модульные проверки игровых правил. |
| [tests/unit/capacity-assessment.test.js](../tests/unit/capacity-assessment.test.js) | capacity-assessment.test.js |
| [tests/unit/championship-opponents.test.js](../tests/unit/championship-opponents.test.js) | championship-opponents.test.js |
| [tests/unit/clan-admission.test.js](../tests/unit/clan-admission.test.js) | clan-admission.test.js |
| [tests/unit/clan-appearance-input-cache.test.js](../tests/unit/clan-appearance-input-cache.test.js) | clan-appearance-input-cache.test.js |
| [tests/unit/clan-chat-retention.test.js](../tests/unit/clan-chat-retention.test.js) | clan-chat-retention.test.js |
| [tests/unit/clan-competition.test.js](../tests/unit/clan-competition.test.js) | Модульные проверки игровых правил. |
| [tests/unit/clan-crests.test.js](../tests/unit/clan-crests.test.js) | Модульные проверки игровых правил. |
| [tests/unit/clan-deadline-cache.test.js](../tests/unit/clan-deadline-cache.test.js) | clan-deadline-cache.test.js |
| [tests/unit/clan-level-capacity-and-rewards.test.js](../tests/unit/clan-level-capacity-and-rewards.test.js) | Границы вместимости, рамки 10 уровня и однократные награды за новый уровень. |
| [tests/unit/clan-member-history.test.js](../tests/unit/clan-member-history.test.js) | clan-member-history.test.js |
| [tests/unit/clan-notice-receipts.test.js](../tests/unit/clan-notice-receipts.test.js) | clan-notice-receipts.test.js |
| [tests/unit/clan-rules.test.js](../tests/unit/clan-rules.test.js) | Модульные проверки игровых правил. |
| [tests/unit/clan-season-trophies.test.js](../tests/unit/clan-season-trophies.test.js) | clan-season-trophies.test.js |
| [tests/unit/clan-service.test.js](../tests/unit/clan-service.test.js) | Модульные проверки игровых правил. |
| [tests/unit/competition-copy-on-write.test.js](../tests/unit/competition-copy-on-write.test.js) | competition-copy-on-write.test.js |
| [tests/unit/competition-due-runtime.test.js](../tests/unit/competition-due-runtime.test.js) | competition-due-runtime.test.js |
| [tests/unit/control-state.test.js](../tests/unit/control-state.test.js) | control-state.test.js |
| [tests/unit/copy-record.test.js](../tests/unit/copy-record.test.js) | copy-record.test.js |
| [tests/unit/daily-login.test.js](../tests/unit/daily-login.test.js) | daily-login.test.js |
| [tests/unit/daily-ranking-prizes.test.js](../tests/unit/daily-ranking-prizes.test.js) | daily-ranking-prizes.test.js |
| [tests/unit/easter-hunt.test.js](../tests/unit/easter-hunt.test.js) | easter-hunt.test.js |
| [tests/unit/effects-view.test.js](../tests/unit/effects-view.test.js) | Модульные проверки игровых правил. |
| [tests/unit/ether-currency.test.js](../tests/unit/ether-currency.test.js) | ether-currency.test.js |
| [tests/unit/event-lifecycle-cache.test.js](../tests/unit/event-lifecycle-cache.test.js) | event-lifecycle-cache.test.js |
| [tests/unit/event-manager.test.js](../tests/unit/event-manager.test.js) | event-manager.test.js |
| [tests/unit/event-ranking-calendar.test.js](../tests/unit/event-ranking-calendar.test.js) | event-ranking-calendar.test.js |
| [tests/unit/event-release-coverage.test.js](../tests/unit/event-release-coverage.test.js) | event-release-coverage.test.js |
| [tests/unit/event-roulette-companions.test.js](../tests/unit/event-roulette-companions.test.js) | event-roulette-companions.test.js |
| [tests/unit/event-timing.test.js](../tests/unit/event-timing.test.js) | event-timing.test.js |
| [tests/unit/event-window-timers.test.js](../tests/unit/event-window-timers.test.js) | event-window-timers.test.js |
| [tests/unit/expanded-achievements.test.js](../tests/unit/expanded-achievements.test.js) | Модульные проверки игровых правил. |
| [tests/unit/feed-compaction.test.js](../tests/unit/feed-compaction.test.js) | feed-compaction.test.js |
| [tests/unit/fire-sword.test.js](../tests/unit/fire-sword.test.js) | Модульные проверки игровых правил. |
| [tests/unit/forced-movement-walls.test.js](../tests/unit/forced-movement-walls.test.js) | forced-movement-walls.test.js |
| [tests/unit/formation-deltas.test.js](../tests/unit/formation-deltas.test.js) | formation-deltas.test.js |
| [tests/unit/game-audio.test.js](../tests/unit/game-audio.test.js) | game-audio.test.js |
| [tests/unit/geometry-view.test.js](../tests/unit/geometry-view.test.js) | Модульные проверки игровых правил. |
| [tests/unit/gift-effects.test.js](../tests/unit/gift-effects.test.js) | gift-effects.test.js |
| [tests/unit/ground-trap-shields.test.js](../tests/unit/ground-trap-shields.test.js) | ground-trap-shields.test.js |
| [tests/unit/hall-owner-grant.test.js](../tests/unit/hall-owner-grant.test.js) | hall-owner-grant.test.js |
| [tests/unit/harpoon-fixed-speed.test.js](../tests/unit/harpoon-fixed-speed.test.js) | harpoon-fixed-speed.test.js |
| [tests/unit/hazard-replenishment.test.js](../tests/unit/hazard-replenishment.test.js) | hazard-replenishment.test.js |
| [tests/unit/hero-chest.test.js](../tests/unit/hero-chest.test.js) | hero-chest.test.js |
| [tests/unit/heroic-orders.test.js](../tests/unit/heroic-orders.test.js) | heroic-orders.test.js |
| [tests/unit/hook-direction.test.js](../tests/unit/hook-direction.test.js) | hook-direction.test.js |
| [tests/unit/hook-range.test.js](../tests/unit/hook-range.test.js) | hook-range.test.js |
| [tests/unit/immutable-table-delta.test.js](../tests/unit/immutable-table-delta.test.js) | immutable-table-delta.test.js |
| [tests/unit/import-art.test.js](../tests/unit/import-art.test.js) | Модульные проверки игровых правил. |
| [tests/unit/incremental-settlement.test.js](../tests/unit/incremental-settlement.test.js) | incremental-settlement.test.js |
| [tests/unit/interface-theme.test.js](../tests/unit/interface-theme.test.js) | interface-theme.test.js |
| [tests/unit/journal-concurrent-seals.test.js](../tests/unit/journal-concurrent-seals.test.js) | journal-concurrent-seals.test.js |
| [tests/unit/journal-counter-delta.test.js](../tests/unit/journal-counter-delta.test.js) | journal-counter-delta.test.js |
| [tests/unit/journal-quest-session.test.js](../tests/unit/journal-quest-session.test.js) | journal-quest-session.test.js |
| [tests/unit/journal-sealed-backlog.test.js](../tests/unit/journal-sealed-backlog.test.js) | journal-sealed-backlog.test.js |
| [tests/unit/king-absorption-achievement.test.js](../tests/unit/king-absorption-achievement.test.js) | king-absorption-achievement.test.js |
| [tests/unit/knuckles-single-hit.test.js](../tests/unit/knuckles-single-hit.test.js) | knuckles-single-hit.test.js |
| [tests/unit/league-achievements.test.js](../tests/unit/league-achievements.test.js) | league-achievements.test.js |
| [tests/unit/leva-thorn-meals.test.js](../tests/unit/leva-thorn-meals.test.js) | leva-thorn-meals.test.js |
| [tests/unit/lite-account.test.js](../tests/unit/lite-account.test.js) | lite-account.test.js |
| [tests/unit/lite-event-lifecycle.test.js](../tests/unit/lite-event-lifecycle.test.js) | lite-event-lifecycle.test.js |
| [tests/unit/loadout.test.js](../tests/unit/loadout.test.js) | Модульные проверки игровых правил. |
| [tests/unit/lucky-week.test.js](../tests/unit/lucky-week.test.js) | lucky-week.test.js |
| [tests/unit/mass-accrual.test.js](../tests/unit/mass-accrual.test.js) | mass-accrual.test.js |
| [tests/unit/mass-decay.test.js](../tests/unit/mass-decay.test.js) | Модульные проверки игровых правил. |
| [tests/unit/mass-limits.test.js](../tests/unit/mass-limits.test.js) | Модульные проверки игровых правил. |
| [tests/unit/menu-notifications.test.js](../tests/unit/menu-notifications.test.js) | menu-notifications.test.js |
| [tests/unit/mine-rear-launch.test.js](../tests/unit/mine-rear-launch.test.js) | mine-rear-launch.test.js |
| [tests/unit/mongodb-health.test.js](../tests/unit/mongodb-health.test.js) | mongodb-health.test.js |
| [tests/unit/mongodb-resume.test.js](../tests/unit/mongodb-resume.test.js) | mongodb-resume.test.js |
| [tests/unit/mongodb-room-fixture.test.js](../tests/unit/mongodb-room-fixture.test.js) | mongodb-room-fixture.test.js |
| [tests/unit/mongodb-state.test.js](../tests/unit/mongodb-state.test.js) | mongodb-state.test.js |
| [tests/unit/owned-accessory-count.test.js](../tests/unit/owned-accessory-count.test.js) | owned-accessory-count.test.js |
| [tests/unit/owner-admin.test.js](../tests/unit/owner-admin.test.js) | owner-admin.test.js |
| [tests/unit/performance-monitor.test.js](../tests/unit/performance-monitor.test.js) | performance-monitor.test.js |
| [tests/unit/personal-quests.test.js](../tests/unit/personal-quests.test.js) | personal-quests.test.js |
| [tests/unit/pet-access.test.js](../tests/unit/pet-access.test.js) | pet-access.test.js |
| [tests/unit/pet-glove-shields.test.js](../tests/unit/pet-glove-shields.test.js) | pet-glove-shields.test.js |
| [tests/unit/pet-level-achievements.test.js](../tests/unit/pet-level-achievements.test.js) | pet-level-achievements.test.js |
| [tests/unit/pet-vitality-levels.test.js](../tests/unit/pet-vitality-levels.test.js) | pet-vitality-levels.test.js |
| [tests/unit/pets.test.js](../tests/unit/pets.test.js) | pets.test.js |
| [tests/unit/player-skin-assets.test.js](../tests/unit/player-skin-assets.test.js) | Стабильные ID VIP-набора, файлы разных размеров и смена источника портрета. |
| [tests/unit/poison-stone-regressions.test.js](../tests/unit/poison-stone-regressions.test.js) | poison-stone-regressions.test.js |
| [tests/unit/profile-batch.test.js](../tests/unit/profile-batch.test.js) | profile-batch.test.js |
| [tests/unit/profile-index.test.js](../tests/unit/profile-index.test.js) | profile-index.test.js |
| [tests/unit/profile-journal.test.js](../tests/unit/profile-journal.test.js) | profile-journal.test.js |
| [tests/unit/profile-player-lookup.test.js](../tests/unit/profile-player-lookup.test.js) | profile-player-lookup.test.js |
| [tests/unit/profile-transfer-table.test.js](../tests/unit/profile-transfer-table.test.js) | profile-transfer-table.test.js |
| [tests/unit/progression.test.js](../tests/unit/progression.test.js) | Модульные проверки игровых правил. |
| [tests/unit/projectile-bounds.test.js](../tests/unit/projectile-bounds.test.js) | projectile-bounds.test.js |
| [tests/unit/projectile-combat.test.js](../tests/unit/projectile-combat.test.js) | Модульные проверки игровых правил. |
| [tests/unit/projectile-contact-routing.test.js](../tests/unit/projectile-contact-routing.test.js) | projectile-contact-routing.test.js |
| [tests/unit/projectile-route.test.js](../tests/unit/projectile-route.test.js) | projectile-route.test.js |
| [tests/unit/projectile-shield-ownership.test.js](../tests/unit/projectile-shield-ownership.test.js) | projectile-shield-ownership.test.js |
| [tests/unit/projectiles-view.test.js](../tests/unit/projectiles-view.test.js) | Модульные проверки игровых правил. |
| [tests/unit/quest-distinct-opponents.test.js](../tests/unit/quest-distinct-opponents.test.js) | quest-distinct-opponents.test.js |
| [tests/unit/quest-receipt-batch.test.js](../tests/unit/quest-receipt-batch.test.js) | quest-receipt-batch.test.js |
| [tests/unit/random-chests.test.js](../tests/unit/random-chests.test.js) | Модульные проверки игровых правил. |
| [tests/unit/receipt-transfer-delta.test.js](../tests/unit/receipt-transfer-delta.test.js) | receipt-transfer-delta.test.js |
| [tests/unit/request-identifiers.test.js](../tests/unit/request-identifiers.test.js) | LAN HTTP: идентификаторы без secure-only API, уникальность и отсутствие прямых вызовов. |
| [tests/unit/request-limits.test.js](../tests/unit/request-limits.test.js) | Модульные проверки игровых правил. |
| [tests/unit/resident-peer-inputs.test.js](../tests/unit/resident-peer-inputs.test.js) | resident-peer-inputs.test.js |
| [tests/unit/restored-achievements.test.js](../tests/unit/restored-achievements.test.js) | restored-achievements.test.js |
| [tests/unit/room-food-encoder.test.js](../tests/unit/room-food-encoder.test.js) | room-food-encoder.test.js |
| [tests/unit/room-graph-delta.test.js](../tests/unit/room-graph-delta.test.js) | room-graph-delta.test.js |
| [tests/unit/room-part-limits.test.js](../tests/unit/room-part-limits.test.js) | room-part-limits.test.js |
| [tests/unit/roulette.test.js](../tests/unit/roulette.test.js) | roulette.test.js |
| [tests/unit/sequential-achievements.test.js](../tests/unit/sequential-achievements.test.js) | sequential-achievements.test.js |
| [tests/unit/server-settings.test.js](../tests/unit/server-settings.test.js) | server-settings.test.js |
| [tests/unit/snapshot-shape.test.js](../tests/unit/snapshot-shape.test.js) | snapshot-shape.test.js |
| [tests/unit/snapshot-timers.test.js](../tests/unit/snapshot-timers.test.js) | snapshot-timers.test.js |
| [tests/unit/socket-frames.test.js](../tests/unit/socket-frames.test.js) | socket-frames.test.js |
| [tests/unit/spatial-index.test.js](../tests/unit/spatial-index.test.js) | Модульные проверки игровых правил. |
| [tests/unit/spawn-equivalence.test.js](../tests/unit/spawn-equivalence.test.js) | spawn-equivalence.test.js |
| [tests/unit/split-limit-damage.test.js](../tests/unit/split-limit-damage.test.js) | split-limit-damage.test.js |
| [tests/unit/splitting.test.js](../tests/unit/splitting.test.js) | Модульные проверки игровых правил. |
| [tests/unit/state-event-visibility.test.js](../tests/unit/state-event-visibility.test.js) | state-event-visibility.test.js |
| [tests/unit/state-private-hud.test.js](../tests/unit/state-private-hud.test.js) | state-private-hud.test.js |
| [tests/unit/state-stream.test.js](../tests/unit/state-stream.test.js) | state-stream.test.js |
| [tests/unit/state-worker-lifecycle.test.js](../tests/unit/state-worker-lifecycle.test.js) | state-worker-lifecycle.test.js |
| [tests/unit/state-workers.test.js](../tests/unit/state-workers.test.js) | state-workers.test.js |
| [tests/unit/test-grant.test.js](../tests/unit/test-grant.test.js) | Модульные проверки игровых правил. |
| [tests/unit/tick-clock.test.js](../tests/unit/tick-clock.test.js) | tick-clock.test.js |
| [tests/unit/title-balance-migration.test.js](../tests/unit/title-balance-migration.test.js) | title-balance-migration.test.js |
| [tests/unit/titles.test.js](../tests/unit/titles.test.js) | Модульные проверки игровых правил. |
| [tests/unit/transaction-world-isolation.test.js](../tests/unit/transaction-world-isolation.test.js) | transaction-world-isolation.test.js |
| [tests/unit/treasury-capacity.test.js](../tests/unit/treasury-capacity.test.js) | treasury-capacity.test.js |
| [tests/unit/vk-mini-app-launch.test.js](../tests/unit/vk-mini-app-launch.test.js) | vk-mini-app-launch.test.js |
| [tests/unit/worker-food-transfer.test.js](../tests/unit/worker-food-transfer.test.js) | worker-food-transfer.test.js |
| [tests/unit/worker-part-transfer.test.js](../tests/unit/worker-part-transfer.test.js) | worker-part-transfer.test.js |

## Сетевые тесты

| Файл | Назначение |
| --- | --- |
| [tests/integration/accessories.test.js](../tests/integration/accessories.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/accessory-abilities.test.js](../tests/integration/accessory-abilities.test.js) | accessory-abilities.test.js |
| [tests/integration/accessory-preview.test.js](../tests/integration/accessory-preview.test.js) | accessory-preview.test.js |
| [tests/integration/accessory-shop.test.js](../tests/integration/accessory-shop.test.js) | accessory-shop.test.js |
| [tests/integration/account-currency-bonuses.test.js](../tests/integration/account-currency-bonuses.test.js) | Ежедневные бонусы аккаунтов: независимые валюты, полночь МСК и атомарная выдача. |
| [tests/integration/account-start-mass.test.js](../tests/integration/account-start-mass.test.js) | account-start-mass.test.js |
| [tests/integration/accounts-turbo.test.js](../tests/integration/accounts-turbo.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/all-chest-bonuses.test.js](../tests/integration/all-chest-bonuses.test.js) | all-chest-bonuses.test.js |
| [tests/integration/anonymous-gifts.test.js](../tests/integration/anonymous-gifts.test.js) | anonymous-gifts.test.js |
| [tests/integration/arena-absorption-cursor.test.js](../tests/integration/arena-absorption-cursor.test.js) | arena-absorption-cursor.test.js |
| [tests/integration/arena-backgrounds.test.js](../tests/integration/arena-backgrounds.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/arena-level-groups.test.js](../tests/integration/arena-level-groups.test.js) | arena-level-groups.test.js |
| [tests/integration/arena-operation-ledger.test.js](../tests/integration/arena-operation-ledger.test.js) | arena-operation-ledger.test.js |
| [tests/integration/arena-progress-batched-pipeline.test.js](../tests/integration/arena-progress-batched-pipeline.test.js) | arena-progress-batched-pipeline.test.js |
| [tests/integration/arena-progress-budget.test.js](../tests/integration/arena-progress-budget.test.js) | arena-progress-budget.test.js |
| [tests/integration/arena-progress-fairness.test.js](../tests/integration/arena-progress-fairness.test.js) | arena-progress-fairness.test.js |
| [tests/integration/arena-progress-pipeline.test.js](../tests/integration/arena-progress-pipeline.test.js) | arena-progress-pipeline.test.js |
| [tests/integration/arena-progress-sampling.test.js](../tests/integration/arena-progress-sampling.test.js) | arena-progress-sampling.test.js |
| [tests/integration/arena-progress-shards.test.js](../tests/integration/arena-progress-shards.test.js) | arena-progress-shards.test.js |
| [tests/integration/arena-progress-worker.test.js](../tests/integration/arena-progress-worker.test.js) | arena-progress-worker.test.js |
| [tests/integration/arena-receipt-isolation.test.js](../tests/integration/arena-receipt-isolation.test.js) | arena-receipt-isolation.test.js |
| [tests/integration/arena-rooms-server.test.js](../tests/integration/arena-rooms-server.test.js) | arena-rooms-server.test.js |
| [tests/integration/arena-title-settlement.test.js](../tests/integration/arena-title-settlement.test.js) | arena-title-settlement.test.js |
| [tests/integration/async-booster-movement.test.js](../tests/integration/async-booster-movement.test.js) | async-booster-movement.test.js |
| [tests/integration/async-lobby.test.js](../tests/integration/async-lobby.test.js) | async-lobby.test.js |
| [tests/integration/async-respawn.test.js](../tests/integration/async-respawn.test.js) | async-respawn.test.js |
| [tests/integration/black-friday-chest-tokens.test.js](../tests/integration/black-friday-chest-tokens.test.js) | black-friday-chest-tokens.test.js |
| [tests/integration/black-friday-economy.test.js](../tests/integration/black-friday-economy.test.js) | black-friday-economy.test.js |
| [tests/integration/black-friday-order-balance.test.js](../tests/integration/black-friday-order-balance.test.js) | black-friday-order-balance.test.js |
| [tests/integration/black-friday-recovery.test.js](../tests/integration/black-friday-recovery.test.js) | black-friday-recovery.test.js |
| [tests/integration/black-friday-server.test.js](../tests/integration/black-friday-server.test.js) | black-friday-server.test.js |
| [tests/integration/black-friday-stages.test.js](../tests/integration/black-friday-stages.test.js) | black-friday-stages.test.js |
| [tests/integration/booster-server.test.js](../tests/integration/booster-server.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/bronze-population.test.js](../tests/integration/bronze-population.test.js) | bronze-population.test.js |
| [tests/integration/century-promotions.test.js](../tests/integration/century-promotions.test.js) | century-promotions.test.js |
| [tests/integration/chest-account-bonuses.test.js](../tests/integration/chest-account-bonuses.test.js) | chest-account-bonuses.test.js |
| [tests/integration/chests-server.test.js](../tests/integration/chests-server.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/clan-battle-loss.test.js](../tests/integration/clan-battle-loss.test.js) | clan-battle-loss.test.js |
| [tests/integration/clan-notice-receipts-server.test.js](../tests/integration/clan-notice-receipts-server.test.js) | clan-notice-receipts-server.test.js |
| [tests/integration/clan-preview-personal.test.js](../tests/integration/clan-preview-personal.test.js) | clan-preview-personal.test.js |
| [tests/integration/clan-season-trophies.test.js](../tests/integration/clan-season-trophies.test.js) | clan-season-trophies.test.js |
| [tests/integration/currency-pack-receipts.test.js](../tests/integration/currency-pack-receipts.test.js) | currency-pack-receipts.test.js |
| [tests/integration/daily-ranking-prizes.test.js](../tests/integration/daily-ranking-prizes.test.js) | daily-ranking-prizes.test.js |
| [tests/integration/easter-hunt-server.test.js](../tests/integration/easter-hunt-server.test.js) | easter-hunt-server.test.js |
| [tests/integration/event-admin.test.js](../tests/integration/event-admin.test.js) | event-admin.test.js |
| [tests/integration/event-seekers.test.js](../tests/integration/event-seekers.test.js) | event-seekers.test.js |
| [tests/integration/extra-battle-clans.test.js](../tests/integration/extra-battle-clans.test.js) | extra-battle-clans.test.js |
| [tests/integration/feeding.test.js](../tests/integration/feeding.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/friday-roulette.test.js](../tests/integration/friday-roulette.test.js) | friday-roulette.test.js |
| [tests/integration/gift-effects.test.js](../tests/integration/gift-effects.test.js) | gift-effects.test.js |
| [tests/integration/hall-of-fame.test.js](../tests/integration/hall-of-fame.test.js) | hall-of-fame.test.js |
| [tests/integration/independent-room-progress.test.js](../tests/integration/independent-room-progress.test.js) | independent-room-progress.test.js |
| [tests/integration/interface-packs.test.js](../tests/integration/interface-packs.test.js) | interface-packs.test.js |
| [tests/integration/interface-theme.test.js](../tests/integration/interface-theme.test.js) | interface-theme.test.js |
| [tests/integration/journal-profile-store.test.js](../tests/integration/journal-profile-store.test.js) | journal-profile-store.test.js |
| [tests/integration/league-achievements.test.js](../tests/integration/league-achievements.test.js) | league-achievements.test.js |
| [tests/integration/league-appearance.test.js](../tests/integration/league-appearance.test.js) | league-appearance.test.js |
| [tests/integration/local-network-and-presence.test.js](../tests/integration/local-network-and-presence.test.js) | Несколько клиентов, единое серверное хранилище и присутствие в лобби/арене. |
| [tests/integration/lucky-leaderboard.test.js](../tests/integration/lucky-leaderboard.test.js) | lucky-leaderboard.test.js |
| [tests/integration/lucky-week-arena.test.js](../tests/integration/lucky-week-arena.test.js) | lucky-week-arena.test.js |
| [tests/integration/maintenance.test.js](../tests/integration/maintenance.test.js) | maintenance.test.js |
| [tests/integration/mock-payments.test.js](../tests/integration/mock-payments.test.js) | Тестовые покупки: выдача по каталогу, повтор запроса, запись и запреты HTTP. |
| [tests/integration/mongodb-atlas.test.js](../tests/integration/mongodb-atlas.test.js) | Opt-in network test. Only its uniquely created empty database is removed. |
| [tests/integration/mongodb-signup-sandbox.test.js](../tests/integration/mongodb-signup-sandbox.test.js) | mongodb-signup-sandbox.test.js |
| [tests/integration/owner-admin.test.js](../tests/integration/owner-admin.test.js) | owner-admin.test.js |
| [tests/integration/owner-recovery.test.js](../tests/integration/owner-recovery.test.js) | owner-recovery.test.js |
| [tests/integration/passive-activity-draft.test.js](../tests/integration/passive-activity-draft.test.js) | passive-activity-draft.test.js |
| [tests/integration/personal-quests-server.test.js](../tests/integration/personal-quests-server.test.js) | personal-quests-server.test.js |
| [tests/integration/personal-season-trophies.test.js](../tests/integration/personal-season-trophies.test.js) | personal-season-trophies.test.js |
| [tests/integration/pets-server.test.js](../tests/integration/pets-server.test.js) | pets-server.test.js |
| [tests/integration/player-chat.test.js](../tests/integration/player-chat.test.js) | player-chat.test.js |
| [tests/integration/player-social.test.js](../tests/integration/player-social.test.js) | player-social.test.js |
| [tests/integration/profile-daily.test.js](../tests/integration/profile-daily.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/progression-server.test.js](../tests/integration/progression-server.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/promotion-offers.test.js](../tests/integration/promotion-offers.test.js) | promotion-offers.test.js |
| [tests/integration/rank-frames-receipt.test.js](../tests/integration/rank-frames-receipt.test.js) | rank-frames-receipt.test.js |
| [tests/integration/resident-durable-casts.test.js](../tests/integration/resident-durable-casts.test.js) | resident-durable-casts.test.js |
| [tests/integration/resident-room-crash.test.js](../tests/integration/resident-room-crash.test.js) | resident-room-crash.test.js |
| [tests/integration/room-process-progress.test.js](../tests/integration/room-process-progress.test.js) | room-process-progress.test.js |
| [tests/integration/room-process-reconnect.test.js](../tests/integration/room-process-reconnect.test.js) | room-process-reconnect.test.js |
| [tests/integration/server-resilience.test.js](../tests/integration/server-resilience.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/server.test.js](../tests/integration/server.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/skin-collections.test.js](../tests/integration/skin-collections.test.js) | skin-collections.test.js |
| [tests/integration/smart-bots-server.test.js](../tests/integration/smart-bots-server.test.js) | smart-bots-server.test.js |
| [tests/integration/social-write-scope.test.js](../tests/integration/social-write-scope.test.js) | social-write-scope.test.js |
| [tests/integration/state-stream-server.test.js](../tests/integration/state-stream-server.test.js) | state-stream-server.test.js |
| [tests/integration/test-bots.test.js](../tests/integration/test-bots.test.js) | Интеграционные проверки сервера и протокола. |
| [tests/integration/title-earned-notice.test.js](../tests/integration/title-earned-notice.test.js) | title-earned-notice.test.js |
| [tests/integration/title-medal-history.test.js](../tests/integration/title-medal-history.test.js) | title-medal-history.test.js |
| [tests/integration/title-wardrobe.test.js](../tests/integration/title-wardrobe.test.js) | title-wardrobe.test.js |
| [tests/integration/transaction-history.test.js](../tests/integration/transaction-history.test.js) | transaction-history.test.js |
| [tests/integration/trusted-proxy.test.js](../tests/integration/trusted-proxy.test.js) | trusted-proxy.test.js |
| [tests/integration/unique-nicknames.test.js](../tests/integration/unique-nicknames.test.js) | unique-nicknames.test.js |
| [tests/integration/update-cadence.test.js](../tests/integration/update-cadence.test.js) | update-cadence.test.js |

## Браузерные сценарии

| Файл | Назначение |
| --- | --- |
| [tests/browser/absorption-camera.test.js](../tests/browser/absorption-camera.test.js) | Браузерный сценарий: absorption camera. |
| [tests/browser/account-ui-regalia.test.js](../tests/browser/account-ui-regalia.test.js) | account-ui-regalia.test.js |
| [tests/browser/accounts-chests.test.js](../tests/browser/accounts-chests.test.js) | Браузерный сценарий: accounts chests. |
| [tests/browser/achievements.test.js](../tests/browser/achievements.test.js) | Браузерный сценарий: achievements. |
| [tests/browser/all-chest-bonuses.test.js](../tests/browser/all-chest-bonuses.test.js) | all-chest-bonuses.test.js |
| [tests/browser/arena-booster-input.test.js](../tests/browser/arena-booster-input.test.js) | Реальная мышь, горячие клавиши и касания на панели арены. |
| [tests/browser/arena-departure.test.js](../tests/browser/arena-departure.test.js) | arena-departure.test.js |
| [tests/browser/arena-experience-results.test.js](../tests/browser/arena-experience-results.test.js) | Итоги арены: заполненная шкала при лимите опыта и обычный прогресс после нового входа. |
| [tests/browser/arena-hazards.test.js](../tests/browser/arena-hazards.test.js) | arena-hazards.test.js |
| [tests/browser/arena-live-hud-food.test.cjs](../tests/browser/arena-live-hud-food.test.cjs) | arena-live-hud-food.test.cjs |
| [tests/browser/arena-motion-smoothness.test.js](../tests/browser/arena-motion-smoothness.test.js) | arena-motion-smoothness.test.js |
| [tests/browser/arena-movement-retention.test.js](../tests/browser/arena-movement-retention.test.js) | arena-movement-retention.test.js |
| [tests/browser/arena-picker.test.js](../tests/browser/arena-picker.test.js) | arena-picker.test.js |
| [tests/browser/arena-rim-cache.test.cjs](../tests/browser/arena-rim-cache.test.cjs) | arena-rim-cache.test.cjs |
| [tests/browser/arena-rules.test.js](../tests/browser/arena-rules.test.js) | Браузерный сценарий: arena rules. |
| [tests/browser/arena-state-performance.test.js](../tests/browser/arena-state-performance.test.js) | Two synthetic players, 15 bots, maximum ejected food, slow Chrome and Firefox. |
| [tests/browser/backgrounds-greatness.test.js](../tests/browser/backgrounds-greatness.test.js) | Браузерный сценарий: backgrounds greatness. |
| [tests/browser/balance-ranks.test.js](../tests/browser/balance-ranks.test.js) | balance-ranks.test.js |
| [tests/browser/booster-repeat.test.js](../tests/browser/booster-repeat.test.js) | booster-repeat.test.js |
| [tests/browser/booster-shop-and-activation.test.js](../tests/browser/booster-shop-and-activation.test.js) | Браузерный сценарий: booster shop and activation. |
| [tests/browser/career-panel-layout.test.js](../tests/browser/career-panel-layout.test.js) | Браузерный сценарий: career panel layout. |
| [tests/browser/chest-camera.test.js](../tests/browser/chest-camera.test.js) | Браузерный сценарий: chest camera. |
| [tests/browser/chest-reward-pages.test.cjs](../tests/browser/chest-reward-pages.test.cjs) | chest-reward-pages.test.cjs |
| [tests/browser/clan-actions-and-notifications.test.js](../tests/browser/clan-actions-and-notifications.test.js) | Кнопки клана и уведомления: одинаковые размеры и отсутствие сдвигов при сообщениях. |
| [tests/browser/clan-appearance.test.js](../tests/browser/clan-appearance.test.js) | clan-appearance.test.js |
| [tests/browser/clan-battle-result.test.js](../tests/browser/clan-battle-result.test.js) | Итог битвы: гербы, счёт, двухчасовая подготовка и адаптивная кнопка награды. |
| [tests/browser/clan-battles-and-rewards.test.js](../tests/browser/clan-battles-and-rewards.test.js) | Браузерный сценарий: clan battles and rewards. |
| [tests/browser/clan-capacity-and-rankings.test.js](../tests/browser/clan-capacity-and-rankings.test.js) | Визуальная проверка клана, рейтинга, значков сети и уведомления о награде. |
| [tests/browser/clan-history-hud-aim.test.cjs](../tests/browser/clan-history-hud-aim.test.cjs) | clan-history-hud-aim.test.cjs |
| [tests/browser/clan-notice-expiry.test.js](../tests/browser/clan-notice-expiry.test.js) | clan-notice-expiry.test.js |
| [tests/browser/clan-preview-personal.test.cjs](../tests/browser/clan-preview-personal.test.cjs) | clan-preview-personal.test.cjs |
| [tests/browser/clan-reward-row-colors.test.js](../tests/browser/clan-reward-row-colors.test.js) | clan-reward-row-colors.test.js |
| [tests/browser/clan-rules.test.js](../tests/browser/clan-rules.test.js) | Браузерный сценарий: clan rules. |
| [tests/browser/clan-season-trophies.test.js](../tests/browser/clan-season-trophies.test.js) | clan-season-trophies.test.js |
| [tests/browser/connection-lost.test.js](../tests/browser/connection-lost.test.js) | Обрыв, ошибка и зависание арены: системное окно без автоматического выхода в лобби. |
| [tests/browser/cosmetics.test.js](../tests/browser/cosmetics.test.js) | Браузерный сценарий: cosmetics. |
| [tests/browser/crest-and-chest-notices.test.js](../tests/browser/crest-and-chest-notices.test.js) | crest-and-chest-notices.test.js |
| [tests/browser/crest-unlock-levels.test.js](../tests/browser/crest-unlock-levels.test.js) | crest-unlock-levels.test.js |
| [tests/browser/currency-pack-layout.test.js](../tests/browser/currency-pack-layout.test.js) | currency-pack-layout.test.js |
| [tests/browser/daily-ranking-notices.test.js](../tests/browser/daily-ranking-notices.test.js) | daily-ranking-notices.test.js |
| [tests/browser/daily-regalia-and-clan-appearance.test.js](../tests/browser/daily-regalia-and-clan-appearance.test.js) | daily-regalia-and-clan-appearance.test.js |
| [tests/browser/daily-top-rewards.test.js](../tests/browser/daily-top-rewards.test.js) | daily-top-rewards.test.js |
| [tests/browser/default-avatar-frame.test.js](../tests/browser/default-avatar-frame.test.js) | default-avatar-frame.test.js |
| [tests/browser/desktop-layout.test.js](../tests/browser/desktop-layout.test.js) | Совместимый запуск актуальных проверок адаптивного интерфейса. |
| [tests/browser/easter-collections-layout.test.js](../tests/browser/easter-collections-layout.test.js) | easter-collections-layout.test.js |
| [tests/browser/easter-hunt.test.js](../tests/browser/easter-hunt.test.js) | easter-hunt.test.js |
| [tests/browser/event-manager.test.js](../tests/browser/event-manager.test.js) | event-manager.test.js |
| [tests/browser/event-seekers.test.js](../tests/browser/event-seekers.test.js) | event-seekers.test.js |
| [tests/browser/events-page.test.js](../tests/browser/events-page.test.js) | events-page.test.js |
| [tests/browser/expanded-achievements.test.js](../tests/browser/expanded-achievements.test.js) | Браузерный сценарий: expanded achievements. |
| [tests/browser/fire-sword-burn.test.js](../tests/browser/fire-sword-burn.test.js) | Браузерный сценарий: fire sword burn. |
| [tests/browser/full-game-flow.test.js](../tests/browser/full-game-flow.test.js) | Браузерный сценарий: full game flow. |
| [tests/browser/game-audio.test.js](../tests/browser/game-audio.test.js) | Реальные серверные слияние/мина/смерть и воспроизведение WAV в трёх движках. |
| [tests/browser/game-polish.test.js](../tests/browser/game-polish.test.js) | game-polish.test.js |
| [tests/browser/game-smoke.test.cjs](../tests/browser/game-smoke.test.cjs) | game-smoke.test.cjs |
| [tests/browser/gift-showcase.test.js](../tests/browser/gift-showcase.test.js) | gift-showcase.test.js |
| [tests/browser/group-effects.test.js](../tests/browser/group-effects.test.js) | Браузерный сценарий: group effects. |
| [tests/browser/growth-merge.test.js](../tests/browser/growth-merge.test.js) | Браузерный сценарий: growth merge. |
| [tests/browser/helpers/profile-controls.js](../tests/browser/helpers/profile-controls.js) | Общие действия браузерных проверок с профилем. |
| [tests/browser/hook-contact-timeline.test.js](../tests/browser/hook-contact-timeline.test.js) | hook-contact-timeline.test.js |
| [tests/browser/interface-layout-and-styling.test.js](../tests/browser/interface-layout-and-styling.test.js) | Браузерный сценарий: interface layout and styling. |
| [tests/browser/interface-packs.test.js](../tests/browser/interface-packs.test.js) | Isolated in-memory server, never opens player saves. |
| [tests/browser/leaderboards-and-profile.test.js](../tests/browser/leaderboards-and-profile.test.js) | Браузерный сценарий: leaderboards and profile. |
| [tests/browser/league-achievements.test.js](../tests/browser/league-achievements.test.js) | league-achievements.test.js |
| [tests/browser/league-appearance.test.js](../tests/browser/league-appearance.test.js) | league-appearance.test.js |
| [tests/browser/league-theme-access.test.js](../tests/browser/league-theme-access.test.js) | league-theme-access.test.js |
| [tests/browser/lite-account.test.js](../tests/browser/lite-account.test.js) | lite-account.test.js |
| [tests/browser/lite-event-cycle.test.js](../tests/browser/lite-event-cycle.test.js) | lite-event-cycle.test.js |
| [tests/browser/loadout.test.js](../tests/browser/loadout.test.js) | Браузерный сценарий: loadout. |
| [tests/browser/lobby-music.test.js](../tests/browser/lobby-music.test.js) | lobby-music.test.js |
| [tests/browser/lucky-week.test.js](../tests/browser/lucky-week.test.js) | lucky-week.test.js |
| [tests/browser/mass-feeding.test.js](../tests/browser/mass-feeding.test.js) | Браузерный сценарий: mass feeding. |
| [tests/browser/menu-notifications.test.js](../tests/browser/menu-notifications.test.js) | menu-notifications.test.js |
| [tests/browser/mobile-connection.test.cjs](../tests/browser/mobile-connection.test.cjs) | Real browser, server and TCP streams. Delay only one peer's traffic; no mocked WebSocket. |
| [tests/browser/mobile-hud-layout.test.cjs](../tests/browser/mobile-hud-layout.test.cjs) | mobile-hud-layout.test.cjs |
| [tests/browser/mock-payments.test.js](../tests/browser/mock-payments.test.js) | Покупки через LAN HTTP: отмена, начисление, потеря ответа, продление и узкий экран. |
| [tests/browser/personal-cups-arenas.test.js](../tests/browser/personal-cups-arenas.test.js) | personal-cups-arenas.test.js |
| [tests/browser/personal-quests-and-fast-roulette.test.js](../tests/browser/personal-quests-and-fast-roulette.test.js) | personal-quests-and-fast-roulette.test.js |
| [tests/browser/pet-access-clan-reward.test.js](../tests/browser/pet-access-clan-reward.test.js) | pet-access-clan-reward.test.js |
| [tests/browser/pet-motion-cooldowns.test.js](../tests/browser/pet-motion-cooldowns.test.js) | pet-motion-cooldowns.test.js |
| [tests/browser/pet-vitality-ui.test.js](../tests/browser/pet-vitality-ui.test.js) | pet-vitality-ui.test.js |
| [tests/browser/player-chat.test.js](../tests/browser/player-chat.test.js) | player-chat.test.js |
| [tests/browser/progression.test.js](../tests/browser/progression.test.js) | Браузерный сценарий: progression. |
| [tests/browser/projectiles.test.js](../tests/browser/projectiles.test.js) | Браузерный сценарий: projectiles. |
| [tests/browser/promotions.test.js](../tests/browser/promotions.test.js) | promotions.test.js |
| [tests/browser/public-game-link.test.js](../tests/browser/public-game-link.test.js) | Браузерный сценарий: public game link. |
| [tests/browser/responsive-interface.test.js](../tests/browser/responsive-interface.test.js) | Реальная доступность кнопок и окон при изменении размеров и масштаба браузера. |
| [tests/browser/reward-notices-and-ether.test.js](../tests/browser/reward-notices-and-ether.test.js) | reward-notices-and-ether.test.js |
| [tests/browser/roulette-and-notices.test.js](../tests/browser/roulette-and-notices.test.js) | roulette-and-notices.test.js |
| [tests/browser/selected-audio.test.js](../tests/browser/selected-audio.test.js) | Selected CC0 effects: actual UI actions and native media playback, isolated profiles. |
| [tests/browser/shield-timing.test.js](../tests/browser/shield-timing.test.js) | Браузерный сценарий: shield timing. |
| [tests/browser/shop-section-navigation.test.js](../tests/browser/shop-section-navigation.test.js) | Браузерный сценарий: shop section navigation. |
| [tests/browser/showcase-and-daily-bonuses.test.js](../tests/browser/showcase-and-daily-bonuses.test.js) | showcase-and-daily-bonuses.test.js |
| [tests/browser/split-feed-motion.test.js](../tests/browser/split-feed-motion.test.js) | split-feed-motion.test.js |
| [tests/browser/temporary-arena-bots.test.js](../tests/browser/temporary-arena-bots.test.js) | Браузерный сценарий: temporary arena bots. |
| [tests/browser/title-earned-notice.test.js](../tests/browser/title-earned-notice.test.js) | title-earned-notice.test.js |
| [tests/browser/touch-layout.test.js](../tests/browser/touch-layout.test.js) | Браузерный сценарий: touch layout. |
| [tests/browser/treasury-camera-inventory.test.cjs](../tests/browser/treasury-camera-inventory.test.cjs) | Isolated in-memory profiles, no production data or live server restarts. |
| [tests/browser/treasury-frames-expiry.test.cjs](../tests/browser/treasury-frames-expiry.test.cjs) | Isolated server and profiles. Never reads production saves or changes their grants. |
| [tests/browser/vip-avatar-surfaces.test.js](../tests/browser/vip-avatar-surfaces.test.js) | Пять VIP-портретов в наборе, лобби, гардеробе, топах, клане, чужом профиле и Canvas арены. |
| [tests/browser/wardrobe.test.js](../tests/browser/wardrobe.test.js) | Браузерный сценарий: wardrobe. |

## Данные и результаты

| Путь | Назначение |
| --- | --- |
| `server.js` | Точка запуска; npm start |
| `config/test-bots.json` | Включение тестовых ботов |
| `data/profiles.json` | Рабочие профили и кланы |
| `data/backups/` | Резервные копии сохранений и прошлых версий |
| `tests/artifacts/` | Скриншоты и результаты запусков |
| `design/` | Исходные графические наборы, промпты, макеты и черновики |
| `output/` | Готовые документы |
| `node_modules/` | Установленные сторонние библиотеки; версии заданы package-lock.json |

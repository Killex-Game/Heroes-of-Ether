# Арена

Справочник сформирован из текущего кода командой `npm run docs:refresh`.

Источник: [модуль правил](../../src/server/arena/arena-simulation.js).

Стартовая масса — 20, минимальная масса части — 2, разделение доступно от 4. Пробел делит шары, W выбрасывает еду в направлении курсора.

Поглощение проверяется по радиусу и глубине проникновения каждой части. Собственные части соединяются после задержки при такой же глубине; преимущество размера для них не требуется.

| Параметр исходника | Значение |
| --- | --- |
| START_MASS | 20 |
| ABSORB_PERCENT | 80 |
| ABSORB_SIZE_RATIO | 1.15 |
| ABSORB_DEPTH | 0.3333333333333333 |
| INSTANT_BOOSTER_ICON_MS | 1000 |
| SPAWN_PROTECTION_MS | 2000 |
| SPAWN_ATTEMPTS | 48 |
| SPAWN_MARGIN | 160 |
| ETHER_COUNT | 300 |
| ETHER_FIELD_LIMIT | 1224 |
| TICK_MS | 50 |
| MAX_PARTS | 16 |
| MIN_PART_MASS | 2 |
| MIN_SPLIT_MASS | 4 |
| SPLIT_IMPULSE | 20.7 |
| FEED_MASS | 5 |
| FEED_COOLDOWN_MS | 200 |
| FEED_SPEED | 420 |
| FEED_DRAG | 4 |
| FEED_PICKUP_DELAY_MS | 800 |
| FEED_LIFETIME_MS | 60000 |
| FEED_MAX_PARTICLES | 1024 |
| MERGE_DELAY_MS | 30000 |
| OUTSIDE_DIAMETER_FRACTION | 0.4 |
| MASS_DECAY_MS | 2000 |
| INPUT_TIMEOUT_MS | 1500 |
| DEPARTURE_LINGER_MS | 15000 |
| DEPARTURE_FADE_MS | 1000 |
| SPATIAL_CELL_SIZE | 256 |
| SPATIAL_MIN_BODIES | 32 |

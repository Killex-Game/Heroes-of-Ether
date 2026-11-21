# Ресурсы игры

Готовая графика находится в `public/assets`. В `design` сохранены исходные пакеты, промпты и промежуточные варианты.

| Папка | Назначение | Файлов |
| --- | --- | --- |
| [assets/accessories](../public/assets/accessories) | Шапки и бабочки | 99 |
| [assets/accounts](../public/assets/accounts) | Короны VIP/Premium | 3 |
| [assets/achievements](../public/assets/achievements) | Дополнительные значки достижений | 80 |
| [assets/arena](../public/assets/arena) | Фоны арены | 9 |
| [assets/banners](../public/assets/banners) | Баннеры продуктов и событий | 3 |
| [assets/boosters](../public/assets/boosters) | Изображения и каталог бустеров | 48 |
| [assets/clan-crests](../public/assets/clan-crests) | Слои гербов | 133 |
| [assets/clan-roles](../public/assets/clan-roles) | Значки клановых ролей | 4 |
| [assets/fonts](../public/assets/fonts) | Шрифт и лицензия | 3 |
| [assets/food](../public/assets/food) | Еда на арене | 2 |
| [assets/identity](../public/assets/identity) | Значки личного профиля | 2 |
| [assets/menu-icons](../public/assets/menu-icons) | Иконки меню и валют | 26 |
| [assets/progression](../public/assets/progression) | Звания, лиги, медали и сундуки | 155 |
| [assets/shields](../public/assets/shields) | Изображения щитов | 3 |
| [assets/skins](../public/assets/skins) | Скины игроков и каталог исходников | 567 |
| [assets/ui](../public/assets/ui) | Кнопки, рамки, фоны и подготовленные изображения интерфейса | 378 |

Скины подключаются через [player-identity.js](../public/shared/player-identity.js). Поле `original` в [manifest.json](../public/assets/skins/manifest.json) — имя исходника для импорта; рабочий файл назван по `id`.

Иконки прогрессии выбирает [progression-asset-paths.js](../public/shared/progression-asset-paths.js). Размеры 64/128/256 — подготовленные варианты одной иллюстрации.

Названия `f01_round` и `s01_crown` в гербах содержат стабильный ID элемента набора и его описание. Они связаны с сохранёнными параметрами гербов. Каталог геометрии `clan-crest-art-data.js` генерируется скриптом импорта.

Пути изображений внутри CSS считаются от файла CSS; пути из браузерного JavaScript — от страницы. `npm run check:structure` проверяет эти связи.

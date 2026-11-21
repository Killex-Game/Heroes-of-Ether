# Достижения за уровни питомцев

Иконки `pet_level_zaya`, `pet_level_leva`, `pet_level_drakosha`, `pet_level_manya` перерисованы встроенным imagegen 24.10.2026 по просьбе владельца. Существующие портреты проекта `public/assets/pets/*.png` использовались как образцы персонажей и стиля. Прежние требования к аудиту происхождения исходной игровой графики сохраняются. Полные запросы и происхождение результата записаны в `pet-level-imagegen-prompts.json` рядом с этим документом.

Исходные прозрачные персонажи целиком хранятся в `public/assets/achievements/template/sources/`. Сборщик `scripts/artwork/compose-pet-level-achievements.cjs` убирает только прозрачные поля и вписывает весь видимый силуэт в безопасный круг радиуса 77 px. Уши, короны, рога, крылья и лапы не обрезаются. Персонаж размещается на цветной подложке; готовая внутренняя иллюстрация сохраняется в `public/assets/achievements/template/illustrations/`. Затем общий `compose-achievement.cjs` накладывает неизменённый `canonical-gold-frame.png`. Готовые lossless WebP находятся в `public/assets/achievements/illustrated-v2/` и доступны всем интерфейсам через общий каталог.

Для пересборки нужен Node.js и sharp в окружении сборки: `node scripts/artwork/compose-pet-level-achievements.cjs`. Проверять в размерах 48–80 px, включая целиком приглушённое состояние до первой полученной степени.

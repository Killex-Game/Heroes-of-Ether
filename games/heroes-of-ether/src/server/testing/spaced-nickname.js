"use strict";
// Authored bot names only. Never normalize a human player's nickname.
function spacedNickname(value) {
  const shorter = {
    ПельменьЗаУглом: "Пельмень рядом", ПельменьБезПлана: "Пельмень гуляет",
    ПельменьУКамина: "Тёплый пельмень", ТолькоНеВСтены: "Не в стену",
    СохраниМнеМесто: "Оставь мне место", ПиксельБезПлана: "Пиксель гуляет",
    ЗовитеПростоКот: "Просто кот", ВсёПодКонтролем: "Всё схвачено",
  };
  if (Object.hasOwn(shorter, value)) return shorter[value];
  const spaced = value.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{Ll}|\d)(\p{Lu})/gu, "$1 $2");
  if (spaced === value) return value;
  const result = spaced[0].toUpperCase() + spaced.slice(1).toLowerCase();
  return result.replace(/^Где то /u, "Где-то ").replace(/^Чуть чуть /u, "Чуть-чуть ");
}
module.exports = { spacedNickname };

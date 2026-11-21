"use strict";
// Только отображение старых системных наград. Сохранения и квитанции не меняем.
const endings = {
  "": "",
  ы: "",
  а: "а",
  ов: "а",
  у: "у",
  е: "е",
  ом: "ом",
  ами: "ом",
  ам: "у",
  ах: "е",
};
function currencyText(text) {
  return text.replace(
    /(?<![\p{L}\p{N}_])бакс(ами|ам|ах|ов|ом|ы|а|у|е)?(?![\p{L}\p{N}_])/giu,
    (word, end = "") => {
      const value = "эфир" + endings[end.toLowerCase()];
      if (word === word.toUpperCase()) return value.toUpperCase();
      return word[0] === word[0].toUpperCase() ? value[0].toUpperCase() + value.slice(1) : value;
    },
  );
}
module.exports = { currencyText };

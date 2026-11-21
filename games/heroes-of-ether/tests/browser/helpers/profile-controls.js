/* Общие действия браузерных проверок с профилем. */
"use strict";
async function setNickname(page, name) {
  await page.locator("#editProfile").click();
  await page.locator("#profileNickname").fill(name);
  await page
    .locator("#personalDialog")
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  if (await page.locator("#renameConfirmDialog").isVisible())
    await page
      .locator("#renameConfirmDialog")
      .getByRole("button", { name: "Да", exact: true })
      .click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector("#personalDialog .personal-status").textContent ===
        "Личные данные сохранены." &&
      document.getElementById("previewName").textContent === expected,
    name,
  );
  await page.getByRole("button", { name: "Закрыть личные данные", exact: true }).click();
}
async function revealCollectionItem(page, target, root = "#boosterGrid") {
  const nav = page.locator(root + " + .collection-pages");
  if (await target.isVisible()) return;
  const previous = nav.getByRole("button", { name: "Предыдущая страница", exact: true });
  const next = nav.getByRole("button", { name: "Следующая страница", exact: true });
  while (await previous.isEnabled()) await previous.click();
  for (let i = 0; i < 50; i++) {
    if (await target.isVisible()) return;
    if (await next.isDisabled()) break;
    await next.click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  throw Error("Элемент не найден на страницах коллекции: " + root);
}
module.exports = { setNickname, revealCollectionItem };

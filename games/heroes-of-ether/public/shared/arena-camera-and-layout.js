/* Математика камеры, плавного масштаба, радиуса и подписей шаров. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const CAMERA = Object.freeze({
    massStep: 25000,
    maxWorldFraction: 0.9,
    partStep: 0.075,
    maxPartReduction: 0.3,
    compactGroupZoom: 0.3,
    largeGroupZoom: 0.8,
    smallMass: 150,
    normalViewMass: 1000,
    smallZoom: 0.3,
  });
  const minimumScale = (width, height, world) =>
    Math.max(
      width / (world.width * CAMERA.maxWorldFraction),
      height / (world.height * CAMERA.maxWorldFraction),
    );
  function groupFrame(player) {
    const parts = (player.parts?.length ? player.parts : [player]).filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.radius > 0,
    );
    if (!parts.length) return null;
    const mass = parts.reduce((sum, p) => sum + Math.max(0, p.mass || 0), 0);
    // Крошечная отделившаяся часть не растягивает весь кадр. Равные части,
    // включая все 16, участвуют; выбор главного шара на центр не влияет.
    const relevant = parts.filter((p) => (p.mass || 0) >= mass * 0.03);
    const group = relevant.length ? relevant : parts;
    const left = Math.min(...group.map((p) => p.x - p.radius)),
      right = Math.max(...group.map((p) => p.x + p.radius));
    const top = Math.min(...group.map((p) => p.y - p.radius)),
      bottom = Math.max(...group.map((p) => p.y + p.radius));
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
      area: parts.reduce((sum, p) => sum + Math.PI * p.radius * p.radius, 0),
    };
  }
  function desiredScale(player, width, height, world, group = groupFrame(player)) {
    const parts = player.parts?.length ? player.parts : [player];
    const mass = parts.reduce((sum, part) => sum + Math.max(0, Number(part.mass) || 0), 0);
    const minimum = minimumScale(width, height, world);
    const base = Math.max(minimum, clamp(Math.min(width, height) / 650, 0.45, 1.6));
    // 25 000 — масштаб непрерывной кривой, а не ступень переключения.
    // Приближаемся к пределу обзора постепенно: прежний жёсткий clamp
    // переставал реагировать на массу уже около 25 000 на обычном экране.
    const growth = Math.pow(1 + Math.max(0, mass - 10) / CAMERA.massStep, -2);
    // Каждое удвоение числа частей немного расширяет базовый обзор.
    const partsFactor =
      1 - Math.min(CAMERA.maxPartReduction, CAMERA.partStep * Math.log2(parts.length));
    const massScale = minimum + (base - minimum) * growth * partsFactor;
    // Маленький герой виден крупнее. При росте всей группы добавочное
    // приближение плавно исчезает, не меняя обычную кривую отдаления.
    const progress = clamp(
      (mass - CAMERA.smallMass) / (CAMERA.normalViewMass - CAMERA.smallMass),
      0,
      1,
    );
    const smallZoom = 1 + CAMERA.smallZoom * (1 - progress * progress * (3 - 2 * progress));
    const closeScale = massScale * smallZoom;
    if (!group) return closeScale;
    // Оставляем пространство вокруг группы: её габариты и суммарная площадь
    // шаров тоже требуют отдаления, даже при небольшой общей массе.
    // На широком экране вертикальная группа раньше занимала лишь 72% высоты:
    // попытка оставить такой запас чрезмерно открывала карту по бокам.
    // У вытянутой вверх группы используем до 90% высоты. Горизонтальная
    // раскладка, площадь шаров и маленький герой сохраняют прежнюю камеру.
    // Переход непрерывный; масштаб одинаков по обеим осям, без масок обзора.
    const vertical = clamp((group.height / group.width - 1) / 0.5, 0, 1);
    const landscape = clamp((width / height - 1) / 0.5, 0, 1);
    const heightFraction = 0.72 + 0.18 * vertical * vertical * (3 - 2 * vertical) * landscape;
    const fit = Math.min(
      (width * 0.8) / group.width,
      (height * heightFraction) / group.height,
      Math.sqrt((width * height * 0.5) / group.area),
    );
    const crowding = Math.max(1, massScale / fit);
    const scale = minimum + (massScale - minimum) / (crowding * crowding);
    const normalScale = smallZoom > 1 && fit > massScale ? Math.min(closeScale, fit) : scale;
    // Плотная группа не требует дополнительного обзора только из-за числа
    // частей. До +30% приближения для 16 частей, пока габариты позволяют;
    // при разлёте fit плавно возвращает прежнее отдаление. Стартовый зум
    // крошечного героя остаётся прежним. Крупные шары приближаем дополнительно.
    const compactZoom =
      1 + CAMERA.compactGroupZoom * Math.min(1, Math.log2(parts.length) / 4) * progress;
    const largeMassProgress = clamp((mass - 1000) / 39000, 0, 1);
    const nearZoom =
      1 +
      CAMERA.largeGroupZoom * largeMassProgress * largeMassProgress * (3 - 2 * largeMassProgress);
    const compact = Math.max(normalScale, Math.min(normalScale * compactZoom, fit));
    return Math.max(compact, Math.min(compact * nearZoom, fit));
  }
  function followCenter(camera, target, dt, forcedMovement = false) {
    camera.fastFollowMs = forcedMovement
      ? 250
      : Math.max(0, (camera.fastFollowMs || 0) - dt * 1000);
    const fast = camera.fastFollowMs > 0;
    const time = Math.max(0, dt),
      omega = fast ? 28 : 8,
      decay = Math.exp(-omega * time);
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    // Отдельное затухание центра камеры: кормление любой части, смена главной,
    // разделение и слияние не перепрыгивают к новому центру одним кадром.
    let next = {},
      velocity = {};
    for (const axis of ["x", "y"]) {
      const delta = camera[axis] - target[axis],
        v = camera["v" + axis] || 0,
        term = (v + omega * delta) * time;
      next[axis] = target[axis] + (delta + term) * decay;
      velocity[axis] = (v - omega * term) * decay;
    }
    const dx = next.x - camera.x,
      dy = next.y - camera.y,
      distance = Math.hypot(dx, dy);
    const maxStep = fast ? Infinity : (180 * time) / Math.max(0.01, camera.scale),
      ratio = distance > maxStep ? maxStep / distance : 1;
    camera.x += dx * ratio;
    camera.y += dy * ratio;
    camera.vx = velocity.x * ratio;
    camera.vy = velocity.y * ratio;
  }
  function approachScale(current, target, dt, minimum = 0) {
    if (!(current > 0)) return target;
    const logDelta = Math.log(target / current),
      distance = Math.abs(logDelta);
    const speed = target < current ? 0.12 : 0.18,
      easing = 3,
      time = Math.max(0, dt);
    // Далеко от цели — ограниченная скорость; вблизи — мягкое торможение.
    // Решение по времени, а не по кадрам: одинаково на 30, 60 и 144 Гц.
    const easingDistance = speed / easing;
    const cruiseTime = Math.max(0, (distance - easingDistance) / speed);
    const remaining =
      time <= cruiseTime
        ? distance - speed * time
        : Math.min(distance, easingDistance) * Math.exp(-easing * (time - cruiseTime));
    const next = current * Math.exp(Math.sign(logDelta) * (distance - remaining));
    return Math.max(minimum, remaining < 1e-9 ? target : next);
  }
  function animateRadius(displayed, target, dt) {
    if (!(target > 0) || !Number.isFinite(target)) return;
    if (!(displayed.radius > 0)) {
      displayed.radius = target;
      displayed.radiusVelocity = 0;
      return;
    }
    // Критическое затухание: короткий плавный рост без пружинного переразмера.
    // Скорость сохраняется между серверными пакетами, чтобы еда не перезапускала
    // анимацию каждые 50 мс. Меняем только рисунок; физика и масса остаются серверными.
    const omega = 18,
      time = Math.max(0, dt),
      delta = displayed.radius - target;
    const velocity = displayed.radiusVelocity || 0;
    const decay = Math.exp(-omega * time),
      term = (velocity + omega * delta) * time;
    const next = target + (delta + term) * decay;
    displayed.radius = clamp(
      next,
      Math.min(displayed.radius, target),
      Math.max(displayed.radius, target),
    );
    displayed.radiusVelocity = (velocity - omega * term) * decay;
    if (
      displayed.radius !== next ||
      (Math.abs(target - next) < 0.01 && Math.abs(displayed.radiusVelocity) < 0.1)
    ) {
      if (displayed.radius === next) displayed.radius = target;
      displayed.radiusVelocity = 0;
    }
  }
  function updateZoom(camera, target, dt, minimum = 0) {
    const previous = camera.zoomTarget > 0 ? camera.zoomTarget : camera.scale;
    // Сначала плавно меняется сама цель: начисление большого бустера не
    // включает максимальную скорость отдаления одним кадром.
    camera.zoomTarget = Math.exp(
      Math.log(target) + (Math.log(previous) - Math.log(target)) * Math.exp(-5 * Math.max(0, dt)),
    );
    camera.scale = approachScale(camera.scale, camera.zoomTarget, dt, minimum);
  }
  function nameSize(radius, scale) {
    return clamp(2 * Math.sqrt(Math.max(0, radius * scale)), 6, 26);
  }
  function nameLayout(name, medal, radius, scale, measure, availableWidth = Infinity) {
    const budget = Math.max(12, Math.min(radius * scale * 2.15, availableWidth));
    let size = nameSize(radius, scale);
    const badge = (s) => (medal ? s * 1.8 + 3 : 0);
    size = Math.max(6, size * Math.min(1, budget / (measure(name, size) + badge(size))));
    const badgeWidth = badge(size),
      textWidth = Math.max(1, Math.min(measure(name, size), budget - badgeWidth));
    return {
      size,
      textWidth,
      textOffset: badgeWidth / 2,
      badgeRadius: size * 0.9,
      badgeOffset: -(textWidth + 3) / 2,
    };
  }
  return {
    desiredScale,
    groupFrame,
    followCenter,
    approachScale,
    animateRadius,
    updateZoom,
    nameSize,
    nameLayout,
    minimumScale,
  };
});

/* Математика камеры, плавного масштаба, радиуса и подписей шаров. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const CAMERA = Object.freeze({
    viewExpansion: 1.05,
    extraViewExpansion: 1.05 * 1.2567,
    massStep: 25000,
    maxWorldFraction: 0.9,
    partStep: 0.075,
    maxPartReduction: 0.3,
    compactGroupZoom: 0.3,
    largeGroupZoom: 1.1,
    smallMass: 150,
    normalViewMass: 1000,
    smallZoom: 0.3,
  });
  const minimumScale = (width, height, world) =>
    Math.max(
      width / (world.width * CAMERA.maxWorldFraction),
      height / (world.height * CAMERA.maxWorldFraction),
    );
  // Reserve space around the group before a split, up to the map view limit.
  const expandedScale = (scale, minimum) => Math.max(minimum,
    (minimum + (scale - minimum) / CAMERA.viewExpansion) / CAMERA.extraViewExpansion);
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
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    let youngestSplitMs = Infinity;
    for (const p of group) {
      left = Math.min(left, p.x - p.radius);
      right = Math.max(right, p.x + p.radius);
      top = Math.min(top, p.y - p.radius);
      bottom = Math.max(bottom, p.y + p.radius);
      if (p.birth?.parentId && p.launchAge >= 0) youngestSplitMs = Math.min(youngestSplitMs, p.launchAge);
    }
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      launching: youngestSplitMs < 650,
      youngestSplitMs,
      count: group.length,
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
    if (!group) return expandedScale(closeScale, minimum);
    // Оставляем пространство вокруг группы: её габариты и суммарная площадь
    // шаров тоже требуют отдаления, даже при небольшой общей массе.
    // На широком экране вертикальная группа раньше занимала лишь 72% высоты:
    // попытка оставить такой запас чрезмерно открывала карту по бокам.
    // У вытянутой вверх группы используем до 90% высоты. Горизонтальная
    // раскладка, площадь шаров и маленький герой сохраняют прежнюю камеру.
    // Переход непрерывный; масштаб одинаков по обеим осям, без масок обзора.
    const vertical = clamp((group.height / group.width - 1) / 0.5, 0, 1);
    const landscape = clamp((width / height - 1) / 0.5, 0, 1);
    // Large, roughly square groups used only 72% of the screen height,
    // needlessly making every part and nearby object smaller. Use up to 84%
    // for these groups, retaining the 90% bound for tall landscape groups.
    const largeMassProgress = clamp((mass - 1000) / 39000, 0, 1);
    const largeEase = largeMassProgress * largeMassProgress * (3 - 2 * largeMassProgress);
    const compactHeight = 0.72 + 0.12 * largeEase;
    const heightFraction = compactHeight + (0.9 - compactHeight) * vertical * vertical * (3 - 2 * vertical) * landscape;
    const fit = Math.min(
      (width * 0.8) / group.width,
      (height * heightFraction) / group.height,
      Math.sqrt((width * height * (0.5 + 0.08 * largeEase)) / group.area),
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
    const nearZoom =
      1 + CAMERA.largeGroupZoom * largeEase;
    const compact = Math.max(normalScale, Math.min(normalScale * compactZoom, fit));
    return expandedScale(Math.max(compact, Math.min(compact * nearZoom, fit)), minimum);
  }
  function followCenter(camera, target, dt, forcedMovement = false, parts = [], height = 0, bottomInset = 0) {
    // Track real displacement of surviving parts, not changes to the group's
    // bounding box after a split, feeding or losing a part. At most 16 entries.
    const previous = camera.followParts || new Map(), current = new Map();
    const speeds = [];
    for (const part of parts) {
      if (!part.id || !Number.isFinite(part.x) || !Number.isFinite(part.y)) continue;
      const old = previous.get(part.id);
      if (old && dt > 0) speeds.push(Math.hypot(part.x - old.x, part.y - old.y) / dt);
      current.set(part.id, { x: part.x, y: part.y });
    }
    camera.followParts = current;
    speeds.sort((a, b) => a - b);
    const motion = speeds.length ? speeds[Math.floor((speeds.length - 1) / 2)] : 0;
    const screenSpeed = motion * Math.max(0.01, camera.scale);

    camera.fastFollowMs = forcedMovement
      ? 250
      : Math.max(0, (camera.fastFollowMs || 0) - dt * 1000);
    const forced = camera.fastFollowMs > 0;
    const fast = forced || target?.launching;
    const time = Math.max(0, dt),
      omega = forced ? 28 : target?.launching ? 18 : 8 + 16 * clamp(screenSpeed / 500, 0, 1),
      decay = Math.exp(-omega * time);
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    // Move the focus toward the centre of the playable space as the group
    // approaches the booster bar. Small groups keep the usual aim point.
    let focusY = target.y;
    if (target.count > 1 && (target.launching || camera.framingSplit) && bottomInset > 0 && height > 0) {
      const availableBelow = Math.max(0, height / 2 - bottomInset - 8);
      const offset = clamp(target.height * camera.scale / 2 - availableBelow * 0.78, 0, bottomInset / 4);
      focusY += offset / camera.scale;
    }
    // Отдельное затухание центра камеры: кормление любой части, смена главной,
    // разделение и слияние не перепрыгивают к новому центру одним кадром.
    let next = {},
      velocity = {};
    for (const axis of ["x", "y"]) {
      const focus = axis === "y" ? focusY : target.x;
      const delta = camera[axis] - focus,
        v = camera["v" + axis] || 0,
        term = (v + omega * delta) * time;
      next[axis] = focus + (delta + term) * decay;
      velocity[axis] = (v - omega * term) * decay;
    }
    const dx = next.x - camera.x,
      dy = next.y - camera.y,
      distance = Math.hypot(dx, dy);
    const maxStep = fast ? Infinity : ((420 + screenSpeed * 1.25) * time) / Math.max(0.01, camera.scale),
      ratio = distance > maxStep ? maxStep / distance : 1;
    camera.x += dx * ratio;
    camera.y += dy * ratio;
    camera.vx = velocity.x * ratio;
    camera.vy = velocity.y * ratio;
  }
  function dizzyStrength(remainingMs, reducedMotion = false, state) {
    if (reducedMotion || !(remainingMs > 0)) {
      if (state) state.dizzyRemaining = 0;
      return 0;
    }
    let duration = 5000;
    if (state) {
      if (!(state.dizzyRemaining > 0) || remainingMs > state.dizzyRemaining + 150) {
        state.dizzyDuration = remainingMs;
      }
      duration = state.dizzyDuration;
      state.dizzyRemaining = remainingMs;
    }
    return clamp(Math.min((duration - remainingMs) / 180, remainingMs / 350), 0, 1);
  }
  function dizzyOffset(seed, now, strength = 1) {
    const t = now / 1000, s = Number(seed) || 1, amount = clamp(strength,0,1);
    return {
      x: (Math.sin(t*3.7+s*1.13)*19 + Math.sin(t*8.3+s*.71)*9)*amount,
      y: (Math.sin(t*4.9+s*1.79)*17 + Math.cos(t*7.1+s*.43)*9)*amount,
      angle: (Math.sin(t*3.1+s)*.11 + Math.cos(t*6.7+s*.3)*.05)*amount,
    };
  }
  function screenToWorld(x, y, camera, width, height) {
    const dx = x-width/2, dy = y-height/2, angle = camera.rotation || 0;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return {x:camera.x+(dx*cos+dy*sin)/camera.scale,y:camera.y+(-dx*sin+dy*cos)/camera.scale};
  }
  function movementTarget(player, pointer, camera, width, height, world) {
    const edge = Math.min(96, Math.min(width, height) * 0.12);
    const directional = pointer.x <= edge || pointer.x >= width - edge ||
      pointer.y <= edge || pointer.y >= height - edge;
    let x, y;
    if (directional) {
      // The screen edge is an intent to travel, not a wall or a destination.
      // Anchor the ray at the player so crossing the cursor cannot reverse it.
      const target = screenToWorld(pointer.x, pointer.y, camera, width, height);
      const dx = target.x - camera.x, dy = target.y - camera.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length, ny = dy / length;
      const reach = Math.max(0, Math.min(
        nx > 0 ? (world.width - player.x) / nx : nx < 0 ? -player.x / nx : Infinity,
        ny > 0 ? (world.height - player.y) / ny : ny < 0 ? -player.y / ny : Infinity,
      ));
      x = player.x + nx * reach;
      y = player.y + ny * reach;
    } else {
      ({x, y} = screenToWorld(pointer.x, pointer.y, camera, width, height));
    }
    return { x: clamp(x, 0, world.width), y: clamp(y, 0, world.height),
      keepDirection: directional };
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
  function updateZoom(camera, target, dt, minimum = 0, group, width, height, bottomInset = 0) {
    // Keep the wider view between consecutive launches. Recover smoothly once the parts settle.
    if (group?.launching) {
      camera.framingSplit = true;
      camera.splitHold = 0.45;
    } else {
      camera.splitHold = Math.max(0, (camera.splitHold || 0) - Math.max(0, dt));
    }
    if (!group || group.count < 2) {
      camera.framingSplit = false;
      camera.splitHold = 0;
    }
    let previous = camera.zoomTarget > 0 ? camera.zoomTarget : camera.scale;
    if (camera.splitHold > 0) {
      target = Math.min(target, camera.scale);
      previous = Math.min(previous, camera.scale);
    }
    // Сначала плавно меняется сама цель: начисление большого бустера не
    // включает максимальную скорость отдаления одним кадром.
    camera.zoomTarget = Math.exp(
      Math.log(target) + (Math.log(previous) - Math.log(target)) * Math.exp(-5 * Math.max(0, dt)),
    );
    camera.scale = approachScale(camera.scale, camera.zoomTarget, dt, minimum);
    // Follow the interpolated outer circles through a manual split. Keep room for
    // the HUD even when the camera centre is still catching up. Zoom back normally.
    if (camera.framingSplit && width > 0 && height > 0) {
      const dx = group.x - camera.x, dy = group.y - camera.y;
      const edgeLimit = Math.max(minimum, Math.min(
        width * 0.47 / (group.width / 2 + Math.abs(dx)),
        height * 0.47 / Math.max(1, group.height / 2 - dy),
        Math.max(1, height / 2 - bottomInset - 8) / Math.max(1, group.height / 2 + dy),
      ));
      const lead = group.youngestSplitMs < 350 ? 1 - group.youngestSplitMs / 350 : 0;
      const preferred = Math.max(minimum, edgeLimit * (0.9 - 0.24 * lead));
      if (camera.scale > preferred) {
        const blend = -Math.expm1(-3.5 * Math.max(0, dt));
        // Keep extra room before launch, then limit how fast the split can zoom out.
        // The hard bound below still protects both ends of the group and the booster bar.
        const logStep = Math.max(-0.4 * Math.max(0, dt), blend * Math.log(preferred / camera.scale));
        camera.scale *= Math.exp(logStep);
      }
      camera.scale = Math.min(camera.scale, edgeLimit);
      camera.zoomTarget = Math.min(camera.zoomTarget, edgeLimit);
    }
  }
  function nameSize(radius, scale) {
    return clamp(2 * Math.sqrt(Math.max(0, radius * scale)), 6, 26);
  }
  function nameLayout(name, medal, radius, scale, measure, availableWidth = Infinity) {
    const budget = Math.max(1, Math.min(radius * scale * 1.8, availableWidth));
    const preferred = nameSize(radius, scale);
    const size = preferred * Math.min(1, budget / Math.max(1, measure(name, preferred) + (medal ? preferred * 2 : 0)));
    const gap = medal ? size * 0.2 : 0;
    const badgeWidth = medal ? size * 1.8 + gap : 0;
    const textWidth = Math.max(0.1, Math.min(measure(name, size), budget - badgeWidth));
    return {
      size,
      textWidth,
      textOffset: badgeWidth / 2,
      badgeRadius: medal ? size * 0.9 : 0,
      badgeOffset: -(textWidth + gap) / 2,
    };
  }

  return {
    dizzyStrength,
    // A cached client may still call the previous camera API during an update.
    dizzyRotation(remainingMs, reducedMotion, state) {
      dizzyStrength(remainingMs, reducedMotion, state);
      return 0;
    },
    dizzyOffset,
    screenToWorld,
    desiredScale,
    groupFrame,
    movementTarget,
    followCenter,
    approachScale,
    animateRadius,
    updateZoom,
    nameSize,
    nameLayout,
    minimumScale,
  };
});

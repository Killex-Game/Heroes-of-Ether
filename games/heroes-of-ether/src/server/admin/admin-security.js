"use strict";
const fs = require("node:fs"), path = require("node:path");
const { randomBytes, randomUUID, scrypt } = require("node:crypto");
const derive = require("node:util").promisify(scrypt);
const { BoosterError } = require("../boosters/booster-catalog");
const otp = require("./admin-otp");
const COOKIE = require("../../../public/shared/platform-contract").ownerCookie, CHALLENGE = COOKIE + "_challenge";
const PASSWORD_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const passwordHash = async (password, salt) => (await derive(password, salt, 64, PASSWORD_OPTIONS)).toString("hex");
const cookie = (req, name) => (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith(name + "="))?.slice(name.length + 1) || "";
const passwordValid = p => typeof p === "string" && p.length >= 12 && p.length <= 128;
const deny = (text, status = 403) => { throw new BoosterError(text, status); };
function identity(input, state, id) {
  const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(login) || login === "owner" || state.moderators.some(m => m.login === login && m.id !== id))
    deny("Логин занят или некорректен: 3–32 латинские буквы, цифры, точка, дефис, подчёркивание.", 400);
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 64 || /[\u0000-\u001f\u007f]/.test(input.name))
    deny("Укажи имя модератора до 64 символов без переносов строк.", 400);
  return { login, name: input.name.trim() };
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + ".tmp", fd = fs.openSync(temp, "w", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== "win32") { const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
class AdminSecurity {
  constructor(access) {
    this.access = access; this.now = access.now;
    this.file = access.filePath ? access.filePath + ".security.json" : null;
    this.challenges = new Map(); this.sessions = new Map(); this.enrollments = new Map(); this.failures = new Map();
  }
  load() {
    if (this.state) return this.state;
    // Lazy loading keeps a damaged optional admin store from stopping the game.
    try {
      const state = this.file && fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) :
        { version: 1, ownerId: this.access.ownerId, owner: { version: 0, factor: null }, moderators: [], audit: [], receipts: {} };
      const factor = f => f === null || (f && /^[a-f0-9]{24}$/.test(f.secret?.iv) && /^[a-f0-9]{64}$/.test(f.secret?.data) && /^[a-f0-9]{32}$/.test(f.secret?.tag) && Number.isSafeInteger(f.lastCounter) && f.lastCounter >= -1 && Array.isArray(f.recovery) && f.recovery.length <= 10 && f.recovery.every(x => /^[a-f0-9]{64}$/.test(x)));
      if (state.version !== 1 || state.ownerId !== this.access.ownerId || !Number.isSafeInteger(state.owner?.version) || !factor(state.owner.factor) || !Array.isArray(state.moderators) || state.moderators.length > 100 || !Array.isArray(state.audit) || !state.receipts ||
        state.moderators.some(m => !/^moderator:[a-f0-9-]{36}$/.test(m.id) || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(m.login) || m.login === "owner" || typeof m.enabled !== "boolean" || !Number.isSafeInteger(m.version) || !/^[a-f0-9]{128}$/.test(m.passwordHash) || !/^[a-f0-9]{32}$/.test(m.salt) || !factor(m.factor)) || new Set(state.moderators.map(m => m.login)).size !== state.moderators.length) throw Error("Invalid admin store");
      this.state = state; return state;
    } catch (_) { deny("Хранилище доступа админки недоступно. Проверь серверную копию; данные не сброшены.", 503); }
  }
  key() {
    if (this.masterKey) return this.masterKey;
    if (!this.file) return this.masterKey = randomBytes(32);
    const folder = fs.realpathSync(path.dirname(this.file));
    this.keyFile = this.access.keyPath || path.join(folder, "..", "secrets", "admin-totp.key");
    if (!fs.existsSync(this.keyFile)) {
      if (this.load().owner.factor || this.load().moderators.some(m => m.factor)) deny("Отсутствует ключ шифрования 2FA. Восстанови его из защищённой копии.", 503);
      fs.mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 });
      const fd = fs.openSync(this.keyFile, "wx", 0o600);
      try { fs.writeFileSync(fd, randomBytes(32)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const key = fs.readFileSync(this.keyFile);
    if (key.length !== 32) deny("Неверный ключ шифрования 2FA.", 503);
    return this.masterKey = key;
  }
  save(next) { if (this.file) atomic(this.file, next); this.state = next; }
  event(next, actor, action, target, reason = "") {
    next.audit.push({ id: randomUUID(), at: this.now(), actorId: actor.id, actorName: actor.login || "owner", targetId: target.id, targetName: target.login || "owner", action, label: action, reason });
  }
  ownerEnabled() { return !!this.load().owner.factor; }
  ownerVersion() { return this.load().owner.version; }
  ownerValid(session) { return (session.factorVersion || 0) === this.ownerVersion(); }
  account(id, state = this.load()) { return id === this.access.ownerId ? state.owner : state.moderators.find(m => m.id === id); }
  failureKey(login, req) { return login + ":" + (req.socket?.remoteAddress || ""); }
  checkLimit(key, maximum = 5) {
    const rows = (this.failures.get(key) || []).filter(t => t > this.now() - 15 * 60000);
    this.failures.set(key, rows); if (this.failures.size > 4096) this.failures.delete(this.failures.keys().next().value);
    if (rows.length >= maximum) deny("Слишком много попыток. Повтори через 15 минут.", 429);
  }
  failed(key) { const rows = this.failures.get(key) || []; rows.push(this.now()); this.failures.set(key, rows); }
  attemptLimits(login, req) { this.checkLimit(this.failureKey(login, req)); this.checkLimit("account:" + login); this.checkLimit("ip:" + (req.socket?.remoteAddress || ""), 20); }
  failedAttempt(login, req) { for (const key of [this.failureKey(login, req), "account:" + login, "ip:" + (req.socket?.remoteAddress || "")]) this.failed(key); }
  challenge(actor, req, res) {
    const secure = this.access.guardTransport(req), token = randomBytes(32).toString("hex");
    for (const [key, c] of this.challenges) if (c.id === actor.id || c.until <= this.now()) this.challenges.delete(key);
    if (this.challenges.size >= 100) deny("Слишком много попыток входа. Повтори позже.", 429);
    const account = this.account(actor.id), enrollment = !account.factor;
    const challenge = { id: actor.id, login: actor.login, role: actor.role, version: account.version, csrf: randomBytes(32).toString("hex"), until: this.now() + 300000, attempts: 0, enrollment, ...(enrollment ? { secret: otp.newSecret() } : {}) };
    this.challenges.set(otp.digest(token), challenge);
    res.setHeader("Set-Cookie", `${CHALLENGE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=300${secure ? "; Secure" : ""}`);
    return { authenticated: false, requires2fa: true, enrollmentRequired: enrollment, csrf: challenge.csrf, login: actor.login, passwordChangeRequired: enrollment || !!account.mustChangePassword, ...(enrollment ? { secret: challenge.secret, uri: otp.uri(challenge.secret, actor.login + " (" + req.headers.host + ")") } : {}) };
  }
  async login(input, req, res) {
    this.access.guardTransport(req);
    const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(login) || !passwordValid(input.password)) deny("Неверный логин или пароль.");
    if (login === "owner") return this.access.login(input, req, res, { id: this.access.ownerId });
    this.attemptLimits(login, req);
    if (this.busy) deny("Проверка уже выполняется. Повтори немного позже.", 429);
    this.busy = true;
    try {
      const state = this.load(), m = state.moderators.find(m => m.login === login);
      const hash = await passwordHash(input.password, m?.salt || "0123456789abcdef0123456789abcdef");
      if (state !== this.load() || !m?.enabled || !otp.equal(hash, m.passwordHash)) { this.failedAttempt(login, req); deny("Неверный логин или пароль."); }
      return this.challenge({ id: m.id, login, role: "moderator" }, req, res);
    } finally { this.busy = false; }
  }
  factorPatch(id, factor, value) {
    if (!factor) deny("Сначала подключи двухфакторную защиту.");
    const backup = otp.recoveryHash(id, value), index = factor.recovery.findIndex(h => otp.equal(h, backup));
    if (typeof value === "string" && /^[a-f0-9\s-]{24,40}$/i.test(value) && index >= 0)
      return { ...factor, recovery: factor.recovery.filter((_, n) => n !== index) };
    let secret;
    try { secret = otp.decrypt(factor.secret, this.key(), this.access.ownerId + ":" + id); } catch (_) { deny("Не удалось прочитать ключ 2FA. Проверь защищённую серверную копию.", 503); }
    const counter = otp.verify(secret, value, this.now(), factor.lastCounter);
    if (counter === null) deny("Код неверен, истёк или уже использован. Введи новый код.");
    return { ...factor, lastCounter: counter };
  }
  newFactor(id, secret, counter, codes) { return { secret: otp.encrypt(secret, this.key(), this.access.ownerId + ":" + id), lastCounter: counter, recovery: codes.map(c => otp.recoveryHash(id, c)) }; }
  async verify(input, req, res) {
    this.access.guardTransport(req);
    const key = otp.digest(cookie(req, CHALLENGE)), c = this.challenges.get(key);
    if (!c || c.until <= this.now()) deny("Время входа истекло. Введи логин и пароль заново.", 401);
    if (!otp.equal(req.headers["x-owner-csrf"], c.csrf)) deny("Проверка запроса не пройдена.");
    const limit = this.failureKey(c.login, req); this.attemptLimits(c.login, req);
    const account = this.account(c.id);
    if (!account || account.version !== c.version || (c.role === "moderator" && !account.enabled)) { this.challenges.delete(key); deny("Доступ изменён. Войди заново.", 401); }
    if (this.busy) deny("Проверка уже выполняется.", 429); this.busy = true;
    try {
      const state = this.load(), next = structuredClone(state), target = this.account(c.id, next); let codes;
      try {
        if (c.enrollment) {
          const step = otp.verify(c.secret, input.code, this.now());
          if (step === null) deny("Код неверен или истёк.");
          if (!passwordValid(input.newPassword)) deny("Задай свой пароль из 12–128 символов.", 400);
          const salt = randomBytes(16).toString("hex"), hash = await passwordHash(input.newPassword, salt);
          if (state !== this.load()) deny("Доступ изменён. Войди заново.", 409);
          codes = otp.recovery(); target.factor = this.newFactor(c.id, c.secret, step, codes);
          target.passwordHash = hash; target.salt = salt; target.version++;
          this.event(next, c, "Подключение 2FA", c);
        } else {
          target.factor = this.factorPatch(c.id, target.factor, input.code);
          if (target.mustChangePassword) {
            if (!passwordValid(input.newPassword)) deny("Задай свой пароль из 12–128 символов.", 400);
            target.salt = randomBytes(16).toString("hex"); target.passwordHash = await passwordHash(input.newPassword, target.salt);
            if (state !== this.load()) deny("Доступ изменён. Войди заново.", 409);
            target.version++;
          }
        }
        target.mustChangePassword = false;
      } catch (e) { if (e.status === 403) { this.failedAttempt(c.login, req); if (++c.attempts >= 5) this.challenges.delete(key); } throw e; }
      this.event(next, c, "Вход в админку", c); this.save(next); this.challenges.delete(key); this.failures.delete(limit);
      const status = c.role === "owner" ? this.access.issueSession(req, res) : this.issueSession(c, req, res);
      return { ...status, ...(codes ? { recoveryCodes: codes } : {}) };
    } finally { this.busy = false; }
  }
  issueSession(actor, req, res) {
    const token = randomBytes(32).toString("hex"), account = this.account(actor.id);
    this.sessions.set(actor.id, { id: actor.id, role: "moderator", login: actor.login, tokenHash: otp.digest(token), csrf: randomBytes(32).toString("hex"), until: this.now() + 900000, absolute: this.now() + 3600000, version: account.version });
    const secure = this.access.guardTransport(req);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=3600${secure ? "; Secure" : ""}`);
    return this.access.status({ headers: { cookie: `${COOKIE}=${token}` } });
  }
  session(req) {
    const hash = otp.digest(cookie(req, COOKIE));
    for (const s of this.sessions.values()) if (otp.equal(hash, s.tokenHash)) {
      const m = this.account(s.id); if (m?.enabled && m.factor && m.version === s.version && s.until > this.now() && s.absolute > this.now()) return s;
      this.sessions.delete(s.id); break;
    }
    return null;
  }
  moderator(actor) { return !!actor && actor.role === "moderator" && this.load().moderators.some(m => m.id === actor.id && m.enabled && m.factor && m.version === actor.version); }
  view(req) {
    const actor = this.access.principal(req); if (!actor) deny("Войди в админку.", 401);
    const account = this.account(actor.id);
    return { login: actor.login, name: actor.role === "owner" ? "Killex" : account.name, version: account.version, role: actor.role, twoFactorEnabled: !!account.factor, recoveryCodesRemaining: account.factor?.recovery.length || 0 };
  }
  async editSelf(input, req, res) {
    if (this.busy) deny("Изменение уже выполняется.", 429);
    this.busy = true;
    try {
      this.access.guardTransport(req); this.access.authorize(req);
      const actor = this.access.principal(req), session = this.session(req), state = this.load();
      if (actor?.role !== "moderator" || !session) deny("Доступно только модератору.");
      const current = this.account(actor.id, state), fields = identity(input, state, actor.id);
      if (input.version !== current.version) deny("Профиль изменился. Открой форму заново.", 409);
      if (!passwordValid(input.password) || (input.newPassword && !passwordValid(input.newPassword))) deny("Пароль должен содержать от 12 до 128 символов.", 400);
      const key = this.failureKey("profile:" + actor.id, req); this.checkLimit(key);
      const hash = await passwordHash(input.password, current.salt);
      if (state !== this.load() || session !== this.session(req)) deny("Сеанс изменился. Войди заново.", 401);
      if (!otp.equal(hash, current.passwordHash)) { this.failed(key); deny("Неверный текущий пароль."); }
      const next = structuredClone(state), target = this.account(actor.id, next);
      try { target.factor = this.factorPatch(actor.id, target.factor, input.code); }
      catch (e) { if (e.status === 403) this.failed(key); throw e; }
      Object.assign(target, fields);
      if (input.newPassword) {
        target.salt = randomBytes(16).toString("hex"); target.passwordHash = await passwordHash(input.newPassword, target.salt);
      }
      if (state !== this.load() || session !== this.session(req)) deny("Сеанс изменился. Войди заново.", 401);
      target.version++;
      this.event(next, actor, "Изменение своего профиля модератора", target);
      Object.assign(next.audit.at(-1), { before: { login: current.login, name: current.name }, after: fields, passwordChanged: !!input.newPassword });
      this.save(next); this.failures.delete(key); this.sessions.delete(actor.id);
      return { ...this.issueSession({ ...actor, login: target.login }, req, res), name: target.name };
    } finally { this.busy = false; }
  }
  async ownerProof(input, req, requireFactor = true) {
    const actor = this.access.principal(req); if (actor?.role !== "owner") deny("Доступно только владельцу.");
    const key = this.failureKey("owner-proof", req); this.checkLimit(key);
    await this.access.confirmPassword(input.password, req, { id: this.access.ownerId });
    const next = structuredClone(this.load());
    if (requireFactor || next.owner.factor) {
      try { next.owner.factor = this.factorPatch(this.access.ownerId, next.owner.factor, input.code); }
      catch (e) { if (e.status === 403) this.failed(key); throw e; }
      this.failures.delete(key);
    }
    return next;
  }
  async ownerOperation(action, input, req, res) {
    if (this.busy) deny("Проверка уже выполняется.", 429); this.busy = true;
    try {
      const actor = this.access.principal(req);
      if (actor?.role !== "owner") deny("Доступно только владельцу.");
      const session = this.access.session;
      if (action === "enroll-confirm") {
        const pending = this.enrollments.get(session.tokenHash);
        if (!pending || pending.until <= this.now() || pending.id !== input.enrollmentId) deny("Начни настройку 2FA заново.", 409);
        const key = this.failureKey("owner-enrollment", req); this.checkLimit(key);
        const counter = otp.verify(pending.secret, input.code, this.now());
        if (counter === null) { this.failed(key); deny("Код неверен или истёк."); }
        const next = structuredClone(this.load()), codes = otp.recovery();
        next.owner.factor = this.newFactor(actor.id, pending.secret, counter, codes); next.owner.version++;
        this.event(next, actor, "Подключение 2FA владельца", actor); this.save(next); this.enrollments.delete(session.tokenHash);
        return { ...this.access.issueSession(req, res), recoveryCodes: codes };
      }
      const next = await this.ownerProof(input, req, action !== "enroll-begin");
      if (action === "enroll-begin") {
        const secret = otp.newSecret(), id = randomBytes(24).toString("hex");
        this.key(); if (next.owner.factor) this.save(next);
        this.enrollments.clear(); this.enrollments.set(session.tokenHash, { secret, id, until: this.now() + 600000 });
        return { secret, uri: otp.uri(secret, "owner (" + req.headers.host + ")"), enrollmentId: id };
      }
      if (action === "recovery-codes") {
        const codes = otp.recovery(); next.owner.factor.recovery = codes.map(c => otp.recoveryHash(actor.id, c));
        this.event(next, actor, "Обновление резервных кодов", actor); this.save(next); return { recoveryCodes: codes };
      }
      deny("Неизвестная операция.", 404);
    } finally { this.busy = false; }
  }
  list() { return this.load().moderators.map(({ id, login, name, version, enabled, factor, createdAt }) => ({ id, login, name, version, enabled, twoFactorEnabled: !!factor, createdAt })); }
  async manage(input, req) {
    if (this.busy) deny("Изменение уже выполняется.", 429); this.busy = true;
    try {
      if (!['create','edit','disable','enable','reset-password','reset-factor'].includes(input.action) || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 500) deny("Выбери действие и укажи причину.", 400);
      const session = this.access.session;
      const next = await this.ownerProof(input, req), actor = this.access.principal(req), state = this.load();
      let target, temporaryPassword, before;
      if (input.action === "create") {
        const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "";
        if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(login) || login === "owner" || next.moderators.some(m => m.login === login)) deny("Логин занят или некорректен: 3–32 латинские буквы, цифры, точка, дефис, подчёркивание.", 400);
        if (next.moderators.length >= 100) deny("Достигнут предел учётных записей.", 409);
        if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 64) deny("Укажи имя модератора до 64 символов.", 400);
        target = { id: "moderator:" + randomUUID(), login, name: input.name.trim(), enabled: true, version: 0, factor: null, createdAt: this.now() }; next.moderators.push(target);
      } else {
        target = next.moderators.find(m => m.id === input.id); if (!target) deny("Модератор не найден.", 404);
      }
      if (input.action === "edit") {
        if (input.version !== target.version) deny("Профиль изменился. Обнови список модераторов.", 409);
        before = { login: target.login, name: target.name };
        Object.assign(target, identity(input, next, target.id));
      }
      if (["create", "reset-password", "reset-factor"].includes(input.action)) {
        temporaryPassword = randomBytes(18).toString("base64url"); target.salt = randomBytes(16).toString("hex"); target.passwordHash = await passwordHash(temporaryPassword, target.salt); target.mustChangePassword = true;
      }
      if (input.action === "disable") target.enabled = false;
      if (input.action === "enable") target.enabled = true;
      if (input.action === "reset-factor") target.factor = null;
      target.version++;
      if (session !== this.access.session || !this.access.ownerAuthenticated(req)) deny("Сеанс завершён.", 401);
      if (state !== this.load()) deny("Доступ изменён. Повтори операцию.", 409);
      this.event(next, actor, {create:"Создание модератора",edit:"Редактирование модератора",disable:"Отключение модератора",enable:"Включение модератора","reset-password":"Сброс пароля модератора","reset-factor":"Сброс 2FA модератора"}[input.action], target, input.reason.trim());
      if (before) Object.assign(next.audit.at(-1), { before, after: { login: target.login, name: target.name } });
      this.save(next); this.sessions.delete(target.id);
      return { moderators: this.list(), ...(temporaryPassword ? { temporaryPassword, login: target.login } : {}) };
    } finally { this.busy = false; }
  }
  audit() { return this.load().audit; }
}
module.exports = { AdminSecurity, passwordHash };

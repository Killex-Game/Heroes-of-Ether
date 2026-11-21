"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { randomBytes, createHash, timingSafeEqual, scrypt } = require("node:crypto");
const { promisify } = require("node:util");
const { BoosterError } = require("../boosters/booster-catalog");
const derive = promisify(scrypt),
  digest = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const loopback = (address) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
const { ownerCookie: COOKIE } = require("../../../public/shared/platform-contract");
const cookie = (req) =>
  (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}
class OwnerAccess {
  constructor({
    ownerId = null,
    filePath = null,
    bootstrapPath = null,
    publicOrigin = null,
    keyPath = null,
    now = Date.now,
  } = {}) {
    this.ownerId = ownerId;
    this.filePath = filePath;
    this.now = now;
    this.publicOrigin = publicOrigin;
    this.keyPath = keyPath;
    this.security = new (require("./admin-security").AdminSecurity)(this);
    this.failures = [];
    this.credentials = null;
    if (
      publicOrigin &&
      (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith("https://"))
    )
      throw Error("Адрес панели владельца должен быть полным HTTPS origin без пути.");
    if (!ownerId) return;
    if (filePath && fs.existsSync(filePath)) {
      this.credentials = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const c = this.credentials;
      if (
        c.ownerId !== ownerId ||
        c.version !== 1 ||
        (c.passwordHash
          ? !/^[a-f0-9]{128}$/.test(c.passwordHash) || !/^[a-f0-9]{32}$/.test(c.salt)
          : !/^[a-f0-9]{64}$/.test(c.bootstrapHash))
      )
        throw Error("Неверный файл доступа владельца.");
    } else {
      const code = randomBytes(24).toString("hex");
      this.credentials = { version: 1, ownerId, bootstrapHash: digest(code) };
      if (filePath) {
        if (!bootstrapPath) throw Error("Не задан файл первого входа владельца.");
        atomic(bootstrapPath, { ownerId, setupCode: code });
        atomic(filePath, this.credentials);
      } else this.bootstrapCode = code; // Только изолированные экземпляры без файлов.
    }
  }
  isOwner(profile) {
    return !!this.ownerId && profile?.id === this.ownerId;
  }
  guardRecovery(req) {
    // Recovery is available only through the private loopback/SSH connection.
    // A reverse proxy must never be mistaken for the owner's local browser.
    if (
      !this.ownerId ||
      !this.credentials?.passwordHash ||
      !loopback(req.socket.remoteAddress) ||
      Object.keys(req.headers).some(
        (name) => name.startsWith("x-forwarded-") || name === "forwarded",
      )
    )
      throw new BoosterError("Восстановление доступно только через локальный вход владельца.", 403);
    this.guard(req, { id: this.ownerId });
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(new URL("http://" + req.headers.host).hostname)
    )
      throw new BoosterError("Открой локальный адрес игры через SSH-туннель.", 403);
  }
  async verifyRecoveryPassword(password, req, code) {
    this.guardRecovery(req);
    this.failures = this.failures.filter((at) => at > this.now() - 15 * 60000);
    if (this.busy || this.failures.length >= 5)
      throw new BoosterError("Подожди перед следующей попыткой входа.", 429);
    if (typeof password !== "string" || password.length < 12 || password.length > 128)
      throw new BoosterError("Введи существующий пароль админ-панели из 12–128 символов.", 400);
    this.busy = true;
    try {
      const current = this.credentials;
      const hash = (
        await derive(password, current.salt, 64, {
          N: 32768,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024,
        })
      ).toString("hex");
      if (current !== this.credentials || !equal(hash, current.passwordHash)) {
        this.failures.push(this.now());
        throw new BoosterError("Неверный пароль.", 403);
      }
      if (this.security.ownerEnabled()) {
        const next = structuredClone(this.security.load());
        try { next.owner.factor = this.security.factorPatch(this.ownerId, next.owner.factor, code); }
        catch (e) { this.failures.push(this.now()); throw e; }
        this.security.save(next);
      }
      this.failures = [];
    } finally {
      this.busy = false;
    }
  }
  guard(req, profile) {
    if (!this.isOwner(profile) && !this.ownerAuthenticated(req))
      throw new BoosterError("Доступ разрешён только аккаунту владельца.", 403);
    return this.guardTransport(req);
  }
  guardTransport(req) {
    if (!this.ownerId) throw new BoosterError("Вход в админку не настроен.", 403);
    const local = loopback(req.socket.remoteAddress);
    const host = new URL("http://" + req.headers.host).hostname;
    const secure =
      !!req.socket.encrypted ||
      (local && this.publicOrigin && req.headers["x-forwarded-proto"] === "https");
    const expected = secure
      ? this.publicOrigin || "https://" + req.headers.host
      : "http://" + req.headers.host;
    if (
      (!secure && (!local || !["localhost", "127.0.0.1", "[::1]"].includes(host))) ||
      (this.publicOrigin && secure && "https://" + req.headers.host !== this.publicOrigin)
    )
      throw new BoosterError("Панель доступна локально или через настроенный HTTPS-адрес.", 403);
    if (req.headers.origin && req.headers.origin !== expected)
      throw new BoosterError("Недопустимый источник запроса.", 403);
    if (
      req.method === "POST" &&
      (req.headers.origin !== expected ||
        !(req.headers["content-type"] || "").startsWith("application/json"))
    )
      throw new BoosterError("Открой панель владельца на адресе игры.", 403);
    return secure;
  }
  ownerAuthenticated(req) {
    const s = this.session;
    if (
      !s ||
      s.until <= this.now() ||
      s.absolute <= this.now() ||
      !equal(digest(cookie(req) || ""), s.tokenHash) ||
      !this.security.ownerValid(s)
    )
      return false;
    return true;
  }
  authenticated(req) { return this.ownerAuthenticated(req) || !!this.security.session(req); }
  principal(req) {
    if (this.ownerAuthenticated(req)) return { id: this.ownerId, login: "owner", role: "owner" };
    const s = this.security.session(req);
    return s ? { id: s.id, login: s.login, role: s.role, version: s.version } : null;
  }
  canManagePlayers(actor) { return this.isOwner(actor) || this.security.moderator(actor); }
  allowRoute(req, pathname) {
    const actor = this.principal(req);
    if (!actor) throw new BoosterError("Войди в админку заново.", 401);
    if (actor.role === "owner") return actor;
    const allowed = req.method === "GET" ? ["players", "player", "transactions", "audit", "service-journal", "security", "performance", "monitoring", "overview-calendar", "payments", "feedback"] : ["action", "logout", "security/profile", "feedback"];
    if (!allowed.some(p => pathname === "/api/admin/" + p)) throw new BoosterError("Этот раздел доступен только владельцу.", 403);
    return actor;
  }
  status(req) {
    const actor = this.principal(req), s = actor?.role === "owner" ? this.session : this.security.session(req);
    return {
      setupRequired: !this.credentials?.passwordHash,
      authenticated: !!actor,
      ...(actor ? { csrf: s.csrf, role: actor.role, login: actor.login,
        twoFactorEnabled: !!this.security.account(actor.id)?.factor } : {}),
    };
  }
  authorize(req) {
    if (!this.authenticated(req)) throw new BoosterError("Войди в панель владельца заново.", 401);
    const session = this.ownerAuthenticated(req) ? this.session : this.security.session(req);
    if (req.method === "POST" && !equal(req.headers["x-owner-csrf"], session.csrf))
      throw new BoosterError("Проверка запроса не пройдена. Обнови панель.", 403);
    session.until = Math.min(this.now() + 15 * 60000, session.absolute);
  }
  async login(input, req, res, profile, setup = false) {
    const secure = this.guard(req, profile);
    this.failures = this.failures.filter((at) => at > this.now() - 15 * 60000);
    if (this.busy) throw new BoosterError("Вход уже выполняется. Подожди немного.", 429);
    if (this.failures.length >= 5)
      throw new BoosterError("Подожди 15 минут перед следующей попыткой входа.", 429);
    if (
      typeof input.password !== "string" ||
      input.password.length < 12 ||
      input.password.length > 128
    )
      throw new BoosterError("Пароль должен содержать от 12 до 128 символов.", 400);
    this.busy = true;
    try {
      const current = this.credentials;
      if (setup) {
        if (current.passwordHash || !loopback(req.socket.remoteAddress))
          throw new BoosterError("Первичная настройка недоступна.", 403);
        if (
          typeof input.setupCode !== "string" ||
          !equal(digest(input.setupCode), current.bootstrapHash)
        ) {
          this.failures.push(this.now());
          throw new BoosterError("Неверный ключ первого входа.", 403);
        }
        const salt = randomBytes(16).toString("hex"),
          passwordHash = (
            await derive(input.password, salt, 64, {
              N: 32768,
              r: 8,
              p: 1,
              maxmem: 64 * 1024 * 1024,
            })
          ).toString("hex");
        const next = { version: 1, ownerId: this.ownerId, salt, passwordHash };
        if (this.filePath) atomic(this.filePath, next);
        this.credentials = next;
      } else {
        if (!current.passwordHash) throw new BoosterError("Сначала настрой пароль владельца.", 409);
        const hash = (
          await derive(input.password, current.salt, 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 64 * 1024 * 1024,
          })
        ).toString("hex");
        if (!equal(hash, current.passwordHash)) {
          this.failures.push(this.now());
          throw new BoosterError("Неверный пароль.", 403);
        }
      }
      this.failures = [];
      if (this.security.ownerEnabled()) return this.security.challenge({ id: this.ownerId, login: "owner", role: "owner" }, req, res);
      return this.issueSession(req, res);
    } finally {
      this.busy = false;
    }
  }
  issueSession(req, res) {
      const secure = this.guardTransport(req), token = randomBytes(32).toString("hex");
      this.session = {
        tokenHash: digest(token),
        csrf: randomBytes(32).toString("hex"),
        until: this.now() + 15 * 60000,
        absolute: this.now() + 3600000,
        factorVersion: this.security.ownerVersion(),
      };
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=3600${secure ? "; Secure" : ""}`,
      );
      return this.status({ headers: { cookie: `${COOKIE}=${token}` } });
  }
  async confirmPassword(password, req, profile) {
    this.guard(req, profile);
    this.authorize(req);
    const session = this.session;
    this.failures = this.failures.filter((at) => at > this.now() - 15 * 60000);
    if (this.busy) throw new BoosterError("Проверка пароля уже выполняется. Подожди немного.", 429);
    if (this.failures.length >= 5)
      throw new BoosterError("Подожди 15 минут перед следующей попыткой подтверждения.", 429);
    if (typeof password !== "string" || password.length < 12 || password.length > 128)
      throw new BoosterError("Введи пароль админ-панели из 12–128 символов.", 400);
    this.busy = true;
    try {
      const current = this.credentials;
      if (!current.passwordHash) throw new BoosterError("Сначала настрой пароль владельца.", 409);
      const hash = (
        await derive(password, current.salt, 64, {
          N: 32768,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024,
        })
      ).toString("hex");
      if (!equal(hash, current.passwordHash)) {
        this.failures.push(this.now());
        throw new BoosterError("Неверный пароль. Событие не изменено.", 403);
      }
      // Logout, expiration or replacement of the session during scrypt cancels confirmation.
      if (session !== this.session) throw new BoosterError("Сеанс изменился. Войди заново.", 401);
      this.authorize(req);
      this.failures = [];
    } finally {
      this.busy = false;
    }
  }
  logout(res, secure, req) {
    const staff = req && this.security.session(req);
    if (staff) this.security.sessions.delete(staff.id); else this.session = null;
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secure ? "; Secure" : ""}`,
    );
  }
}
module.exports = { OwnerAccess };

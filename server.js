const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "rules_data.json");
const ADMIN_PASS = process.env.ADMIN_PASS || "school2024";

// ─── Начальные правила ────────────────────────────────────────
const DEFAULT_RULES = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  blocked_domains: [
    "pornhub.com", "xvideos.com", "xnxx.com", "redtube.com", "youporn.com",
    "onlyfans.com", "brazzers.com", "xhamster.com", "spankbang.com",
    "1xbet.com", "melbet.com", "bet365.com", "olimp.bet", "fonbet.ru",
    "thepiratebay.org", "rutracker.org", "nnmclub.to", "1337x.to",
    "fitgirl-repacks.site", "steamunlocked.net", "igg-games.com"
  ],
  blocked_phrases: [
    "терроризм", "террорист", "джихад", "игил", "isis", "daesh",
    "экстремизм", "халифат", "скулшутинг", "колумбайн",
    "как сделать бомбу", "взрывчатка своими руками",
    "порно", "porn", "xxx", "эротика",
    "порно смотреть", "секс видео", "взрослое видео",
    "купить наркотики", "закладка наркотики", "спайс купить",
    "как покончить с собой", "способы суицида", "группа смерти",
    "скачать игру торрент", "взломанные игры скачать",
    "counter strike скачать", "gta скачать бесплатно"
  ],
  custom_message: "Данный контент заблокирован администрацией школы"
};

// ─── Загрузка/сохранение данных ───────────────────────────────
function loadRules() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_RULES));
}

function saveRules(rules) {
  rules.version = (rules.version || 1) + 1;
  rules.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(DATA_FILE, JSON.stringify(rules, null, 2));
  return rules;
}

// ─── Простая сессия (токен в памяти) ─────────────────────────
const sessions = new Set();
function createSession() {
  const token = crypto.randomBytes(16).toString("hex");
  sessions.add(token);
  setTimeout(() => sessions.delete(token), 8 * 60 * 60 * 1000); // 8 часов
  return token;
}
function checkSession(req) {
  const cookie = (req.headers.cookie || "").split(";")
    .find(c => c.trim().startsWith("kz_session="));
  return cookie && sessions.has(cookie.split("=")[1].trim());
}

// ─── Парсинг тела запроса ─────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ─── Роутер ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // CORS для расширения
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── GET /rules.json — для расширения ──────────────────────
  if (req.method === "GET" && pathname === "/rules.json") {
    const rules = loadRules();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    });
    res.end(JSON.stringify(rules));
    return;
  }

  // ── POST /api/login ───────────────────────────────────────
  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    if (body.password === ADMIN_PASS) {
      const token = createSession();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": `kz_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
      });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Неверный пароль" }));
    }
    return;
  }

  // ── GET /api/rules — получить правила (только для админа) ─
  if (req.method === "GET" && pathname === "/api/rules") {
    if (!checkSession(req)) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadRules()));
    return;
  }

  // ── POST /api/rules — сохранить правила ──────────────────
  if (req.method === "POST" && pathname === "/api/rules") {
    if (!checkSession(req)) { res.writeHead(401); res.end("{}"); return; }
    const body = await parseBody(req);
    const current = loadRules();
    if (Array.isArray(body.blocked_domains)) current.blocked_domains = body.blocked_domains;
    if (Array.isArray(body.blocked_phrases)) current.blocked_phrases = body.blocked_phrases;
    if (body.custom_message !== undefined) current.custom_message = body.custom_message;
    const saved = saveRules(current);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: saved.version }));
    return;
  }

  // ── GET / — панель администратора (HTML) ──────────────────
  if (req.method === "GET" && (pathname === "/" || pathname === "/admin")) {
    const htmlFile = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(htmlFile)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(htmlFile));
    } else {
      res.writeHead(404); res.end("index.html not found");
    }
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`[KZ Filter Server] запущен на порту ${PORT}`);
  console.log(`[KZ Filter Server] Правила: http://localhost:${PORT}/rules.json`);
  console.log(`[KZ Filter Server] Панель: http://localhost:${PORT}/`);
});

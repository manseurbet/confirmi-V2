const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const { normalizeClientPhone } = require("./phone");

const app = express();
const PORT = 3000;

// Derrière le proxy Replit : nécessaire pour que req.ip soit l'IP du visiteur
app.set("trust proxy", 1);

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

// Code secret du super-admin : à définir dans Replit > Secrets (clé ADMIN_TOKEN).
// S'il n'est pas défini, /admin/global-data reste FERMÉ (jamais ouvert par défaut).
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// En dessous de ce nombre de commandes, on n'affiche pas de pourcentage.
// Mettre 1 pour que seuls les clients sans aucun historique soient « جديد ».
const MIN_HISTORY_FOR_SCORE = 3;

// Résultat de livraison : « returned » avec un motif.
// penalizing = le motif compte contre le client dans sa note.
// (une adresse fausse ou « autre » ne pénalise pas : bénéfice du doute au client)
const OUTCOME_REASONS = {
  refused:       { penalizing: true },   // رفض الاستلام عند التسليم
  unreachable:   { penalizing: true }, // لا يرد على الهاتف
  wrong_address: { penalizing: false },  // عنوان غير صحيح / تعذر الوصول
  other:         { penalizing: false },  // سبب آخر
};
// Le vendeur peut corriger une erreur de clic pendant 24 h, ensuite le résultat est verrouillé.
const OUTCOME_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Note du vendeur par ses acheteurs : visible publiquement à partir de ce nombre d'avis (avant : « بائع جديد »)
const MIN_RATINGS_PUBLIC = 3;
// L'acheteur peut noter pendant 30 jours après l'enregistrement de la livraison
const RATING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const TRANSACTION_ID_RE = /^[a-f0-9]{32}$/;       // jeton aléatoire de 128 bits
// Liste blanche : « seller_ » + caractères alphanumériques (ancien format : 9, nouveau : 32),
// plus l'ancien vendeur de test. Empêche des noms comme "__proto__" ou "constructor".
const SELLER_ID_RE = /^(seller_[A-Za-z0-9]{9,64}|default-vendeur)$/;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;        // 10 Mo

if (!ADMIN_TOKEN) {
  console.warn("⚠️  ADMIN_TOKEN n'est pas défini : /admin/global-data est désactivé.");
}

/* ------------------------------------------------------------------ */
/* Middlewares généraux                                                */
/* ------------------------------------------------------------------ */

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer"); // le jeton du lien client ne fuit pas vers d'autres sites
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "frontend")));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff"),
  })
);

function rateLimit({ windowMs, max, cost = () => 1 }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(req.ip, h);
    }
    h.count += cost(req);
    if (h.count > max) {
      res.set("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ success: false, message: "Trop de requêtes. Réessayez dans un instant." });
    }
    next();
  };
}

// Limites larges : beaucoup de mobiles partagent la même IP chez les opérateurs.
const scoreLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const publicLinkLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
// Consultation par lot (aperçu de l'import) : chaque numéro compte, donc pas de contournement de la limite
const MAX_BATCH_PHONES = 200;
const scoreBatchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  cost: (req) => {
    const phones = req.body && req.body.phones;
    return Array.isArray(phones) ? Math.min(Math.max(phones.length, 1), 1000) : 1;
  },
});
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 }); // connexion / inscription / mot de passe (par IP)
const outcomeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

/* ------------------------------------------------------------------ */
/* Fichiers de données                                                 */
/* ------------------------------------------------------------------ */

const transactionsFile = path.join(__dirname, "transactions.json");
const scoresFile = path.join(__dirname, "scores.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Écriture « atomique » : on écrit dans un fichier temporaire puis on renomme,
// pour qu'une coupure en plein milieu ne laisse pas un JSON à moitié écrit.
function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function ensureFile(file, defaultContent) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").trim() === "") {
    writeJson(file, defaultContent);
  }
}

ensureFile(transactionsFile, []);
ensureFile(scoresFile, { clients: {}, vendeurs: {} });

function normalizePhoneCounts(countsByPhone = {}) {
  const normalized = {};
  for (const [phone, counts] of Object.entries(countsByPhone)) {
    const key = normalizeClientPhone(phone) || phone;
    normalized[key] ??= { ok: 0, ko: 0 };
    normalized[key].ok += Number.isFinite(Number(counts?.ok)) ? Number(counts.ok) : 0;
    normalized[key].ko += Number.isFinite(Number(counts?.ko)) ? Number(counts.ko) : 0;
  }
  return normalized;
}

function migrateData() {
  // 1) Numéros de téléphone canoniques + date de création des anciennes transactions
  const transactions = readJson(transactionsFile);
  const originalTransactions = JSON.stringify(transactions);
  for (const transaction of transactions) {
    const normalized = normalizeClientPhone(transaction.clientPhone);
    if (normalized) transaction.clientPhone = normalized;

    // Anciens identifiants = Date.now() : on en garde la date avant qu'ils ne disparaissent
    if (!transaction.createdAt && /^\d{10,}$/.test(String(transaction.transactionId))) {
      transaction.createdAt = new Date(Number(transaction.transactionId)).toISOString();
    }
  }
  if (JSON.stringify(transactions) !== originalTransactions) {
    writeJson(transactionsFile, transactions);
  }

  // 2) Scores
  const scoresContent = fs.readFileSync(scoresFile, "utf8");
  const scores = JSON.parse(scoresContent);
  scores.clients = normalizePhoneCounts(scores.clients);
  scores.vendeurs ??= {};
  for (const seller of Object.values(scores.vendeurs)) {
    if (seller && typeof seller === "object") {
      seller.clients = normalizePhoneCounts(seller.clients);
    }
  }
  const normalizedScores = JSON.stringify(scores, null, 2);
  if (normalizedScores !== scoresContent) {
    fs.writeFileSync(scoresFile, normalizedScores);
  }
}

migrateData();

/* ------------------------------------------------------------------ */
/* Téléversements : noms aléatoires, types et taille limités           */
/* ------------------------------------------------------------------ */

// L'extension vient de cette liste, jamais du nom envoyé par l'utilisateur :
// un fichier .html déguisé ne pourra donc pas être servi comme page web.
const ALLOWED_UPLOAD_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "uploads");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, crypto.randomBytes(16).toString("hex") + ALLOWED_UPLOAD_TYPES[file.mimetype]);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error("UNSUPPORTED_FILE_TYPE"));
  },
});

function uploadSingle(field) {
  const middleware = upload.single(field);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      let message = "تعذر رفع الملف.";
      if (err.code === "LIMIT_FILE_SIZE") message = "الملف كبير جدا (الحد الأقصى 10 ميغابايت).";
      else if (err.message === "UNSUPPORTED_FILE_TYPE") message = "نوع الملف غير مدعوم (صورة أو PDF فقط).";
      res.status(400).json({ success: false, message });
    });
  };
}

function discardUpload(req) {
  if (req.file) fs.unlink(req.file.path, () => {});
}

/* ------------------------------------------------------------------ */
/* Score de fiabilité                                                  */
/* ------------------------------------------------------------------ */

function badge(score) {
  if (score >= 80) return "🟢 موثوق";
  if (score >= 50) return "🟠 متوسط";
  return "🔴 غير موثوق";
}

// status : "new" (aucun historique) | "few" (historique trop court)
//          | "trusted" | "average" | "risky"
// score  : null tant qu'il n'y a pas assez d'historique (jamais 0 par défaut)
function scoreInfo(counts) {
  const ok = Number(counts?.ok) || 0;
  const ko = Number(counts?.ko) || 0;
  const total = ok + ko;

  if (total === 0) return { status: "new", score: null, badge: "⚪ جديد", ok, ko, total };
  if (total < MIN_HISTORY_FOR_SCORE) {
    return { status: "few", score: null, badge: "⚪ بيانات قليلة", ok, ko, total };
  }

  const score = Math.round((ok / total) * 100);
  const status = score >= 80 ? "trusted" : score >= 50 ? "average" : "risky";
  return { status, score, badge: badge(score), ok, ko, total };
}

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */

const INVALID_PHONE_MESSAGE =
  "Numéro invalide : indiquez 05, 06 ou 07 suivi de 8 chiffres, ou le même numéro avec l’indicatif +213.";

// 213556751401 -> 0556***401 (le client ne voit pas son numéro en entier dans l'URL/réponse)
function maskPhone(phone) {
  if (!/^213\d{9}$/.test(String(phone))) return "***";
  const local = "0" + String(phone).slice(3);
  return local.slice(0, 4) + "***" + local.slice(-3);
}

// Notes reçues par un vendeur : seuls les avis sur des commandes réellement livrées comptent
function ratingSummary(transactions, sellerId) {
  const rated = transactions.filter(
    (t) => t.sellerId === sellerId && t.rating && t.outcome && t.outcome.status === "delivered"
  );
  const count = rated.length;
  const sum = rated.reduce((s, t) => s + t.rating.stars, 0);
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, rated };
}

// Ce que voit le CLIENT : jamais le sellerId ni le numéro complet.
function publicTransaction(t, shopName, vendorRating) {
  const delivered = !!(t.outcome && t.outcome.status === "delivered");
  return {
    shopName: shopName || "",
    vendorRating: {
      count: vendorRating ? vendorRating.count : 0,
      average: vendorRating ? vendorRating.average : null,
      shown: !!vendorRating && vendorRating.count >= MIN_RATINGS_PUBLIC,
    },
    delivered,
    rated: !!t.rating,
    clientName: t.clientName,
    clientPhone: maskPhone(t.clientPhone),
    productRef: t.productRef,
    amount: t.amount,
    description: t.description || "",
    photo: t.photo || null,
    confirmed: !!t.confirmed,
    refused: !!t.refused,
  };
}

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

/* ------------------------------------------------------------------ */
/* Accès admin protégé                                                 */
/* ------------------------------------------------------------------ */

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, message: "ADMIN_TOKEN n'est pas configuré sur le serveur." });
  }
  const provided = req.get("x-admin-token") || "";
  // Comparaison en temps constant (sur des empreintes de même longueur)
  if (!crypto.timingSafeEqual(sha256(provided), sha256(ADMIN_TOKEN))) {
    return res.status(401).json({ success: false, message: "Accès refusé." });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Comptes vendeurs, sessions, invitations                             */
/* ------------------------------------------------------------------ */

const usersFile = path.join(__dirname, "users.json");
const sessionsFile = path.join(__dirname, "sessions.json");
const invitesFile = path.join(__dirname, "invites.json");
ensureFile(usersFile, []);
ensureFile(sessionsFile, {});
ensureFile(invitesFile, []);

const SESSION_COOKIE = "confirmi_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 jours
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;    // 14 jours
// Inscription sur invitation (par défaut). Pour l'ouvrir pendant les essais : Replit > Secrets > INVITE_REQUIRED = 0
// (le système d'invitation reste en place : supprimez la variable pour le réactiver).
const INVITE_REQUIRED = process.env.INVITE_REQUIRED !== "0";
if (!INVITE_REQUIRED) {
  console.warn("⚠️  Inscription OUVERTE (INVITE_REQUIRED=0) : n'importe qui ayant l'adresse peut créer un compte vendeur.");
}
const PASSWORD_MIN = 8;
const LOGIN_MAX_FAILS = 5;                         // essais ratés avant blocage du numéro
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans I, L, O, 0, 1 (faciles à confondre)

// Faux hash : on fait toujours un bcrypt.compare, même si le numéro n'existe pas (temps de réponse identique)
const DUMMY_HASH = bcrypt.hashSync("confirmi-dummy-password", 10);

const sha256hex = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function readUsers() {
  const users = readJson(usersFile);
  return Array.isArray(users) ? users : [];
}

function randomFromAlphabet(length) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

function localPhone(p) {
  return /^213\d{9}$/.test(String(p)) ? "0" + String(p).slice(3) : String(p || "");
}

function validPassword(password) {
  return typeof password === "string" && password.length >= PASSWORD_MIN && Buffer.byteLength(password) <= 72;
}
const PASSWORD_MESSAGE = `كلمة السر يجب أن تحتوي على ${PASSWORD_MIN} أحرف على الأقل.`;

/* --- cookies et sessions --- */

function parseCookies(req) {
  const out = Object.create(null);
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i <= 0) return;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie mal formé : ignoré */ }
  });
  return out;
}

function setSessionCookie(req, res, value, maxAgeMs) {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

// On ne garde que l'empreinte du jeton : un vol du fichier sessions.json ne donne aucune session utilisable
function createSession(req, res, sellerId) {
  const token = crypto.randomBytes(32).toString("hex");
  const sessions = readJson(sessionsFile);
  const now = Date.now();
  for (const key of Object.keys(sessions)) if (sessions[key].expiresAt <= now) delete sessions[key];
  sessions[sha256hex(token)] = { sellerId, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  writeJson(sessionsFile, sessions);
  setSessionCookie(req, res, token, SESSION_TTL_MS);
}

function revokeSessions(sellerId, exceptHash) {
  const sessions = readJson(sessionsFile);
  let changed = false;
  for (const key of Object.keys(sessions)) {
    if (sessions[key].sellerId === sellerId && key !== exceptHash) { delete sessions[key]; changed = true; }
  }
  if (changed) writeJson(sessionsFile, sessions);
}

// Place req.sellerId (le SEUL identifiant vendeur auquel on fait confiance) ou répond 401
function requireSeller(req, res, next) {
  const unauthorized = () => res.status(401).json({ success: false, message: "يجب تسجيل الدخول." });
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return unauthorized();

  const hash = sha256hex(token);
  const sessions = readJson(sessionsFile);
  const session = Object.hasOwn(sessions, hash) ? sessions[hash] : null;
  if (!session || session.expiresAt <= Date.now()) return unauthorized();

  const user = readUsers().find((u) => u.sellerId === session.sellerId);
  if (!user || user.status === "disabled") return unauthorized();

  req.sellerId = user.sellerId;
  req.user = user;
  req.sessionHash = hash;
  next();
}

/* --- blocage après trop d'essais ratés (par numéro) --- */

const loginFails = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, f] of loginFails) if (f.until <= now && f.resetAt <= now) loginFails.delete(key);
}, 60 * 1000).unref();

function lockedMinutes(key) {
  const f = loginFails.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
function registerFail(key) {
  const now = Date.now();
  let f = loginFails.get(key);
  if (!f || (f.until <= now && f.resetAt <= now)) f = { count: 0, until: 0, resetAt: now + LOGIN_LOCK_MS };
  f.count++;
  if (f.count >= LOGIN_MAX_FAILS) { f.until = now + LOGIN_LOCK_MS; f.resetAt = f.until; f.count = 0; }
  loginFails.set(key, f);
}

/* --- inscription (sur invitation), connexion, déconnexion --- */

// Réglages publics lus par la page de connexion (aucun secret : seulement des booléens)
app.get("/config", (req, res) => {
  res.json({ success: true, inviteRequired: INVITE_REQUIRED });
});

// Corps JSON : { inviteCode?, phone, shopName, password } ; le code est facultatif si INVITE_REQUIRED=0
app.post("/register", authLimiter, async (req, res) => {
  const body = req.body || {};
  const fail = (status, message) => res.status(status).json({ success: false, message });

  const phone = normalizeClientPhone(typeof body.phone === "string" ? body.phone : "");
  if (!phone) return fail(400, "رقم الهاتف غير صالح (05 أو 06 أو 07 متبوعا بـ 8 أرقام).");
  const shopName = clip(body.shopName, 60);
  if (shopName.length < 2) return fail(400, "اسم المتجر مطلوب.");
  if (!validPassword(body.password)) return fail(400, PASSWORD_MESSAGE);
  const code = String(body.inviteCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const useInvite = INVITE_REQUIRED || code.length > 0;   // un code fourni est toujours vérifié (et consommé)
  if (useInvite && code.length !== 8) return fail(400, "كود الدعوة غير صالح.");

  const passwordHash = await bcrypt.hash(body.password, 10);

  // Tout ce qui suit est synchrone : pas de course entre deux inscriptions simultanées
  const invites = readJson(invitesFile);
  let invite = null;
  if (useInvite) {
    invite = invites.find((i) => i.hash === sha256hex(code));
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) < Date.now()) {
      return fail(400, "كود الدعوة غير صالح أو منتهي الصلاحية.");
    }
  }

  const users = readUsers();
  if (users.some((u) => u.phone === phone)) return fail(409, "هذا الرقم مسجل مسبقا، سجّل الدخول.");

  let sellerId = "seller_" + crypto.randomBytes(16).toString("hex");
  if (invite && invite.sellerId) {             // invitation liée à d'anciennes données (période de test)
    if (users.some((u) => u.sellerId === invite.sellerId)) return fail(409, "هذا المعرّف القديم مرتبط بحساب آخر.");
    sellerId = invite.sellerId;
  }

  users.push({ sellerId, phone, shopName, passwordHash, status: "active", createdAt: new Date().toISOString(), lastLoginAt: null });
  if (invite) {
    invite.usedAt = new Date().toISOString();
    invite.usedBy = sellerId;
    writeJson(invitesFile, invites);
  }
  writeJson(usersFile, users);

  createSession(req, res, sellerId);
  res.json({ success: true, sellerId, shopName, phone: localPhone(phone) });
});

// Corps JSON : { phone, password }
app.post("/login", authLimiter, async (req, res) => {
  const { phone: rawPhone, password } = req.body || {};
  const generic = () => res.status(401).json({ success: false, message: "رقم الهاتف أو كلمة السر غير صحيحة." });

  const phone = normalizeClientPhone(typeof rawPhone === "string" ? rawPhone : "");
  if (!phone || typeof password !== "string" || password.length > 200) return generic();

  const minutes = lockedMinutes(phone);
  if (minutes) return res.status(429).json({ success: false, message: `محاولات كثيرة، أعد المحاولة بعد ${minutes} دقيقة.` });

  const user = readUsers().find((u) => u.phone === phone);
  const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passwordOk) { registerFail(phone); return generic(); }
  if (user.status === "disabled") return res.status(403).json({ success: false, message: "الحساب موقوف، تواصل مع الإدارة." });

  loginFails.delete(phone);
  const users = readUsers();
  const current = users.find((u) => u.sellerId === user.sellerId);
  if (current) { current.lastLoginAt = new Date().toISOString(); writeJson(usersFile, users); }

  createSession(req, res, user.sellerId);
  res.json({ success: true, sellerId: user.sellerId, shopName: user.shopName, phone: localPhone(user.phone) });
});

app.post("/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const sessions = readJson(sessionsFile);
    const hash = sha256hex(token);
    if (Object.hasOwn(sessions, hash)) { delete sessions[hash]; writeJson(sessionsFile, sessions); }
  }
  setSessionCookie(req, res, "", 0);
  res.json({ success: true });
});

app.get("/me", requireSeller, (req, res) => {
  const { count, average } = ratingSummary(readJson(transactionsFile), req.sellerId);
  res.json({
    success: true,
    sellerId: req.user.sellerId,
    shopName: req.user.shopName,
    phone: localPhone(req.user.phone),
    rating: { count, average },
  });
});

// Les avis reçus par le vendeur connecté (les commentaires ne sont visibles que par lui)
app.get("/my-rating", requireSeller, (req, res) => {
  const { count, average, rated } = ratingSummary(readJson(transactionsFile), req.sellerId);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  rated.forEach((t) => { distribution[t.rating.stars]++; });
  const recent = rated
    .slice()
    .sort((a, b) => Date.parse(b.rating.at) - Date.parse(a.rating.at))
    .slice(0, 10)
    .map((t) => ({ stars: t.rating.stars, comment: t.rating.comment || "", at: t.rating.at, productRef: t.productRef }));
  res.json({ success: true, count, average, minPublic: MIN_RATINGS_PUBLIC, shownPublicly: count >= MIN_RATINGS_PUBLIC, distribution, recent });
});

// Corps JSON : { oldPassword, newPassword } ; les autres appareils sont déconnectés
app.post("/change-password", requireSeller, authLimiter, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const fail = (status, message) => res.status(status).json({ success: false, message });

  if (!validPassword(newPassword)) return fail(400, PASSWORD_MESSAGE);
  if (typeof oldPassword !== "string" || oldPassword.length > 200) return fail(400, "كلمة السر الحالية غير صحيحة.");

  const minutes = lockedMinutes(req.user.phone);
  if (minutes) return fail(429, `محاولات كثيرة، أعد المحاولة بعد ${minutes} دقيقة.`);
  if (!(await bcrypt.compare(oldPassword, req.user.passwordHash))) {
    registerFail(req.user.phone);
    return fail(400, "كلمة السر الحالية غير صحيحة.");
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const users = readUsers();
  const current = users.find((u) => u.sellerId === req.sellerId);
  if (!current) return fail(404, "الحساب غير موجود.");
  current.passwordHash = newHash;
  writeJson(usersFile, users);
  revokeSessions(req.sellerId, req.sessionHash);
  res.json({ success: true });
});

/* --- administration des comptes (protégée par ADMIN_TOKEN) --- */

// Corps JSON : { note?, legacySellerId? } -> le code n'est montré qu'une fois (seule son empreinte est gardée)
app.post("/admin/invites", adminLimiter, requireAdmin, (req, res) => {
  const body = req.body || {};
  let legacySellerId;
  if (body.legacySellerId) {
    legacySellerId = String(body.legacySellerId);
    if (!SELLER_ID_RE.test(legacySellerId)) {
      return res.status(400).json({ success: false, message: "Ancien identifiant vendeur invalide." });
    }
    if (readUsers().some((u) => u.sellerId === legacySellerId)) {
      return res.status(409).json({ success: false, message: "Cet ancien identifiant est déjà lié à un compte." });
    }
    if (!readJson(transactionsFile).some((t) => t.sellerId === legacySellerId)) {
      return res.status(404).json({ success: false, message: "Aucune transaction avec cet identifiant." });
    }
  }

  const raw = randomFromAlphabet(8);
  const invites = readJson(invitesFile);
  invites.push({
    id: crypto.randomBytes(4).toString("hex"),
    hash: sha256hex(raw),
    note: clip(body.note, 80),
    sellerId: legacySellerId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    usedAt: null,
    usedBy: null,
  });
  writeJson(invitesFile, invites);

  res.json({ success: true, code: raw.slice(0, 4) + "-" + raw.slice(4), expiresAt: invites[invites.length - 1].expiresAt });
});

app.get("/admin/invites", adminLimiter, requireAdmin, (req, res) => {
  const users = readUsers();
  const now = Date.now();
  const list = readJson(invitesFile).map((i) => {
    const owner = i.usedBy ? users.find((u) => u.sellerId === i.usedBy) : null;
    return {
      id: i.id,
      note: i.note,
      linkedToOldData: !!i.sellerId,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      status: i.usedAt ? "used" : Date.parse(i.expiresAt) < now ? "expired" : "active",
      usedBy: owner ? owner.shopName : null,
    };
  });
  res.json({ success: true, invites: list.reverse() });
});

app.get("/admin/users", adminLimiter, requireAdmin, (req, res) => {
  const transactions = readJson(transactionsFile);
  const list = readUsers().map((u) => ({
    sellerId: u.sellerId,
    shopName: u.shopName,
    phone: localPhone(u.phone),
    status: u.status || "active",
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    transactions: transactions.filter((t) => t.sellerId === u.sellerId).length,
    rating: (() => { const r = ratingSummary(transactions, u.sellerId); return { count: r.count, average: r.average }; })(),
  }));
  res.json({ success: true, users: list });
});

// Corps JSON : { status: "active" | "disabled" } ; un compte suspendu est déconnecté immédiatement
app.post("/admin/users/:sellerId/status", adminLimiter, requireAdmin, (req, res) => {
  const status = (req.body || {}).status;
  if (status !== "active" && status !== "disabled") {
    return res.status(400).json({ success: false, message: "Statut invalide." });
  }
  const users = readUsers();
  const user = SELLER_ID_RE.test(req.params.sellerId) ? users.find((u) => u.sellerId === req.params.sellerId) : null;
  if (!user) return res.status(404).json({ success: false, message: "Vendeur introuvable." });

  user.status = status;
  writeJson(usersFile, users);
  if (status === "disabled") revokeSessions(user.sellerId);
  res.json({ success: true, status });
});

// Mot de passe oublié : l'admin génère un mot de passe provisoire (affiché une seule fois) et le donne au vendeur
app.post("/admin/users/:sellerId/reset-password", adminLimiter, requireAdmin, async (req, res) => {
  if (!SELLER_ID_RE.test(req.params.sellerId)) return res.status(404).json({ success: false, message: "Vendeur introuvable." });
  const temporary = randomFromAlphabet(10);
  const hash = await bcrypt.hash(temporary, 10);

  const users = readUsers();
  const user = users.find((u) => u.sellerId === req.params.sellerId);
  if (!user) return res.status(404).json({ success: false, message: "Vendeur introuvable." });

  user.passwordHash = hash;
  writeJson(usersFile, users);
  revokeSessions(user.sellerId);
  loginFails.delete(user.phone);
  res.json({ success: true, password: temporary });
});

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get("/score/client/:phone", requireSeller, scoreLimiter, (req, res) => {
  const clientPhone = normalizeClientPhone(req.params.phone);
  if (!clientPhone) {
    return res.status(400).json({ success: false, message: INVALID_PHONE_MESSAGE });
  }

  const scores = readJson(scoresFile);
  const info = scoreInfo(scores.clients[clientPhone]);
  res.json({ success: true, clientPhone, ...info });
});

// Corps JSON : { phones: ["0556001122", "+213661223344", ...] } (200 numéros maximum)
// Réponse : results[i] correspond à phones[i]
app.post("/score/clients", requireSeller, scoreBatchLimiter, (req, res) => {
  const phones = req.body && req.body.phones;
  if (!Array.isArray(phones) || phones.length === 0 || phones.length > MAX_BATCH_PHONES) {
    return res.status(400).json({ success: false, message: "Liste de numéros invalide (1 à 200 numéros)." });
  }

  const scores = readJson(scoresFile);
  const results = phones.map((raw) => {
    const clientPhone = normalizeClientPhone(raw);
    if (!clientPhone) return { valid: false };
    return { valid: true, clientPhone, ...scoreInfo(scores.clients[clientPhone]) };
  });
  res.json({ success: true, results });
});

app.post("/create-confirmation", requireSeller, uploadSingle("productPhoto"), (req, res) => {
  const rawClientPhone = req.body.clientPhone;
  const sellerId = req.sellerId; // vient de la session, jamais du formulaire
  const clientName = clip(req.body.clientName, 100);
  const productRef = clip(req.body.productRef, 200);
  const description = clip(req.body.description, 500);
  const amount = Number(req.body.amount);

  if (!clientName || !rawClientPhone || !productRef || !req.body.amount) {
    discardUpload(req);
    return res.status(400).json({ success: false, message: "Champs obligatoires manquants." });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    discardUpload(req);
    return res.status(400).json({ success: false, message: "Montant invalide." });
  }

  const clientPhone = normalizeClientPhone(rawClientPhone);
  if (!clientPhone) {
    discardUpload(req);
    return res.status(400).json({ success: false, message: INVALID_PHONE_MESSAGE });
  }

  const transactions = readJson(transactionsFile);

  // Jeton aléatoire de 128 bits : impossible à deviner, contrairement à Date.now()
  const transactionId = crypto.randomBytes(16).toString("hex");
  const transaction = {
    transactionId,
    createdAt: new Date().toISOString(),
    sellerId,
    clientName,
    clientPhone,
    productRef,
    amount,
    description,
    photo: req.file ? "/uploads/" + req.file.filename : null,
    confirmed: false,
  };

  transactions.push(transaction);
  writeJson(transactionsFile, transactions);

  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  res.json({
    success: true,
    clientPhone,
    clientLink: `${protocol}://${req.headers.host}/client.html?id=${transactionId}`,
  });
});

app.get("/transaction/:id", publicLinkLimiter, (req, res) => {
  if (!TRANSACTION_ID_RE.test(req.params.id)) return res.json({ success: false });

  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === req.params.id);
  if (!t) return res.json({ success: false });
  const owner = readUsers().find((u) => u.sellerId === t.sellerId);
  const vendorRating = ratingSummary(transactions, t.sellerId);
  res.json({ success: true, transaction: publicTransaction(t, owner ? owner.shopName : "", vendorRating) });
});

// L'acheteur note le vendeur avec le même lien, une fois la livraison enregistrée.
// Corps JSON : { stars: 1..5, comment?: "…" } ; un seul avis par commande.
app.post("/rate-transaction/:id", publicLinkLimiter, (req, res) => {
  const invalidLink = () => res.json({ success: false, message: "الرابط غير صالح." });
  if (!TRANSACTION_ID_RE.test(req.params.id)) return invalidLink();

  const stars = Number((req.body || {}).stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ success: false, message: "اختر عدد النجوم من 1 إلى 5." });
  }
  const comment = clip((req.body || {}).comment, 200);

  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === req.params.id);
  if (!t) return invalidLink();
  if (!t.outcome || t.outcome.status !== "delivered") {
    return res.json({ success: false, message: "التقييم متاح بعد تسليم الطلب." });
  }
  if (t.rating) return res.json({ success: false, message: "لقد قمت بتقييم هذا الطلب مسبقا." });
  if (Date.now() - Date.parse(t.outcome.at) > RATING_WINDOW_MS) {
    return res.json({ success: false, message: "انتهت مدة التقييم." });
  }

  t.rating = { stars, comment, at: new Date().toISOString() };
  writeJson(transactionsFile, transactions);
  res.json({ success: true });
});

// Vérifie le lien AVANT de laisser multer écrire un fichier sur le disque
function requirePendingTransaction(req, res, next) {
  const id = req.params.id;
  if (!TRANSACTION_ID_RE.test(id)) {
    return res.json({ success: false, message: "الرابط غير صالح." });
  }
  const t = readJson(transactionsFile).find((x) => x.transactionId === id);
  if (!t) return res.json({ success: false, message: "الرابط غير صالح." });
  if (t.confirmed || t.refused) {
    return res.json({ success: false, message: "تمت معالجة هذا الطلب مسبقا." });
  }
  next();
}

// La confirmation par lien n'influence PLUS la note du client : seule la livraison compte
// (voir /transaction/:id/outcome). Un client qui refuse le lien avant l'expédition ne coûte rien au vendeur.
app.post("/confirm-transaction/:id", publicLinkLimiter, requirePendingTransaction, uploadSingle("attachment"), (req, res) => {
  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === req.params.id);
  if (!t || t.confirmed || t.refused) {
    discardUpload(req);
    return res.json({ success: false, message: "تمت معالجة هذا الطلب مسبقا." });
  }

  t.confirmed = true;
  t.confirmationDate = new Date().toISOString();
  if (req.file) {
    t.attachment = "/uploads/" + req.file.filename;
  }

  writeJson(transactionsFile, transactions);
  res.json({ success: true });
});

app.post("/refuse-transaction/:id", publicLinkLimiter, requirePendingTransaction, (req, res) => {
  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === req.params.id);
  if (!t || t.confirmed || t.refused) {
    return res.json({ success: false, message: "تمت معالجة هذا الطلب مسبقا." });
  }

  t.refused = true;
  t.refusalDate = new Date().toISOString();

  writeJson(transactionsFile, transactions);
  res.json({ success: true });
});

/* ------------------------------------------------------------------ */
/* Résultat de livraison (alimente la note du client)                  */
/* ------------------------------------------------------------------ */

// kind : "ok" (livré) ou "ko" (retour imputable au client) ; delta : +1 ou -1
function adjustScores(scores, t, kind, delta) {
  const phone = t.clientPhone;
  scores.clients[phone] ??= { ok: 0, ko: 0 };
  scores.clients[phone][kind] = Math.max(0, (scores.clients[phone][kind] || 0) + delta);

  scores.vendeurs[t.sellerId] ??= { clients: {} };
  scores.vendeurs[t.sellerId].clients ??= {};
  scores.vendeurs[t.sellerId].clients[phone] ??= { ok: 0, ko: 0 };
  const own = scores.vendeurs[t.sellerId].clients[phone];
  own[kind] = Math.max(0, (own[kind] || 0) + delta);
}

function outcomeView(outcome) {
  if (!outcome) return null;
  const editableUntil = new Date(Date.parse(outcome.at) + OUTCOME_EDIT_WINDOW_MS);
  return {
    status: outcome.status,
    reason: outcome.reason,
    affectsScore: !!outcome.counted,
    at: outcome.at,
    editableUntil: editableUntil.toISOString(),
    locked: Date.now() > editableUntil.getTime(),
  };
}

// Corps JSON : { sellerId, status: "delivered" | "returned", reason? }
// Seul le vendeur de la commande peut enregistrer le résultat.
app.post("/transaction/:id/outcome", requireSeller, outcomeLimiter, (req, res) => {
  const id = req.params.id;
  const sellerId = req.sellerId;
  const status = (req.body || {}).status;
  const badRequest = (message) => res.status(400).json({ success: false, message });

  if (!TRANSACTION_ID_RE.test(id) || typeof sellerId !== "string" || !SELLER_ID_RE.test(sellerId)) {
    return badRequest("طلب غير صالح.");
  }
  if (status !== "delivered" && status !== "returned") return badRequest("نتيجة غير صالحة.");

  let reason = null;
  if (status === "returned") {
    reason = String(req.body.reason || "");
    if (!Object.hasOwn(OUTCOME_REASONS, reason)) return badRequest("اختر سبب الإرجاع.");
  }

  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === id);
  // Même réponse si la commande n'existe pas ou n'appartient pas à ce vendeur
  if (!t || t.sellerId !== sellerId) {
    return res.status(404).json({ success: false, message: "المعاملة غير موجودة." });
  }
  if (t.refused) {
    return res.status(409).json({ success: false, message: "الزبون رفض هذا الطلب عبر الرابط، لا يمكن تسجيل التسليم." });
  }

  const prev = t.outcome;
  if (prev && Date.now() - Date.parse(prev.at) > OUTCOME_EDIT_WINDOW_MS) {
    return res.status(409).json({ success: false, message: "انتهت مهلة تعديل النتيجة (24 ساعة)." });
  }

  const kind = status === "delivered" ? "ok" : OUTCOME_REASONS[reason].penalizing ? "ko" : null;

  const scores = readJson(scoresFile);
  if (prev && prev.counted) adjustScores(scores, t, prev.counted, -1); // annule l'ancien résultat
  if (kind) adjustScores(scores, t, kind, +1);

  const nowIso = new Date().toISOString();
  t.outcome = { status, reason, counted: kind, at: prev ? prev.at : nowIso, updatedAt: nowIso };

  writeJson(scoresFile, scores);
  writeJson(transactionsFile, transactions);
  res.json({ success: true, outcome: outcomeView(t.outcome) });
});

/* ------------------------------------------------------------------ */
/* Liste d'appels ciblée                                               */
/* ------------------------------------------------------------------ */

// Résultat d'un appel passé par le vendeur
//  confirmed  : le client confirme la commande par téléphone
//  refused    : le client annule / refuse
//  no_answer  : le client ne répond pas
//  call_later : le client demande à être rappelé plus tard
const CALL_RESULTS = ["confirmed", "refused", "no_answer", "call_later"];
const NO_RESPONSE_DEFAULT_HOURS = 3;

// Date de création : champ createdAt, ou ancien identifiant = Date.now()
function createdMs(t) {
  const fromField = Date.parse(t.createdAt);
  if (Number.isFinite(fromField)) return fromField;
  return /^\d{10,}$/.test(String(t.transactionId)) ? Number(t.transactionId) : NaN;
}

function callsSummary(t) {
  const calls = Array.isArray(t.calls) ? t.calls : [];
  const last = calls.length ? calls[calls.length - 1] : null;
  return { count: calls.length, last: last ? { at: last.at, result: last.result } : null };
}

// Commandes à appeler :
//  - « no_response » : lien envoyé, jamais confirmé ni refusé, depuis au moins `hours` heures
//  - « risky »       : client dont la note est « غير موثوق » (commande pas encore livrée)
// Query : ?hours=3 (1 à 168). Une commande déjà reconfirmée par téléphone n'est plus listée au titre du risque.
app.get("/call-list/:sellerId", requireSeller, (req, res) => {
  const sellerId = req.sellerId; // l'identifiant de l'URL est ignoré : seule la session compte
  const hours = Math.min(Math.max(Number(req.query.hours) || NO_RESPONSE_DEFAULT_HOURS, 1), 168);
  if (!SELLER_ID_RE.test(sellerId)) return res.json({ success: true, hours, items: [] });

  const scores = readJson(scoresFile);
  const now = Date.now();
  const items = [];

  for (const t of readJson(transactionsFile)) {
    if (t.sellerId !== sellerId || t.refused || t.outcome) continue;

    const created = createdMs(t);
    const ageHours = Number.isFinite(created) ? (now - created) / 3600000 : null;
    const info = scoreInfo(scores.clients[t.clientPhone]);

    const noResponse = !t.confirmed && ageHours !== null && ageHours >= hours;
    const risky = info.status === "risky";
    if (!noResponse && !risky) continue;

    const summary = callsSummary(t);
    if (!noResponse && summary.last && summary.last.result === "confirmed") continue; // déjà vérifié par téléphone

    items.push({
      transactionId: t.transactionId,
      clientName: t.clientName,
      clientPhone: t.clientPhone,
      productRef: t.productRef,
      amount: t.amount,
      createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
      ageHours: ageHours === null ? null : Math.floor(ageHours),
      confirmed: !!t.confirmed,
      reasons: [noResponse ? "no_response" : null, risky ? "risky" : null].filter(Boolean),
      client: { status: info.status, score: info.score, badge: info.badge, ok: info.ok, ko: info.ko, total: info.total },
      calls: summary,
    });
  }

  // D'abord les cas cumulant les deux raisons, puis les clients à risque, puis les plus anciens sans réponse
  const rank = (i) => (i.reasons.length === 2 ? 0 : i.reasons[0] === "risky" ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || (b.ageHours || 0) - (a.ageHours || 0));

  res.json({ success: true, hours, items });
});

// Corps JSON : { sellerId, result: "confirmed" | "refused" | "no_answer" | "call_later" }
app.post("/transaction/:id/call", requireSeller, outcomeLimiter, (req, res) => {
  const id = req.params.id;
  const sellerId = req.sellerId;
  const result = (req.body || {}).result;

  if (!TRANSACTION_ID_RE.test(id) || typeof sellerId !== "string" || !SELLER_ID_RE.test(sellerId)) {
    return res.status(400).json({ success: false, message: "طلب غير صالح." });
  }
  if (!CALL_RESULTS.includes(result)) {
    return res.status(400).json({ success: false, message: "نتيجة الاتصال غير صالحة." });
  }

  const transactions = readJson(transactionsFile);
  const t = transactions.find((x) => x.transactionId === id);
  if (!t || t.sellerId !== sellerId) {
    return res.status(404).json({ success: false, message: "المعاملة غير موجودة." });
  }
  if (t.outcome) {
    return res.status(409).json({ success: false, message: "تم تسجيل نتيجة التسليم، لا يمكن تعديل هذا الطلب." });
  }
  if (result === "confirmed" && t.refused) {
    return res.status(409).json({ success: false, message: "الزبون رفض هذا الطلب مسبقا." });
  }

  const nowIso = new Date().toISOString();
  if (result === "confirmed" && !t.confirmed) {
    t.confirmed = true;
    t.confirmationDate = nowIso;
    t.confirmedBy = "phone";
  }
  if (result === "refused" && !t.refused) {
    t.refused = true;
    t.refusalDate = nowIso;
    t.refusedBy = "phone";
    t.confirmed = false;
  }

  t.calls = (Array.isArray(t.calls) ? t.calls : []).concat({ at: nowIso, result }).slice(-20);
  writeJson(transactionsFile, transactions);

  res.json({ success: true, confirmed: !!t.confirmed, refused: !!t.refused, calls: callsSummary(t) });
});

// NB : tant qu'il n'y a pas de vraie connexion vendeur, le sellerId joue le rôle de mot de passe.
app.get("/transactions/:sellerId", requireSeller, (req, res) => {
  const transactions = readJson(transactionsFile)
    .filter((t) => t.sellerId === req.sellerId)
    .map((t) => ({ ...t, outcome: outcomeView(t.outcome) }));
  res.json({ success: true, transactions });
});

app.get("/admin/dashboard/:sellerId", requireSeller, (req, res) => {
  const sellerId = req.sellerId;
  if (!SELLER_ID_RE.test(sellerId)) {
    return res.json({ success: true, stats: { total: 0, confirmed: 0, delivered: 0, returned: 0, awaiting: 0, refused: 0, pending: 0 }, clients: {}, transactions: [] });
  }

  const transactions = readJson(transactionsFile).filter((t) => t.sellerId === sellerId);
  const scores = readJson(scoresFile);
  const delivered = transactions.filter((t) => t.outcome && t.outcome.status === "delivered").length;
  const returned = transactions.filter((t) => t.outcome && t.outcome.status === "returned").length;
  const awaiting = transactions.filter((t) => t.confirmed && !t.outcome).length;
  const refused = transactions.filter((t) => t.refused).length;
  const pending = transactions.filter((t) => !t.confirmed && !t.refused && !t.outcome).length;
  const sellerScores = scores.vendeurs[sellerId] || { clients: {} };
  const clients = {};
  for (const phone in sellerScores.clients) {
    const info = scoreInfo(scores.clients[phone]);
    clients[phone] = {
      delivered: sellerScores.clients[phone].ok || 0,
      returned: sellerScores.clients[phone].ko || 0,
      score: info.score, // null si pas assez d'historique
      status: info.status,
      badge: info.badge,
    };
  }
  res.json({
    success: true,
    stats: { total: transactions.length, confirmed: transactions.filter((t) => t.confirmed).length, delivered, returned, awaiting, refused, pending },
    clients,
    transactions: transactions.map((t) => ({ ...t, outcome: outcomeView(t.outcome) })),
  });
});

// --- Global Admin Route : protégée par ADMIN_TOKEN ---
app.get("/admin/global-data", adminLimiter, requireAdmin, (req, res) => {
  try {
    const transactions = readJson(transactionsFile);
    const sellersData = {};
    let totalConfirmed = 0;
    let totalRefused = 0;
    let totalPending = 0;
    let totalDelivered = 0;
    let totalReturned = 0;

    transactions.forEach((t) => {
      const sId = t.sellerId || "inconnu";
      if (!sellersData[sId]) {
        sellersData[sId] = { transactions: [] };
      }
      sellersData[sId].transactions.push(t);
      if (t.confirmed) totalConfirmed++;
      else if (t.refused) totalRefused++;
      else totalPending++;
      if (t.outcome && t.outcome.status === "delivered") totalDelivered++;
      if (t.outcome && t.outcome.status === "returned") totalReturned++;
    });

    res.json({
      success: true,
      sellersCount: Object.keys(sellersData).length,
      totalConfirmed,
      totalRefused,
      totalPending,
      totalDelivered,
      totalReturned,
      sellersData,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Confirmi port ${PORT}`));

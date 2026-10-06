const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { normalizeClientPhone } = require("./phone");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "frontend")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const transactionsFile = path.join(__dirname, "transactions.json");
const scoresFile = path.join(__dirname, "scores.json");

function ensureFile(file, defaultContent) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim() === "") {
    fs.writeFileSync(file, JSON.stringify(defaultContent, null, 2));
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

function migratePhoneData() {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, "utf8"));
  const originalTransactions = JSON.stringify(transactions);
  for (const transaction of transactions) {
    const normalized = normalizeClientPhone(transaction.clientPhone);
    if (normalized) transaction.clientPhone = normalized;
  }
  if (JSON.stringify(transactions) !== originalTransactions) {
    fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  }

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

migratePhoneData();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = "uploads";
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    }
  })
});

function computeScore(obj) {
  if (!obj) return 0;
  const total = (obj.ok || 0) + (obj.ko || 0);
  if (total === 0) return 0;
  return Math.round((obj.ok / total) * 100);
}

function badge(score) {
  if (score >= 80) return "🟢 موثوق";
  if (score >= 50) return "🟠 متوسط";
  return "🔴 غير موثوق";
}

app.get("/score/client/:phone", (req, res) => {
  const clientPhone = normalizeClientPhone(req.params.phone);
  if (!clientPhone) {
    return res.status(400).json({
      success: false,
      message: "Numéro invalide : indiquez 05, 06 ou 07 suivi de 8 chiffres, ou le même numéro avec l’indicatif +213."
    });
  }

  const scores = JSON.parse(fs.readFileSync(scoresFile, 'utf8'));
  const client = scores.clients[clientPhone] || { ok: 0, ko: 0 };
  const score = computeScore(client);
  res.json({ success: true, clientPhone, score, badge: badge(score) });
});

app.post("/create-confirmation", upload.single("productPhoto"), (req, res) => {
  const { clientName, clientPhone: rawClientPhone, productRef, amount, description, sellerId } = req.body;
  if (!clientName || !rawClientPhone || !productRef || !amount || !sellerId)
    return res.status(400).json({ success: false, message: "Champs obligatoires manquants." });

  const clientPhone = normalizeClientPhone(rawClientPhone);
  if (!clientPhone) {
    return res.status(400).json({
      success: false,
      message: "Numéro invalide : indiquez 05, 06 ou 07 suivi de 8 chiffres, ou le même numéro avec l’indicatif +213."
    });
  }

  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
  const transactionId = Date.now().toString();
  const transaction = {
    transactionId, sellerId, clientName, clientPhone, productRef, amount, description,
    photo: req.file ? "/uploads/" + req.file.filename : null,
    confirmed: false
  };

  transactions.push(transaction);
  fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  res.json({
    success: true,
    clientPhone,
    clientLink: `${protocol}://${req.headers.host}/client.html?id=${transactionId}`
  });
});

app.get("/transaction/:id", (req, res) => {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
  const t = transactions.find(x => x.transactionId === req.params.id);
  if (!t) return res.json({ success: false });
  res.json({ success: true, transaction: t });
});

app.post("/confirm-transaction/:id", upload.single("attachment"), (req, res) => {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
  const scores = JSON.parse(fs.readFileSync(scoresFile, 'utf8'));
  const t = transactions.find(x => x.transactionId === req.params.id);
  if (!t || t.confirmed || t.refused) return res.json({ success: false });

  t.confirmed = true;
  t.confirmationDate = new Date().toISOString();
  if (req.file) {
    t.attachment = "/uploads/" + req.file.filename;
  }
  // Update global client score
  const clientPhone = normalizeClientPhone(t.clientPhone) || t.clientPhone;
  t.clientPhone = clientPhone;
  scores.clients[clientPhone] ??= { ok: 0, ko: 0 };
  scores.clients[clientPhone].ok++;

  scores.vendeurs[t.sellerId] ??= { clients: {} };
  scores.vendeurs[t.sellerId].clients[clientPhone] ??= { ok: 0, ko: 0 };
  scores.vendeurs[t.sellerId].clients[clientPhone].ok++;

  fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
  res.json({ success: true });
});

app.post("/refuse-transaction/:id", (req, res) => {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
  const scores = JSON.parse(fs.readFileSync(scoresFile, 'utf8'));
  const t = transactions.find(x => x.transactionId === req.params.id);
  if (!t || t.confirmed || t.refused) return res.json({ success: false });

  t.refused = true;
  t.refusalDate = new Date().toISOString();

  // Update global client score (penalty)
  const clientPhone = normalizeClientPhone(t.clientPhone) || t.clientPhone;
  t.clientPhone = clientPhone;
  scores.clients[clientPhone] ??= { ok: 0, ko: 0 };
  scores.clients[clientPhone].ko++;

  scores.vendeurs[t.sellerId] ??= { clients: {} };
  scores.vendeurs[t.sellerId].clients[clientPhone] ??= { ok: 0, ko: 0 };
  scores.vendeurs[t.sellerId].clients[clientPhone].ko++;

  fs.writeFileSync(transactionsFile, JSON.stringify(transactions, null, 2));
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
  res.json({ success: true });
});

app.get("/transactions/:sellerId", (req, res) => {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8'));
  res.json({ success: true, transactions: transactions.filter(t => t.sellerId === req.params.sellerId) });
});

app.get("/admin/dashboard/:sellerId", (req, res) => {
  const transactions = JSON.parse(fs.readFileSync(transactionsFile, 'utf8')).filter(t => t.sellerId === req.params.sellerId);
  const scores = JSON.parse(fs.readFileSync(scoresFile, 'utf8'));
  const sellerScores = scores.vendeurs[req.params.sellerId] || { clients: {} };
  const clients = {};
  for (const phone in sellerScores.clients) {
    const globalClient = scores.clients[phone] || { ok: 0, ko: 0 };
    const s = computeScore(globalClient);
    clients[phone] = { confirmed: sellerScores.clients[phone].ok, score: s, badge: badge(s) };
  }
  res.json({ success: true, stats: { total: transactions.length, confirmed: transactions.filter(t => t.confirmed).length }, clients, transactions });
});

// --- Global Admin Route ---
app.get("/admin/global-data", (req, res) => {
  try {
    const transactions = JSON.parse(fs.readFileSync(transactionsFile, "utf8"));
    const sellersData = {};
    let totalConfirmed = 0;
    let totalRefused = 0;
    let totalPending = 0;

    transactions.forEach((t) => {
      const sId = t.sellerId || "inconnu";
      if (!sellersData[sId]) {
        sellersData[sId] = { transactions: [] };
      }
      sellersData[sId].transactions.push(t);
      if (t.confirmed) totalConfirmed++;
      else if (t.refused) totalRefused++;
      else totalPending++;
    });

    res.json({
      success: true,
      sellersCount: Object.keys(sellersData).length,
      totalConfirmed,
      totalRefused,
      totalPending,
      sellersData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Confirmi port ${PORT}`));

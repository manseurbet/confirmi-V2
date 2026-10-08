/*
 * detect-orders.js
 * Détection automatique des colonnes + normalisation des numéros algériens
 * pour l'import de commandes collées depuis Google Sheets (ou Excel).
 * Sans dépendance. Fonctionne dans Node (require) et dans le navigateur (window.DetectOrders).
 *
 * Utilisation :
 *   const { detectOrders } = require('./detect-orders');     // Node
 *   const r = DetectOrders.detectOrders(texteCollé);          // navigateur
 *
 *   r.orders      -> toutes les lignes (valides ou non), avec errors[] / warnings[]
 *   r.valid       -> lignes prêtes à envoyer
 *   r.invalid     -> lignes à afficher en rouge avec la raison
 *   r.mapping     -> { name, phone, product, price, description } = index de colonne ou null
 *   r.needsReview -> true : afficher les listes déroulantes « Modifier les colonnes »
 *
 * Correction manuelle (le vendeur a modifié une colonne) :
 *   detectOrders(texte, { product: 3, price: 2 })   // remplace seulement ces champs
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DetectOrders = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Marques invisibles (RTL, etc.) que l'on récupère souvent en copiant du texte arabe
  var INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
  var LETTERS = /[A-Za-z\u00C0-\u024F\u0600-\u06FF]/;

  function clean(s) {
    return String(s == null ? '' : s).replace(INVISIBLE, '').replace(/\u00A0/g, ' ').trim();
  }

  // Chiffres arabo-indiens (٠١٢…) et persans (۰۱۲…) -> chiffres ASCII
  function toAsciiDigits(s) {
    return s
      .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
  }

  /* ------------------------------------------------------------------ */
  /* Téléphone                                                           */
  /* ------------------------------------------------------------------ */

  // Accepte : 0555 12 34 56 | 0555-12-34-56 | +213 555 12 34 56 | +213 (0)555... |
  //           00213555... | 213555... | 555123456 (zéro perdu par Sheets) | chiffres arabes
  // Retourne { ok, phone:'0555123456', whatsapp:'213555123456' } ou { ok:false, reason }
  function normalizePhone(raw) {
    var s = toAsciiDigits(clean(raw));
    if (!s) return { ok: false, reason: 'phone_empty' };
    s = s.split(/[\/;,|]/)[0];               // "0555.../0661..." -> on garde le premier
    if (LETTERS.test(s)) return { ok: false, reason: 'phone_has_letters' };
    s = s.replace(/\.0+$/, '');              // "555123456.0" venant d'un tableur
    var d = s.replace(/\D/g, '');
    if (!d) return { ok: false, reason: 'phone_empty' };

    if (d.indexOf('00213') === 0) d = d.slice(5);
    else if (d.indexOf('213') === 0 && d.length >= 11) d = d.slice(3);

    if (d.length === 9 && /^[567]/.test(d)) d = '0' + d;   // zéro initial perdu

    if (/^0[567]\d{8}$/.test(d)) {
      return { ok: true, phone: d, whatsapp: '213' + d.slice(1) };
    }
    if (/^0[2-4]\d{7}$/.test(d)) return { ok: false, reason: 'phone_landline' }; // fixe : pas de WhatsApp
    if (d.length < 9) return { ok: false, reason: 'phone_too_short' };
    if (d.length > 10) return { ok: false, reason: 'phone_too_long' };
    return { ok: false, reason: 'phone_invalid_prefix' };
  }

  // Sert uniquement à repérer la colonne téléphone (même si certains numéros sont faux)
  function looksLikePhone(cell) {
    var s = toAsciiDigits(clean(cell));
    if (!s || LETTERS.test(s)) return false;
    var n = s.replace(/\D/g, '').length;
    return n >= 8 && n <= 14;
  }

  /* ------------------------------------------------------------------ */
  /* Prix                                                                */
  /* ------------------------------------------------------------------ */

  // "12000" | "12 000" | "12.000" | "12,000" | "12000 DA" | "12000 دج" -> 12000
  function parsePrice(cell) {
    var s = toAsciiDigits(clean(cell)).toLowerCase();
    if (!s) return null;
    s = s.replace(/(dzd|dinars?|دينار|د\.ج|دج|da)/g, '').replace(/[\s_]/g, '').replace(/-+$/, '');
    if (!/^\d[\d.,]*$/.test(s)) return null;
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
    else s = s.replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : null;
  }

  /* ------------------------------------------------------------------ */
  /* En-têtes                                                            */
  /* ------------------------------------------------------------------ */

  var HEADER_KEYWORDS = [
    ['phone', ['هاتف', 'الهاتف', 'تلفون', 'التلفون', 'نقال', 'phone', 'tel', 'mobile', 'portable', 'gsm']],
    ['price', ['سعر', 'السعر', 'ثمن', 'مبلغ', 'المبلغ', 'prix', 'price', 'montant', 'total']],
    ['product', ['منتج', 'المنتج', 'سلعة', 'produit', 'product', 'article', 'item']],
    ['name', ['اسم', 'الاسم', 'الزبون', 'زبون', 'العميل', 'nom', 'name', 'client', 'customer']],
    ['description', ['وصف', 'الوصف', 'ملاحظة', 'ملاحظات', 'عنوان', 'العنوان', 'ولاية', 'الولاية',
                     'description', 'note', 'notes', 'adresse', 'address', 'wilaya', 'commune']]
  ];

  function normHeader(h) {
    return clean(h).toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')              // tashkeel
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // accents latins
  }

  function matchHeader(h) {
    var t = normHeader(h);
    if (!t) return null;
    for (var i = 0; i < HEADER_KEYWORDS.length; i++) {
      var kws = HEADER_KEYWORDS[i][1];
      for (var j = 0; j < kws.length; j++) if (t.indexOf(kws[j]) !== -1) return HEADER_KEYWORDS[i][0];
    }
    return null;
  }

  function detectHeader(rows) {
    if (!rows.length) return false;
    var first = rows[0].map(clean);
    if (first.some(looksLikePhone)) return false;
    if (first.filter(matchHeader).length >= 2) return true;
    var rest = rows.slice(1);
    if (!rest.length) return false;
    var withPhone = rest.filter(function (r) { return r.some(looksLikePhone); }).length;
    return withPhone / rest.length >= 0.5;
  }

  /* ------------------------------------------------------------------ */
  /* Lecture du texte collé                                              */
  /* ------------------------------------------------------------------ */

  function splitBy(line, delim) {
    var parts = delim === null ? [line] : line.split(delim);
    return parts.map(function (c) {
      return clean(c).replace(/^"([\s\S]*)"$/, '$1').trim();
    });
  }

  function chooseDelimiter(lines) {
    var candidates = ['\t', ';', ',', /\s{2,}/];
    for (var i = 0; i < candidates.length; i++) {
      var counts = lines.map(function (l) { return splitBy(l, candidates[i]).length; });
      var freq = {}, mode = 0, best = 0;
      counts.forEach(function (c) { freq[c] = (freq[c] || 0) + 1; if (freq[c] > best) { best = freq[c]; mode = c; } });
      if (mode >= 2 && best / counts.length >= 0.8) return candidates[i];
    }
    return null;
  }

  // Google Sheets copie en séparant les colonnes par des tabulations
  function parsePaste(text) {
    var entries = String(text == null ? '' : text).split(/\r\n|\n|\r/)
      .map(function (t, i) { return { no: i + 1, text: t.replace(INVISIBLE, '') }; })
      .filter(function (e) { return e.text.trim() !== ''; });
    var delim = chooseDelimiter(entries.map(function (e) { return e.text; }));
    var rows = entries.map(function (e) { return { no: e.no, cells: splitBy(e.text, delim) }; });
    return { rows: rows, delimiter: delim === null ? null : (delim === '\t' ? 'tab' : String(delim)) };
  }

  /* ------------------------------------------------------------------ */
  /* Détection des colonnes                                              */
  /* ------------------------------------------------------------------ */

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.floor(s.length / 2)];
  }

  function detectMapping(rows) {
    var mapping = { name: null, phone: null, product: null, price: null, description: null };
    var warnings = [];
    var nCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    if (!nCols) return { mapping: mapping, hasHeader: false, warnings: ['empty_input'] };

    var hasHeader = detectHeader(rows);
    var body = hasHeader ? rows.slice(1) : rows;

    var cols = [];
    for (var c = 0; c < nCols; c++) {
      var cells = body.map(function (r) { return clean(r[c]); }).filter(Boolean);
      var n = cells.length;
      var prices = cells.map(parsePrice);
      var nums = prices.filter(function (p) { return p !== null; });
      cols.push({
        index: c, n: n,
        phoneRatio: n ? cells.filter(looksLikePhone).length / n : 0,
        numericRatio: n ? nums.length / n : 0,
        textRatio: n ? cells.filter(function (x) { return LETTERS.test(x); }).length / n : 0,
        median: median(nums),
        uniq: n ? new Set(cells).size / n : 0
      });
    }

    var used = {};
    function assign(field, idx) {
      if (mapping[field] === null && idx !== null && idx !== undefined && !used[idx]) {
        mapping[field] = idx; used[idx] = true;
      }
    }

    // 1) Téléphone : toujours par le contenu (le plus fiable)
    var bestPhone = null;
    cols.forEach(function (k) {
      if (k.phoneRatio >= 0.5 && (bestPhone === null || k.phoneRatio > cols[bestPhone].phoneRatio)) bestPhone = k.index;
    });
    assign('phone', bestPhone);
    if (bestPhone === null) warnings.push('no_phone_column');

    // 2) En-têtes (si présents) pour nom / produit / prix / description
    if (hasHeader) {
      rows[0].forEach(function (h, idx) {
        if (used[idx]) return;
        var f = matchHeader(h);
        if (!f || f === 'phone') return;
        if (f === 'price' && cols[idx].numericRatio < 0.5) return;
        assign(f, idx);
      });
    }

    // 3) Prix par le contenu : colonne numérique avec la plus grande valeur médiane
    if (mapping.price === null) {
      var cand = cols.filter(function (k) {
        return !used[k.index] && k.numericRatio >= 0.6 && k.phoneRatio < 0.3;
      });
      if (cand.length > 1) warnings.push('several_numeric_columns');
      cand.sort(function (a, b) { return b.median - a.median; });
      if (cand.length) assign('price', cand[0].index);
    }

    // 4) Colonnes de texte restantes : nom, produit, description (dans l'ordre)
    var textCols = cols.filter(function (k) { return !used[k.index] && k.textRatio >= 0.5; })
                       .map(function (k) { return k.index; });
    // Sans en-tête : une colonne très répétitive suivie d'une colonne variée = produit puis nom
    if (!hasHeader && body.length >= 4 && textCols.length >= 2 &&
        cols[textCols[0]].uniq <= 0.5 && cols[textCols[1]].uniq >= 0.8) {
      textCols = [textCols[1], textCols[0]].concat(textCols.slice(2));
    }
    ['name', 'product', 'description'].forEach(function (f) {
      if (mapping[f] === null && textCols.length) assign(f, textCols.shift());
    });

    return { mapping: mapping, hasHeader: hasHeader, warnings: warnings };
  }

  /* ------------------------------------------------------------------ */
  /* Construction des commandes                                          */
  /* ------------------------------------------------------------------ */

  // Clé utile côté serveur pour éviter de recréer une commande déjà importée
  // (à combiner avec l'identifiant du vendeur et une fenêtre de temps, ex. 48 h)
  function makeOrderKey(o) {
    return [o.phone, String(o.product || '').toLowerCase().replace(/\s+/g, ' ').trim(),
            o.price == null ? '' : o.price].join('|');
  }

  function buildOrders(rows, mapping, hasHeader) {
    var body = hasHeader ? rows.slice(1) : rows;
    var seen = {};
    return body.map(function (r) {
      function get(f) { return mapping[f] === null || mapping[f] === undefined ? '' : clean(r.cells[mapping[f]]); }
      var errors = [], warnings = [];
      var ph = mapping.phone === null || mapping.phone === undefined
        ? { ok: false, reason: 'phone_column_missing' }
        : normalizePhone(get('phone'));
      if (!ph.ok) errors.push(ph.reason);

      var price = null, rawPrice = get('price');
      if (rawPrice) { price = parsePrice(rawPrice); if (price === null) warnings.push('price_unreadable'); }

      var order = {
        line: r.no,
        name: get('name'),
        phone: ph.ok ? ph.phone : null,
        whatsapp: ph.ok ? ph.whatsapp : null,
        rawPhone: get('phone'),
        product: get('product'),
        price: price,
        description: get('description'),
        errors: errors, warnings: warnings
      };
      if (ph.ok) {
        var key = makeOrderKey(order);
        if (seen[key]) errors.push('duplicate_in_paste'); else seen[key] = true;
      }
      order.valid = errors.length === 0;
      return order;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Point d'entrée                                                      */
  /* ------------------------------------------------------------------ */

  function detectOrders(text, overrideMapping) {
    var parsed = parsePaste(text);
    var det = detectMapping(parsed.rows.map(function (r) { return r.cells; }));
    var mapping = Object.assign({}, det.mapping, overrideMapping || {});
    var orders = buildOrders(parsed.rows, mapping, det.hasHeader);
    var valid = orders.filter(function (o) { return o.valid; });
    var invalid = orders.filter(function (o) { return !o.valid; });
    return {
      delimiter: parsed.delimiter,
      hasHeader: det.hasHeader,
      mapping: mapping,
      warnings: det.warnings,
      needsReview: mapping.phone === null || (orders.length > 0 && valid.length / orders.length < 0.5),
      orders: orders, valid: valid, invalid: invalid,
      stats: { total: orders.length, valid: valid.length, invalid: invalid.length }
    };
  }

  return {
    detectOrders: detectOrders,
    parsePaste: parsePaste,
    detectMapping: detectMapping,
    buildOrders: buildOrders,
    normalizePhone: normalizePhone,
    parsePrice: parsePrice,
    makeOrderKey: makeOrderKey
  };
});

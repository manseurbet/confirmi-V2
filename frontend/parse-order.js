/*
 * parse-order.js
 * Extrait les données d'UNE commande depuis un texte libre copié-collé
 * (message Facebook / Messenger / WhatsApp / Instagram, en arabe, darija ou français).
 *
 *   var r = ParseOrder.parseOrderText(texte);
 *   r.phone        -> '0556001122' (déjà normalisé) ou ''
 *   r.price        -> 4500 (nombre) ou null
 *   r.name         -> 'Karim Benali' ou ''
 *   r.product      -> 'فستان أحمر' ou ''
 *   r.description  -> 'العنوان: وهران' ou ''   (adresse / wilaya / commune)
 *   r.found        -> { name, phone, product, price, description } (booléens)
 *
 * Principe : le téléphone et le prix (suivi de DA / دج) se détectent de façon fiable ; le nom et le produit
 * seulement quand le message les annonce (« الاسم : », « Nom : », « اسمي … », « je veux … »). Rien n'est deviné
 * au hasard : ce qui manque est laissé vide pour que le vendeur le complète.
 * Aucune lecture de Facebook : le vendeur copie le texte lui-même.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./detect-orders'));
  else root.ParseOrder = factory(root.DetectOrders);
})(typeof self !== 'undefined' ? self : this, function (DetectOrders) {
  'use strict';

  var INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

  function clean(text) {
    // 5000 caractères suffisent largement pour une commande (et bornent le travail des expressions régulières)
    return String(text == null ? '' : text).replace(INVISIBLE, '').replace(/\u00A0/g, ' ').slice(0, 5000);
  }

  /* ---------------- téléphone ---------------- */

  // 05/06/07 + 8 chiffres (séparateurs tolérés), ou +213 / 00213 / 213 (avec éventuellement le 0 entre parenthèses)
  // (dernière alternative : numéro de 9 chiffres collés dont le 0 initial a été perdu)
  var PHONE_RE = /(?:(?:\+|00)?213[ .\-]*\(?0?\)?[ .\-]*|0)[567](?:[ .\-]*\d){8}(?!\d)|[567]\d{8}(?!\d)/g;

  function findPhone(text) {
    var m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(text)) !== null) {
      var before = m.index > 0 ? text.charAt(m.index - 1) : '';
      if (/\d/.test(before)) { PHONE_RE.lastIndex = m.index + 1; continue; }   // début au milieu d'un nombre
      var n = DetectOrders.normalizePhone(m[0]);
      if (n.ok) return { phone: n.phone, start: m.index, end: m.index + m[0].length };
    }
    return null;
  }

  /* ---------------- prix ---------------- */

  var AMOUNT = '(\\d{1,3}(?:[ .,]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
  var UNIT = '(?:دج|د\\.ج|دينار|dzd|da|dinars?)';
  var PRICE_LABELED = new RegExp('(?:السعر|الثمن|ثمن|سعر|المبلغ|prix|montant|total|price)\\s*[:：=\\-]?\\s*' + AMOUNT, 'i');
  var PRICE_UNIT = new RegExp(AMOUNT + '\\s*' + UNIT + '(?![A-Za-z\\u0600-\\u06FF])', 'i');

  function findPrice(text) {
    var m = PRICE_LABELED.exec(text) || PRICE_UNIT.exec(text);
    if (!m) return null;
    return DetectOrders.parsePrice(m[0].replace(/^[^\d]+/, ''));   // on ne garde que « 12 000 DA »
  }

  /* ---------------- nom ---------------- */

  var NAME_LABELED = /(?:الاسم(?:\s+الكامل)?|اسم|nom(?:\s+et\s+pr[ée]nom)?|pr[ée]nom|name|الزبون|العميل|client)\s*[:：=\-]\s*([^\n\r,،;|]{2,40})/i;
  var NAME_INTRO = /(?:اسمي|je m['’]appelle|je me nomme|my name is)\s+([^\n\r,،;.|\d]{2,40})/i;
  // lignes qui ne sont manifestement pas un nom (fallback)
  var NOT_NAME = /(سلام|مرحبا|اهلا|أهلا|شكرا|شكراً|بارك|نحب|نبغي|بغيت|نريد|أريد|اريد|طلب|سعر|ثمن|عنوان|ولاية|هاتف|رقم|نمرة|bonjour|salut|salam|merci|svp|stp|veux|voudrais|commande|prix|adresse|wilaya|tel|t[ée]l|num[ée]ro|livraison|disponible|photo|aujourd|hier|مساء|صباح)/i;

  function tidyName(s) {
    s = s.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    return s.replace(/[\s\-:–]+$/, '');
  }

  function findName(text) {
    var m = NAME_LABELED.exec(text) || NAME_INTRO.exec(text);
    if (m) return tidyName(m[1]);

    // Sans annonce : on accepte une ligne seulement si elle est la SEULE à ressembler à un nom (2 ou 3 mots, sans chiffre)
    var candidates = text.split(/\n|\r/).map(function (l) { return l.trim(); }).filter(function (l) {
      if (!l || /\d/.test(l) || NOT_NAME.test(l)) return false;
      var words = l.split(/\s+/);
      return words.length >= 2 && words.length <= 3 && words.every(function (w) { return w.length >= 2 && w.length <= 15; }) &&
             /^[A-Za-z\u00C0-\u024F\u0600-\u06FF'’\-\s]+$/.test(l);
    });
    return candidates.length === 1 ? tidyName(candidates[0]) : '';
  }

  /* ---------------- produit ---------------- */

  var PRODUCT_LABELED = /(?:المنتج|منتج|السلعة|الموديل|produit|article|mod[eè]le|r[ée]f(?:[ée]rence)?|رمز|product)\s*[:：=\-]\s*([^\n\r|]{2,60})/i;
  var PRODUCT_WANT = /(?:نحب نطلب|نحب نشري|نحب|نبغي|بغيت|نريد|أريد|اريد|(?:je veux|je voudrais|je souhaite)(?:\s+(?:commander|acheter))?|commander)\s+(?:(?:les|une|un|des|la|le)\s+|l['’]\s*|ال)?([^\n\r,،.;|\d]{2,40})/i;
  // coupe le produit avant « à / pour / ب (le prix) » etc.
  var PRODUCT_CUT = /\s+(?:بـ|ب|بسعر|عند|من|à|a|pour|au prix|livraison|svp|stp|si possible)(?:\s|$).*$/i;

  function findProduct(text) {
    var m = PRODUCT_LABELED.exec(text);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
    m = PRODUCT_WANT.exec(text);
    if (m) return m[1].replace(PRODUCT_CUT, '').replace(/\s+/g, ' ').trim();
    return '';
  }

  /* ---------------- adresse / wilaya (-> description) ---------------- */

  var ADDRESS_RE = /(العنوان|الولاية|ولاية|البلدية|بلدية|adresse|wilaya|commune)\s*[:：=\-]\s*([^\n\r|]{2,60})/gi;
  var LIVRAISON_RE = /livraison\s+(?:à|a|vers)\s+([^\n\r,.;|\d]{2,30})/i;

  function findDescription(text) {
    var parts = [], m;
    ADDRESS_RE.lastIndex = 0;
    while ((m = ADDRESS_RE.exec(text)) !== null && parts.length < 3) {
      parts.push(m[1] + ': ' + m[2].replace(/\s+/g, ' ').trim());
    }
    if (!parts.length) {
      m = LIVRAISON_RE.exec(text);
      if (m) parts.push('Livraison: ' + m[1].replace(/\s+/g, ' ').trim());
    }
    return parts.join(' — ');
  }

  /* ---------------- point d'entrée ---------------- */

  function parseOrderText(raw) {
    var text = clean(raw);
    var ph = findPhone(text);
    // le numéro est retiré du texte avant de chercher le prix (il ne doit pas être pris pour un montant)
    var rest = ph ? text.slice(0, ph.start) + ' ' + text.slice(ph.end) : text;

    var price = findPrice(rest);
    var out = {
      phone: ph ? ph.phone : '',
      price: price === null || price === undefined ? null : price,
      name: findName(rest),
      product: findProduct(rest),
      description: findDescription(rest)
    };
    out.found = {
      phone: !!out.phone,
      price: out.price !== null,
      name: !!out.name,
      product: !!out.product,
      description: !!out.description
    };
    return out;
  }

  return { parseOrderText: parseOrderText, findPhone: findPhone, findPrice: findPrice };
});

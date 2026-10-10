// Messages envoyés aux clients (WhatsApp / SMS), avec le nom de la boutique du vendeur connecté.
// Un seul endroit pour modifier les textes. Deux langues : darija algérienne (par défaut) et arabe simple.
(function (root) {
  var LANG_KEY = 'msgLang';
  var LANGS = { darija: 'دارجة جزائرية', arabic: 'عربية مبسطة' };

  function lang() {
    var l = localStorage.getItem(LANG_KEY);
    return LANGS[l] ? l : 'darija';
  }
  function setLang(l) {
    if (LANGS[l]) localStorage.setItem(LANG_KEY, l);
  }

  function shop() { return localStorage.getItem('shopName') || ''; }
  function phone() { return localStorage.getItem('shopPhone') || ''; }

  function money(v) {
    var n = Number(v);
    return isFinite(n) && v !== '' && v != null ? String(Math.round(n * 100) / 100) : '';
  }

  // Assemble les lignes non vides
  function join(lines) {
    return lines.filter(function (l) { return l; }).join('\n');
  }

  // « متجر النور » : on ajoute le mot « متجر » sauf si le nom commence déjà par un mot de ce genre
  function shopWithWord(name) {
    if (!name) return '';
    return /^(متجر|محل|مؤسسة|شركة|boutique|magasin|store|shop)(\s|$)/i.test(name) ? name : 'متجر ' + name;
  }

  function prepare(o) {
    o = o || {};
    var product = String(o.product || '').trim();
    var price = money(o.price);
    return {
      name: String(o.name || '').trim(),
      product: product,
      item: product + (product && price ? ' — ' : '') + (price ? price + ' دج' : ''),
      link: o.link || '',
      shop: shopWithWord(shop()),
      phone: phone()
    };
  }

  var T = {
    darija: {
      confirm: function (c) {
        return join([
          'السلام' + (c.name ? ' ' + c.name : '') + ' 👋',
          (c.shop ? 'معاك ' + c.shop + '. ' : '') + (c.item ? 'وصلنا طلبك: ' + c.item : 'وصلنا طلبك'),
          'باش نأكدو الطلب، كليكي هنا (دقيقة وحدة): ' + c.link,
          c.phone ? 'وإذا تحب تعيّط لينا: ' + c.phone : '',
          'شكراً على ثقتك 🌷'
        ]);
      },
      reminder: function (c) {
        return join([
          'السلام' + (c.name ? ' ' + c.name : '') + ' 👋' + (c.shop ? ' معاك ' + c.shop + '.' : ''),
          'نفكّرك بتأكيد طلبك' + (c.product ? ' (' + c.product + ')' : '') + ': ' + c.link,
          c.phone ? 'وإذا تحب تعيّط لينا: ' + c.phone : ''
        ]);
      },
      rating: function (c) {
        return join([
          'السلام' + (c.name ? ' ' + c.name : '') + '، شكراً على ثقتك 🌷',
          'كيف كانت تجربتك' + (c.shop ? ' مع ' + c.shop : '') + '؟ قيّمنا من هنا (ثواني برك): ' + c.link
        ]);
      }
    },
    arabic: {
      confirm: function (c) {
        return join([
          'السلام عليكم' + (c.name ? ' ' + c.name : '') + ' 👋',
          (c.shop ? 'معك ' + c.shop + '. ' : '') + (c.item ? 'وصلنا طلبك: ' + c.item : 'وصلنا طلبك'),
          'لتأكيد الطلب اضغط هنا (دقيقة واحدة): ' + c.link,
          c.phone ? 'وإذا كنت تفضّل الاتصال بنا: ' + c.phone : '',
          'شكراً لثقتك 🌷'
        ]);
      },
      reminder: function (c) {
        return join([
          'السلام عليكم' + (c.name ? ' ' + c.name : '') + ' 👋' + (c.shop ? ' معك ' + c.shop + '.' : ''),
          'نذكّرك بتأكيد طلبك' + (c.product ? ' (' + c.product + ')' : '') + ': ' + c.link,
          c.phone ? 'وإذا كنت تفضّل الاتصال بنا: ' + c.phone : ''
        ]);
      },
      rating: function (c) {
        return join([
          'السلام عليكم' + (c.name ? ' ' + c.name : '') + '، شكراً على ثقتك 🌷',
          'كيف كانت تجربتك' + (c.shop ? ' مع ' + c.shop : '') + '؟ قيّمنا من هنا (ثوانٍ فقط): ' + c.link
        ]);
      }
    }
  };

  // order = { name, product, price, link }
  function build(kind, order) { return T[lang()][kind](prepare(order)); }

  // SMS : le plus court possible (un SMS en arabe tient sur 70 caractères par segment, le lien seul en prend déjà beaucoup)
  function confirmSms(order) {
    var c = prepare(order);
    return (c.shop ? c.shop + ': ' : '') + 'لتأكيد طلبك' + (c.product ? ' (' + c.product + ')' : '') + ' اضغط: ' + c.link;
  }

  // Exemple pour les aperçus
  function sample() {
    return { name: 'كريم', product: 'فستان', price: 4500, link: location.origin + '/client.html?id=…' };
  }

  // Récupère le nom et le numéro de la boutique si le navigateur ne les a pas encore (session ouverte avant la mise à jour)
  function refresh() {
    if (shop() && phone()) return Promise.resolve();
    return fetch('/me')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.success) {
          localStorage.setItem('shopName', d.shopName || '');
          localStorage.setItem('shopPhone', d.phone || '');
        }
      })
      .catch(function () { /* hors ligne : on garde ce qu'on a */ });
  }

  root.Messages = {
    LANGS: LANGS,
    lang: lang,
    setLang: setLang,
    confirm: function (o) { return build('confirm', o); },
    reminder: function (o) { return build('reminder', o); },
    rating: function (o) { return build('rating', o); },
    confirmSms: confirmSms,
    sample: sample,
    refresh: refresh
  };

  refresh();
})(window);

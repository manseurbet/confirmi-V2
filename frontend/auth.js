// À inclure dans toutes les pages réservées aux vendeurs (avant leurs propres scripts).
// 1) pas de compte connecté -> page de connexion ; 2) le serveur répond « non connecté » -> page de connexion.
(function () {
  var onLogin = /login\.html$/.test(location.pathname);

  if (!onLogin && !localStorage.getItem('sellerId')) {
    location.replace('login.html');
    return;
  }

  var originalFetch = window.fetch.bind(window);
  window.fetch = async function () {
    var res = await originalFetch.apply(null, arguments);
    if (res.status === 401 && !onLogin) {
      localStorage.removeItem('sellerId');
      location.replace('login.html');
    }
    return res;
  };
})();

async function logout() {
  try { await fetch('/logout', { method: 'POST' }); } catch (e) { /* hors ligne : on déconnecte quand même ici */ }
  localStorage.removeItem('sellerId');
  localStorage.removeItem('shopName');
  localStorage.removeItem('shopPhone');
  location.replace('login.html');
}

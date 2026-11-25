(function () {
  'use strict';
  // No platform URL: no SDK download, requests, listeners or authentication changes.
  var params = new URLSearchParams(location.search);
  if (!params.has('vk_app_id') && !params.has('sign') && !params.has('vk_client') && !params.has('social_launch')) return;
  var nativeFetch = window.fetch.bind(window), ticket = null, platform = null;
  var launch = location.search, storageKey = 'heroether.social-session.v1';
  function bounded(promise, milliseconds) {
    return new Promise(function (resolve,reject) {
      var timer=setTimeout(function(){reject(Error('Открой игру заново из социальной сети.'));},milliseconds);
      promise.then(function(value){clearTimeout(timer);resolve(value);},function(error){clearTimeout(timer);reject(error);});
    });
  }
  function sdk() {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timeout = setTimeout(function () { reject(Error('Не удалось связаться с площадкой. Открой игру заново.')); }, 15000);
      script.src = '/vendor/vk-bridge/browser.min.js';
      script.onload = function () { clearTimeout(timeout); resolve(window.vkBridge); };
      script.onerror = function () { clearTimeout(timeout); reject(Error('Не удалось загрузить игру. Попробуй ещё раз.')); };
      document.head.appendChild(script);
    });
  }
  var ready = sdk().then(function (bridge) {
    if (!bridge || !bridge.send) throw Error('Открой игру заново из социальной сети.');
    return bounded(bridge.send('VKWebAppInit', {}),15000).then(function () {
      if (params.has('social_launch') && !params.has('sign')) {
        var saved; try {saved=JSON.parse(sessionStorage.getItem(storageKey));} catch (_) {}
        if (!saved || !/^[a-f0-9]{64}$/.test(saved.ticket || '') || saved.expiresAt<=Date.now())
          throw Error('Открой игру заново из VK или Одноклассников.');
        ticket=saved.ticket;platform=saved.network;launch=null;
        return null;
      }
      return bounded(nativeFetch('/api/platform/session', { method:'POST', credentials:'omit', cache:'no-store',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({launch:launch}) }),15000);
    });
  }).then(function (response) {
    if (!response) return;
    return response.json().then(function (data) {
      if (!response.ok || !/^[a-f0-9]{64}$/.test(data.ticket || '')) throw Error(data.error || 'Не удалось войти в игру.');
      ticket = data.ticket; platform = data.network; launch = null;
      // Signed launch values must not leak via links, referrers or copied URLs.
      try {
        sessionStorage.setItem(storageKey,JSON.stringify({ticket:ticket,network:platform,expiresAt:data.expiresAt}));
        history.replaceState(null, '', location.pathname + '?social_launch=1' + location.hash);
      } catch (_) { /* Cookie/storage-blocking browsers still work until the page closes. */ }
    });
  });
  ready.catch(function () {});
  window.KillexSocial = Object.freeze({ ready:ready,
    network:function () {return platform;},
    socketProtocols:function () { return ticket ? ['killex-session.' + ticket] : []; }
  });
  window.fetch = function (input, options) {
    var url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/api/admin/') || url.pathname === '/api/service-status') return nativeFetch(input, options);
    return ready.then(function () {
      var headers = new Headers(options && options.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', 'Bearer ' + ticket);
      return nativeFetch(input, Object.assign({}, options, {headers:headers, credentials:'omit'}));
    });
  };
})();

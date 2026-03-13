// ================================================================
//  SERVICE WORKER — Operação Impacto PMESP
//  Versão: 1.0.0
//  Estratégia: Cache First para assets estáticos,
//              Network First para dados do Supabase
// ================================================================

const CACHE_NAME = 'impacto-v1';
const CACHE_STATIC = 'impacto-static-v1';
const CACHE_DYNAMIC = 'impacto-dynamic-v1';

// Arquivos que sempre ficam em cache (shell do app)
const STATIC_ASSETS = [
  '/operacao_impacto.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Exo+2:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ================================================================
// INSTALL — pré-carrega o shell do app
// ================================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      console.log('[SW] Cacheando assets estáticos');
      // Tenta cachear cada asset individualmente (não falha se um der erro)
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] Não cacheou:', url, e))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ================================================================
// ACTIVATE — limpa caches antigos
// ================================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC && key !== CACHE_DYNAMIC)
          .map(key => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ================================================================
// FETCH — estratégia híbrida
// ================================================================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase e APIs externas → Network First (dados sempre frescos)
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('supabase.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts → Cache First
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // CDN assets (xlsx, supabase-js) → Cache First
  if (url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('jsdelivr.net')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // App shell (HTML, manifest) → Network First com fallback offline
  if (url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.json') ||
      url.pathname === '/') {
    event.respondWith(networkFirstWithOfflineFallback(event.request));
    return;
  }

  // Demais → Network First
  event.respondWith(networkFirst(event.request));
});

// ================================================================
// ESTRATÉGIAS DE CACHE
// ================================================================

// Cache First: serve do cache, busca na rede só se não tiver
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    console.warn('[SW] Cache First falhou:', request.url);
    return new Response('Offline', { status: 503 });
  }
}

// Network First: tenta a rede, cai para cache se falhar
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_DYNAMIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Network First com página offline de fallback
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback: página offline embutida
    return new Response(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Operação Impacto — Offline</title>
        <style>
          body { background:#0a1628; color:#d0daf0; font-family:Arial,sans-serif;
                 display:flex; align-items:center; justify-content:center;
                 min-height:100vh; text-align:center; padding:2rem; }
          h1 { color:#c9a227; font-size:1.5rem; margin-bottom:1rem; }
          p  { color:#8a9bb5; line-height:1.6; }
          button { margin-top:1.5rem; background:#c9a227; color:#0a1628; border:none;
                   padding:0.75rem 2rem; font-weight:bold; font-size:1rem;
                   border-radius:4px; cursor:pointer; }
        </style>
      </head>
      <body>
        <div>
          <div style="font-size:3rem;margin-bottom:1rem">📡</div>
          <h1>Sem conexão</h1>
          <p>Você está offline.<br>Verifique sua conexão com a internet e tente novamente.</p>
          <button onclick="location.reload()">Tentar novamente</button>
        </div>
      </body>
      </html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// ================================================================
// MENSAGENS do app principal
// ================================================================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
});
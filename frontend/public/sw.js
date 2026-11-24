
const CACHE_NAME = 'order-audit-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    const response = await fetch('/index.html', {
      cache: 'reload'
    });

    if (!response.ok) {
      throw new Error('Application shell unavailable');
    }

    const html = await response.clone().text();

    const assets = [
      ...html.matchAll(
        /(?:src|href)=["'](\/assets\/[^"']+)["']/g
      )
    ].map(match => match[1]);

    await cache.addAll([
      ...new Set([
        '/favicon.svg',
        ...assets
      ])
    ]);

    await cache.put('/index.html', response);

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          key.startsWith('order-audit-shell-') &&
          key !== CACHE_NAME
        )
        .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Never cache API requests or authenticated data.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    request.headers.has('Authorization')
  ) {
    return;
  }

  // Support offline application navigation.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match('/index.html');

        return cached || new Response(
          'Application unavailable offline.',
          { status: 503 }
        );
      }
    })());

    return;
  }

  // Cache only static application assets.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/favicon.svg'
  ) {
    event.respondWith((async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      const response = await fetch(request);

      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }

      return response;
    })());
  }
});

// Service worker: omogućuje instalaciju aplikacije (PWA) i rad bez interneta.
//
// - Stranica (HTML), podaci (data/*.json) i API: prvo mreža, a bez interneta
//   zadnja spremljena verzija. Odgovor iz spremnika dobiva zaglavlje
//   X-Offline-Cache: 1, pa aplikacija može prikazati da je offline.
// - Spremanje izmjena (POST/DELETE) uvijek ide samo na mrežu.
// - Skripte, stilovi, ikone i Leaflet: brzo iz spremnika, u pozadini se osvježe.

var CACHE = 'vocnjak-v1';
var PRECACHE = [
    '/',
    '/manifest.webmanifest',
    '/garden.svg',
    '/icons/app/icon-192.png',
    '/icons/app/icon-512.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(PRECACHE); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

function markOffline(response) {
    var headers = new Headers(response.headers);
    headers.set('X-Offline-Cache', '1');
    return response.blob().then(function (body) {
        return new Response(body, { status: response.status, statusText: response.statusText, headers: headers });
    });
}

// cacheKey: uvijek ista adresa bez ?v=... parametara, da se spremnik ne puni kopijama.
function networkFirst(request, cacheKey) {
    return fetch(request)
        .then(function (response) {
            if (response.ok) {
                var copy = response.clone();
                caches.open(CACHE).then(function (cache) { cache.put(cacheKey, copy); });
            }
            return response;
        })
        .catch(function () {
            return caches.match(cacheKey).then(function (cached) {
                if (cached) return markOffline(cached);
                throw new Error('offline');
            });
        });
}

function staleWhileRevalidate(request) {
    return caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
            var network = fetch(request)
                .then(function (response) {
                    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
                    return response;
                })
                .catch(function () { return cached; });
            return cached || network;
        });
    });
}

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return; // spremanje izmjena uvijek ide na mrežu

    var url = new URL(request.url);
    var sameOrigin = url.origin === self.location.origin;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, '/'));
        return;
    }

    if (sameOrigin && (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/data/') === 0)) {
        event.respondWith(networkFirst(request, url.origin + url.pathname));
        return;
    }

    if (sameOrigin || url.hostname === 'unpkg.com') {
        event.respondWith(staleWhileRevalidate(request));
    }
});

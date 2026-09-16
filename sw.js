/* 업무 관리 - 서비스 워커
 *
 * 규칙
 *  1. 구글 인증/API 요청은 절대 가로채지 않는다 (캐시하면 인증이 깨진다).
 *  2. 앱 껍데기는 network-first: 항상 최신을 먼저 받고, 실패할 때만 캐시를 쓴다.
 *     -> 사용자가 옛 버전에 갇히지 않는다.
 *  3. 버전이 바뀌면 activate 에서 옛 캐시를 모두 지운다.
 */

var CACHE_VERSION = 'work-diary-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

// 가로채면 안 되는 호스트 (구글 로그인 / 구글 API / 구글 폰트)
function isGoogleHost(hostname) {
  return hostname === 'accounts.google.com' ||
         hostname === 'googleapis.com' ||
         hostname.indexOf('.googleapis.com') !== -1 ||
         hostname.indexOf('.gstatic.com') !== -1 ||
         hostname === 'apis.google.com';
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function(cache) { return cache.addAll(SHELL); })
      .catch(function() { /* 하나라도 못 받으면 그냥 넘어간다 */ })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys.map(function(key) {
          if (key !== CACHE_VERSION) return caches.delete(key);
          return null;
        }));
      })
      .then(function() { return self.clients.claim(); })
      .catch(function() {})
  );
});

self.addEventListener('message', function(event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function(event) {
  var req = event.request;

  // GET 이 아닌 요청은 건드리지 않는다
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 구글 인증 / 구글 API 는 무조건 그대로 통과 (맨 앞에서 차단)
  if (isGoogleHost(url.hostname)) return;

  // http/https 가 아니면 건드리지 않는다
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  var sameOrigin = (url.origin === self.location.origin);

  // 외부 라이브러리(SheetJS CDN)는 cache-first: 오프라인에서도 엑셀 내보내기가 되도록
  if (!sameOrigin) {
    if (url.hostname === 'cdn.sheetjs.com') {
      event.respondWith(
        caches.match(req).then(function(hit) {
          if (hit) return hit;
          return fetch(req).then(function(res) {
            if (res && (res.ok || res.type === 'opaque')) {
              var copy = res.clone();
              caches.open(CACHE_VERSION).then(function(c) { c.put(req, copy); }).catch(function() {});
            }
            return res;
          });
        }).catch(function() { return fetch(req); })
      );
    }
    return;
  }

  // 같은 출처(앱 껍데기): network-first, 실패하면 캐시
  event.respondWith(
    fetch(req)
      .then(function(res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function(c) { c.put(req, copy); }).catch(function() {});
        }
        return res;
      })
      .catch(function() {
        return caches.match(req).then(function(hit) {
          if (hit) return hit;
          // 페이지 이동 요청이면 시작 문서를 돌려준다
          if (req.mode === 'navigate') {
            return caches.match('./index.html').then(function(idx) {
              return idx || caches.match('./');
            });
          }
          return Response.error();
        });
      })
  );
});

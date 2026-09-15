/* BeatSight Service Worker（v1.4）——只被在线版（http/https）注册；file:// 下 index.html 不加载它。
   策略：
     · 导航请求（打开页面）走 network-first：线上更新后刷新即生效，不依赖手工 bump 缓存版本；
       断网时回退到缓存的 index.html（这就是「离线可用」的来源）。
     · 静态资源（manifest/icon）走 cache-first。
   CACHE 名字变了才清旧缓存——常规内容更新不需要动它（network-first 已经保证新内容先到）。 */
"use strict";
const CACHE = "beatsight-pwa-v1";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 只缓存同源 http(s) 的 GET 成功响应：错误页（500/404）入缓存会污染离线回退；
   跨源（opaque）响应与非 http(s) 请求（如 chrome-extension://）不该被长期钉死在缓存里，
   且 cache.put 对后者会直接抛错产生 unhandled rejection 噪音。
   （导航请求本就只可能是同源，只需校验 r.ok。） */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (!/^https?:$/.test(new URL(e.request.url).protocol)) return;
  if (e.request.mode === "navigate"){
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok){
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp));
        }
        return r;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.ok){
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
      }
      return resp;
    }))
  );
});

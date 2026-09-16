/* BeatSight Service Worker（v1.4）——只被在线版（http/https）注册；file:// 下 index.html 不加载它。
   策略：
     · 导航请求（打开页面）走 network-first：线上更新后刷新即生效，不依赖手工 bump 缓存版本；
       断网时回退到缓存的 index.html（这就是「离线可用」的来源）。
     · 静态资源（manifest/icon）走 **stale-while-revalidate**（v2.0.2，审计 D9）：先用缓存
       **立刻**响应，同时后台拉一次新版本写回缓存——下一次加载即可拿到新资源。
       此前是 cache-first，而 cache-first 的语义是"缓存里有就再也不问网络"，于是
       **只有 CACHE 名字变了才会清旧缓存**：图标 / 清单一旦更新，老用户会长期（可能永远）
       看到旧的那一份，除非发版恰好人手改了 CACHE。SWR 把"要不要更新"从
       "发版时记不记得 bump 一个常量"变成"下次加载自动收敛"，这正是本项要消灭的隐性依赖。
   CACHE 仍需在**资源策略本身变化**时 bump（如本次 v1 → v2）：activate 靠它清掉旧策略留下的缓存。
   常规内容更新不需要动它——导航 network-first 与资源 SWR 都已保证新内容最终会到。 */
"use strict";
const CACHE = "beatsight-pwa-v2";
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
  e.respondWith(staleWhileRevalidate(e.request));
});

/* stale-while-revalidate（v2.0.2，审计 D9）：缓存命中就立刻返回，同时后台拉新版本写回；
   未命中则等同 network-first 并顺手入缓存。
   两处 rejected Promise 必须显式兜住：
     · 后台那次 fetch 失败（离线）——若已经用缓存回过响应，它就是**无人 await 的悬空 Promise**，
       不吞掉会变成 unhandled rejection 噪音（与本文件开头对 opaque 响应的顾虑同源）；
     · cache.put 失败（配额满 / 私密模式）——同理只是"更新缓存"失败，不该影响已经发出的响应。
   顺序上先发起 revalidate 再查缓存：查缓存是异步的，先把网络请求发出去能少一个事件循环的等待。 */
function staleWhileRevalidate(req){
  const fresh = revalidate(req);
  return caches.match(req).then(cached => {
    if (cached){ fresh.catch(() => {}); return cached; }
    return fresh;
  });
}

function revalidate(req){
  return fetch(req).then(resp => {
    if (resp.ok){
      const cp = resp.clone();
      caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
    }
    return resp;
  });
}

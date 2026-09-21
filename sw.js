/* BeatSight Service Worker（CACHE=beatsight-pwa-v2）——只被在线版（http/https）注册；file:// 下 index.html 不加载它。
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
/* 关键资源：离线可用的底线，addAll 任一失败即 install 失败（宁可装不上，不可装个残的）。
   注意 PNG 图标**不在**此列——它们由 tools/gen-icons.js 在构建期生成、只存在于 dist/，
   仓库根的开发环境（以及任何没过 build-dist 的部署）里根本没有这两个文件 */
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];
/* 可选资源：PNG 图标回退（构建产物里有就预缓存，没有也不该拖垮 install）。
   v2.8.7（审计 §Q4）：跳过时会在控制台留一条 console.info，理由见下面 install 内的说明 */
const ASSETS_OPTIONAL = ["./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS).then(() =>
        /* 逐个加、各自吞错：一个图标 404 不该让整个 SW 装不上（离线能力是关键路径，图标不是）。
           ★ v2.8.7（审计 §Q4）：但"吞掉"不等于"不该说"。PNG 图标只由 tools/build-dist.js
           在构建期生成到 dist/，所以**仓库根的开发环境里它们必然 404**——于是"本地跑得对"
           与"线上跑得对"在这里并不等价，而此前的 `catch(() => {})` 把这件事完全掩盖了。
           补一条 console.info 记下**跳过的是哪一个**：不一致因此可见，而不是静默消失。
           用 info 而非 warn/error 是刻意的——这是**预期内**的正常情况（开发环境本来就没有
           这两个文件），用 warn 会让每次本地加载都出现黄色条目，很快就会被人无视。 */
        Promise.all(ASSETS_OPTIONAL.map(a => c.add(a).catch(() => {
          console.info("[beatsight/sw] 可选资源未预缓存（已跳过，不影响离线能力）：" + a
            + " —— PNG 图标只存在于构建产物 dist/，仓库根的开发环境没有它属正常");
        })))))
      .then(() => self.skipWaiting())
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

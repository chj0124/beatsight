/* BeatSight 自动化测试 · Service Worker（v2.4.4，消灭 sw.js 的零覆盖盲区）
   T67 系列。
   ---------------------------------------------------------------------------
   sw.js 此前是全仓唯一「零测试、零覆盖率」的运行时文件——而它的缓存策略一旦写错，
   症状是**全站旧版滞留**（用户永远拿到旧缓存），恰恰是最难发现的那类故障。

   测法：vm 沙箱执行 sw.js，桩出 self/caches/fetch/Promise 四件套。
   ★ Promise 用**同步实现**（SP，.then 立即执行回调）：SW 桩的所有异步源都是立即 resolve 的，
     换成同步 Promise 后事件语义不变、但整条 then 链同步跑完——用例不需要任何 async/await，
     与 harness 的同步断言口径一致（计数进同一个汇总）。

   钉住的契约：
     ① install 预缓存 ASSETS（含 ./index.html），随后 skipWaiting；
     ② activate 删除所有非当前 CACHE 名的旧缓存，随后 clients.claim；
     ③ 导航请求 network-first：成功（r.ok）→ 返回网络响应并顺手写缓存；
       失败 → 回退缓存的 ./index.html（离线可用的来源）；!r.ok 不写缓存（错误页不污染离线回退）；
     ④ 静态同源 GET → stale-while-revalidate：命中先回缓存、后台 revalidate 写回；
       未命中等同 network-first 并顺手入缓存；
     ⑤ 非 GET / 非 http(s) / 跨源请求一律不接管（不 respondWith、不写缓存）；
     ⑥ cache.put 失败不影响已发出的响应。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ok, eq, section } = require("../lib/harness");

/* 同步 Promise：then/catch 立即执行（本文件的桩不存在真异步），链式语义与真 Promise 对齐 */
class SP {
  constructor(v, rej){ this._v = v; this._rej = !!rej; }
  static resolve(v){ return v instanceof SP ? v : new SP(v); }
  static reject(e){ return new SP(e, true); }
  static all(arr){ return new SP(arr.map(x => (x instanceof SP ? x._v : x))); }
  then(f, r){
    if (this._rej){ return r ? SP.resolve(r(this._v)) : this; }
    if (!f) return this;
    try{ return SP.resolve(f(this._v)); }catch(e){ return SP.reject(e); }
  }
  catch(r){ return this.then(undefined, r); }
}

function loadSw(opt){
  opt = opt || {};
  const store = opt.store || {};                    // 缓存名 → Map(url → response)
  const log = { open: [], addAll: [], add: [], put: [], deleted: [], skipWaiting: 0, claim: 0 };
  const listeners = {};
  /* ★ 写入队列（同步 Promise 的时序修正）：真实浏览器里 revalidate 的 cache.put 落在
     **之后的微任务**，staleWhileRevalidate 的 caches.match 先读到的是**事件前的旧值**。
     同步 Promise（SP）下 put 会立即落盘，于是"命中旧缓存"被抢先改写、SWR 语义失真。
     所以 put 只登记不执行，由 fire() 在事件处理完后统一 flush——
     这才对齐真实时序：响应用的是事件前的缓存，写回发生在响应之后。 */
  const pendingWrites = [];

  const mkResp = (okFlag, tag) => ({
    ok: okFlag, _tag: tag,
    clone(){ return mkResp(okFlag, tag + "-clone"); },
  });

  const caches = {
    open(name){
      log.open.push(name);
      if (!store[name]) store[name] = new Map();
      return SP.resolve({
        addAll(arr){ log.addAll.push(arr.slice()); return SP.resolve(); },
        /* v2.4.4：可选资源逐个 c.add()——addFails 里的地址模拟 404 */
        add(u){ log.add.push(u); if ((opt.addFails || []).includes(u)) return SP.reject(new Error("404")); return SP.resolve(); },
        put(req, resp){
          log.put.push([typeof req === "string" ? req : req.url, resp._tag]);
          if (opt.putFails) return SP.reject(new Error("quota"));
          pendingWrites.push([name, typeof req === "string" ? req : req.url, resp]);
          return SP.resolve();
        },
      });
    },
    keys(){ return SP.resolve(Object.keys(store)); },
    delete(name){ log.deleted.push(name); return SP.resolve(true); },
    match(req){
      const url = typeof req === "string" ? req : req.url;
      for (const name of Object.keys(store)){
        if (store[name].has(url)) return SP.resolve(store[name].get(url));
      }
      return SP.resolve(undefined);
    },
  };

  const self = {
    location: { origin: "https://beatsight.example.workers.dev" },
    addEventListener(t, f){ listeners[t] = f; },
    skipWaiting(){ log.skipWaiting++; return SP.resolve(); },
    clients: { claim(){ log.claim++; return SP.resolve(); } },
  };

  const fetchImpl = opt.fetchImpl || (() => SP.resolve(mkResp(true, "net")));

  const sandbox = { self, caches, fetch: fetchImpl, URL, Promise: SP, console };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "sw.js"), "utf8");
  vm.runInContext(src, sandbox);

  /* 派发事件（全同步）：waitUntil/respondWith 收到的是 SP，立即取最终值；
     事件处理完后统一 flush 写入队列（对齐"写回发生在响应之后"的真实时序） */
  function fire(type, ev){
    const e = Object.assign({
      waitUntil(p){ e._wait = p instanceof SP ? p : SP.resolve(p); },
      respondWith(p){ e._resp = p instanceof SP ? p : SP.resolve(p); },
    }, ev);
    listeners[type](e);
    while (pendingWrites.length){
      const [name, url, resp] = pendingWrites.shift();
      store[name].set(url, resp);
    }
    return e;
  }
  const req = (url, o) => Object.assign({ url, method: "GET", mode: "cors" }, o);
  return { log, listeners, fire, req, store, mkResp };
}

const BASE = "https://beatsight.example.workers.dev";

section("T67 Service Worker · 安装与激活");
{ // ① install：预缓存 + skipWaiting
  const sw = loadSw();
  sw.fire("install", {});
  eq(sw.log.open[0], "beatsight-pwa-v2", "install 打开当前 CACHE 名");
  ok(sw.log.addAll[0] && sw.log.addAll[0].indexOf("./index.html") >= 0, "预缓存清单含 index.html");
  ok(sw.log.addAll[0] && sw.log.addAll[0].indexOf("./manifest.webmanifest") >= 0, "预缓存清单含 manifest");
  eq(sw.log.skipWaiting, 1, "install 后 skipWaiting（新版立即就位）");
}
{ // ①b 可选图标 404 不拖垮 install（v2.4.4：PNG 是构建期生成的，仓库根开发环境没有它们）
  const sw = loadSw({ addFails: ["./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png"] });
  sw.fire("install", {});
  eq(sw.log.skipWaiting, 1, "可选图标全部 404 → install 照常完成（skipWaiting 仍被调用）");
  eq(sw.log.add.length, 4, "可选图标仍逐个尝试预缓存（有则缓存、无则跳过）");
}
{ // ② activate：清旧缓存 + claim
  const sw = loadSw({ store: { "beatsight-pwa-v1": new Map(), "beatsight-pwa-v2": new Map(), "别的缓存": new Map() } });
  sw.fire("activate", {});
  eq(JSON.stringify(sw.log.deleted.slice().sort()), JSON.stringify(["beatsight-pwa-v1", "别的缓存"].sort()),
    "activate 删除所有非当前 CACHE 名的旧缓存");
  eq(sw.log.claim, 1, "activate 后 clients.claim（立即接管已开页面）");
}

section("T67b Service Worker · 导航请求 network-first");
{ // ③a 网络成功 → 回网络响应 + 写缓存
  const sw = loadSw();
  const e = sw.fire("fetch", { request: sw.req(BASE + "/", { mode: "navigate" }) });
  eq(e._resp && e._resp._v && e._resp._v._tag, "net", "导航在线时返回网络响应");
  eq(sw.log.put.length, 1, "成功的导航响应顺手写缓存（下次断网用）");
}
{ // ③b 网络失败 → 回退缓存的 index.html
  const store = { "beatsight-pwa-v2": new Map() };
  const sw = loadSw({ store, fetchImpl: () => SP.reject(new Error("offline")) });
  sw.store["beatsight-pwa-v2"].set("./index.html", sw.mkResp(true, "cached-index"));
  const e = sw.fire("fetch", { request: sw.req(BASE + "/", { mode: "navigate" }) });
  eq(e._resp && e._resp._v && e._resp._v._tag, "cached-index", "断网时回退缓存的 index.html（离线可用的来源）");
}
{ // ③c 网络返回错误页（!r.ok）→ 原样透传但不写缓存
  const errResp = { ok: false, _tag: "err500", clone(){ return { ok: false, _tag: "err500-clone" }; } };
  const sw = loadSw({ fetchImpl: () => SP.resolve(errResp) });
  const e = sw.fire("fetch", { request: sw.req(BASE + "/", { mode: "navigate" }) });
  eq(e._resp && e._resp._v && e._resp._v._tag, "err500", "错误响应原样透传给页面");
  eq(sw.log.put.length, 0, "!r.ok 的响应不写缓存（错误页入缓存会污染离线回退）");
}

section("T67c Service Worker · 静态资源 stale-while-revalidate");
{ // ④ 命中缓存 → 先回缓存，同时后台拉新写回
  const store = { "beatsight-pwa-v2": new Map() };
  const sw = loadSw({ store });
  sw.store["beatsight-pwa-v2"].set(BASE + "/icon.svg", sw.mkResp(true, "cached-icon"));
  const e = sw.fire("fetch", { request: sw.req(BASE + "/icon.svg") });
  eq(e._resp && e._resp._v && e._resp._v._tag, "cached-icon", "命中缓存立刻回缓存（不等网络）");
  eq(sw.log.put.length, 1, "后台 revalidate 已把新版本写回缓存");
}
{ // ④b 未命中 → 等同 network-first 并顺手入缓存
  const sw = loadSw();
  const e = sw.fire("fetch", { request: sw.req(BASE + "/icon.svg") });
  eq(e._resp && e._resp._v && e._resp._v._tag, "net", "缓存未命中时回网络响应");
  eq(sw.log.put.length, 1, "未命中也顺手写缓存");
}
{ // ⑥ cache.put 失败（配额满）不影响已发出的响应
  const sw = loadSw({ putFails: true });
  const e = sw.fire("fetch", { request: sw.req(BASE + "/icon.svg") });
  eq(e._resp && e._resp._v && e._resp._v._tag, "net", "cache.put 失败不影响响应本身");
}

section("T67d Service Worker · 不接管的三类请求");
{ // ⑤ 非 GET / 非 http(s) / 跨源：一律不 respondWith
  const sw = loadSw();
  const e1 = sw.fire("fetch", { request: sw.req(BASE + "/", { method: "POST", mode: "navigate" }) });
  ok(e1._resp === undefined, "POST 不接管");
  const e2 = sw.fire("fetch", { request: sw.req("chrome-extension://abc/x.js") });
  ok(e2._resp === undefined, "非 http(s) 不接管");
  const e3 = sw.fire("fetch", { request: sw.req("https://cdn.other.com/x.js") });
  ok(e3._resp === undefined, "跨源静态请求不接管");
  eq(sw.log.put.length, 0, "三类请求都没有写缓存");
}

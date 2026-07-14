// TrendLens Service Worker
// - 导航请求（HTML）：stale-while-revalidate —— 有缓存立刻返回（秒开），后台拉新版更新缓存；
//   页面自身会在挂载后自动刷新数据（home-screen 的 auto refresh），所以旧 HTML 会很快被新数据覆盖。
// - 静态资源（/_next/static、图片、字体等）：cache-first，命中不了才走网络并回填。
// - API 与 RSC 请求：直连网络，不缓存（数据实时性优先，离线时由页面逻辑自行降级）。
const STATIC_CACHE = "trendlens-static-v4";
const PAGES_CACHE = "trendlens-pages-v1";
const KNOWN_CACHES = [STATIC_CACHE, PAGES_CACHE];
const MAX_PAGE_ENTRIES = 48;
const SHELL_ROUTES = [
  "/manifest.webmanifest",
  "/trendlens-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_ROUTES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !KNOWN_CACHES.includes(key)).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  const isApi = url.pathname.startsWith("/api/");
  const isRsc = url.searchParams.has("_rsc");

  if (isApi || isRsc) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(handleStatic(event.request));
});

// 导航：stale-while-revalidate。缓存命中 → 立刻返回旧 HTML，同时后台取新版写缓存；
// 缓存未命中 → 走网络并写缓存；网络也失败 → 尽力回退缓存。
async function handleNavigation(event) {
  const request = event.request;
  const cache = await caches.open(PAGES_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(stripSearch(request), response.clone());
        trimCache(cache, MAX_PAGE_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // 后台继续更新缓存，本次立刻用缓存渲染。
    event.waitUntil(networkPromise);
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  const fallback = await cache.match("/");
  if (fallback) return fallback;
  return new Response("离线状态，且本页尚无缓存。请联网后重试。", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function handleStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

// 导航缓存 key 统一去掉 query（如刷新用的时间戳参数），避免同一页面存多份。
function stripSearch(request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.toString());
}

// 简单容量控制：超出上限时删掉最早写入的条目（文章详情页每天新增 ~10 个）。
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}

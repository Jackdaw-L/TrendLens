import test from "node:test";
import assert from "node:assert/strict";
import { excludeConsumedArticles } from "./recommendation-history.mjs";

function client({ read = [], recommended = [], errorTable } = {}) {
  return { from(table) {
    let ids;
    let start = 0;
    let end = Infinity;
    const query = {
      select() { return query; },
      in(column, values) { if (["id", "article_id"].includes(column)) ids = values; return query; },
      gte() { return query; },
      order() { return query; },
      range(a, b) { start = a; end = b; return query; },
      then(resolve) {
        const isRead = table === "trendlens_read_articles";
        const rows = (isRead ? read : recommended).filter((id) => ids.includes(id))
          .slice(start, end + 1).map((id) => isRead ? { article_id: id } : { id });
        return Promise.resolve({ data: rows, error: table === errorTable ? { message: "offline" } : null }).then(resolve);
      },
    };
    return query;
  } };
}

test("never backfills read or recent articles to reach ten", async () => {
  const candidates = ["read", "recent", "fresh"].map((id) => ({ id }));
  assert.deepEqual(await excludeConsumedArticles(candidates, {
    supabase: client({ read: ["read"], recommended: ["recent"] }),
  }), [{ id: "fresh" }]);
});

test("disabling recommendation window still excludes lifetime reads", async () => {
  assert.deepEqual(await excludeConsumedArticles([{ id: "old-read" }], {
    supabase: client({ read: ["old-read"] }), lookbackDays: 0,
  }), []);
});

test("history errors stop generation instead of silently allowing repeats", async () => {
  for (const errorTable of ["trendlens_read_articles", "trendlens_articles"]) {
    await assert.rejects(excludeConsumedArticles([{ id: "a" }], {
      supabase: client({ errorTable }),
    }), /offline/);
  }
});

test("candidate batching and history pagination do not truncate exclusions", async () => {
  const candidates = Array.from({ length: 230 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(await excludeConsumedArticles(candidates, {
    supabase: client({ read: candidates.slice(1).map((a) => a.id), recommended: Array(501).fill("0") }),
  }), []);
});

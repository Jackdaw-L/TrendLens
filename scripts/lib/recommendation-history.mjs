export async function excludeConsumedArticles(candidates, { supabase, lookbackDays = 3, now = Date.now() }) {
  if (!supabase || candidates.length === 0) return candidates;
  const excluded = new Set();
  const ids = [...new Set(candidates.map((article) => article.id))];
  // Candidate-scoped queries avoid truncating a growing lifetime reading history.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const { data: read, error: readError } = await supabase.from("trendlens_read_articles")
      .select("article_id").in("article_id", batch);
    if (readError) throw new Error(`读取已读记录失败：${readError.message}`);
    for (const row of read ?? []) excluded.add(row.article_id);

    if (lookbackDays > 0) {
      const cutoff = new Date(now - lookbackDays * 86400000).toISOString();
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const { data, error } = await supabase.from("trendlens_articles")
          .select("id, trendlens_radar_runs!inner(mode)")
          .in("id", batch).in("trendlens_radar_runs.mode", ["deepseek", "friday"])
          .gte("created_at", cutoff).order("run_id").order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`读取历史推荐失败：${error.message}`);
        for (const row of data ?? []) excluded.add(row.id);
        if ((data ?? []).length < pageSize) break;
        offset += pageSize;
      }
    }
  }
  return candidates.filter((article) => !excluded.has(article.id));
}

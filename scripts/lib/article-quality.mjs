const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function assessSourceMaterial(article, minChars = 400) {
  const text = clean(article.content);
  const gate = /(?:subscribe|sign in|log in|become a (?:paid )?(?:member|subscriber)).{0,60}(?:continue|read|access|unlock)|(?:paid subscribers only|subscriber.only content|this (?:post|article) is for paying|订阅后(?:继续)?阅读|付费解锁|登录后阅读全文)/i;
  const promo = /(?:subscribe to stratechery|stratechery plus|subscription includes|what you get|already a subscriber|订阅即可|会员专享)/ig;
  const promos = text.match(promo) ?? [];
  // A footer CTA on a complete long article is not a paywall.
  if ((gate.test(text) && text.length < 3500) || (promos.length >= 2 && text.length < 4500)) {
    return { eligible: false, reason: "paywall_or_subscription_preview" };
  }
  if (text.length < minChars) return { eligible: false, reason: "insufficient_source" };
  if (article.parseStatus === "failed" && text.length < 1200) {
    return { eligible: false, reason: "rss_summary_only" };
  }
  return { eligible: true, reason: null };
}

export function rewriteRequirements(source, configuredMin = 800) {
  const text = clean(source);
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const words = (text.match(/[a-zA-Z]+(?:['-][a-zA-Z]+)*/g) ?? []).length;
  // Length is a coarse truncation guard, not a target to pad with invented details.
  const estimatedChinese = chinese + words * 1.3;
  const minChineseChars = Math.max(100, Math.min(Math.round(configuredMin * 0.85), Math.floor(estimatedChinese * 0.65)));
  return {
    minChineseChars,
    minParagraphs: minChineseChars < 300 ? 2 : minChineseChars < 550 ? 3 : 5,
    minAnnotations: 0,
  };
}

export function failedArticleIds(runs) {
  return new Set(runs.flatMap((run) => Array.isArray(run.rewrite_failures) ? run.rewrite_failures : [])
    .filter((failure) => Number(failure.attempts) >= 3)
    .map((failure) => String(failure.id)));
}

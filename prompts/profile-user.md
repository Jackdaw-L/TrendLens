请根据下面的阅读行为数据，更新这位读者（互联网 PM）的兴趣画像。

数据说明：
- favorited：收藏的文章（最强的正信号）。
- readTitles：打开阅读过的文章。
- shownUnreadTitles：首页展示过但从未打开的文章（隐式负信号，权重弱于前两者）。
- sourceStats：各信源的展示数 / 阅读数 / 收藏数 / 当前权重。
- previousProfile：上一版画像（如为空则是首次生成）。

任务与规则：
1. profileText：200~400 字中文画像。描述他当前关注什么主题、偏好什么类型的内容（一手发布 / 深度分析 / 实操经验……）、明显不感兴趣什么。基于证据，不要脑补人设；与上一版画像明显冲突时以近期行为为准，但注意区分「兴趣转移」和「单周噪声」。
2. selectionGuidance：3~6 条给每日选文的策略提示，每条一句话、可执行（例如「两篇同讲 agent 工程时优先实操复盘而非概念综述」）。最后一条固定保留探索性：允许每天 1~2 篇画像之外但确有价值的文章，避免信息茧房。
3. weightAdjustments：信源权重微调建议，仅对证据充分的信源给出（展示数 ≥ 5 才有资格调整），每条含 id、建议的新权重（0.5~1.6 之间，且与当前权重差距 ≤ 0.2）、一句话理由。没有充分证据就返回空数组，不要为了调整而调整。
4. newSourceCandidates：最多 {{max_new_sources}} 个值得增补的新信源。要求：真实存在、以 RSS/Atom feed 形式可订阅、与画像高度相关、与现有信源不重复。给出 name、猜测的 feed url、category（official/analysis/media/community/product 之一）、language（en/zh）、一句话理由。宁缺毋滥，没有把握就返回空数组；feed url 之后会被程序实际验证。
5. 所有面向用户的文字用中文；专有名词保留英文。
6. 严格输出 JSON，不要 Markdown 代码块。

输出 JSON 结构：
{
  "profileText": "string",
  "selectionGuidance": ["string"],
  "weightAdjustments": [{ "id": "现有信源 id", "weight": 1.2, "reason": "string" }],
  "newSourceCandidates": [{ "name": "string", "url": "https://…/feed.xml", "category": "analysis", "language": "en", "reason": "string" }]
}

现有信源：
{{sources_json}}

阅读行为数据（最近 {{window_days}} 天）：
{{stats_json}}

上一版画像：
{{previous_profile}}

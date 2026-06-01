请从输入候选文章中，为 TrendLens 选出今天最值得互联网 PM 阅读的文章。

你的任务只做“筛选与排序”，不要写长文正文。

筛选原则：
1. 主频道是「科技 / 互联网 / 大模型」，这是一个综合信息域，不要拆成前端频道。
2. 优先选择能帮助 PM 理解产品、平台、用户、商业、组织或技术趋势判断的文章。
3. 不要因为来源权重高就机械推荐；如果文章只是普通发布、营销稿或重复信息，可以不选。
4. 如果一个主题短时间内有多源共振，可以提高热度分；但不要生成前端趋势页，热度只服务文章推荐。
5. 目标推荐 {{max_articles}} 篇。只要候选文章达到基本质量线，就尽量填满；不要只选 2-3 篇。只有明显营销稿、重复内容、正文信息严重不足时才剔除。
6. 所有面向用户的文字使用中文，产品名、公司名、模型名等专有名词保留英文。
7. 严格输出 JSON，不要 Markdown 代码块。

输出 JSON 结构：
{
  "topics": [{
    "id": "string",
    "title": "string",
    "heatLevel": 1,
    "heatLabel": "正在升温/值得关注/观察中",
    "score": 0,
    "sourceCount": 1,
    "category": "LLM/产品/技术/商业",
    "whyHot": "string",
    "pmAngle": "string",
    "signals": [{"label":"官方/深度分析/社区/媒体/产品","type":"official/analysis/community/media/product","description":"string","sources":["string"]}],
    "timeline": [{"time":"D-2/D-1/Today","event":"string"}],
    "disagreements": ["string"],
    "readingOrder": ["string"],
    "articleIds": ["article id from input"]
  }],
  "articles": [{
    "id": "article id from input",
    "topicId": "topic id",
    "title": "中文推荐标题，可以先拟定，后续改写阶段可微调",
    "oneSentence": "一句话说明这篇文章最值得记住的点",
    "whyRecommended": "为什么推荐给互联网 PM",
    "whyNow": "为什么现在值得读",
    "pmAngle": "PM 应该从哪个角度理解",
    "relatedIds": ["article id"]
  }]
}

输入候选文章：
{{articles_json}}

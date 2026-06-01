export type SourceType = "official" | "analysis" | "media" | "community" | "product";

export type TopicSignal = {
  label: string;
  type: SourceType;
  description: string;
  sources: string[];
};

export type TopicTimelineItem = {
  time: string;
  event: string;
};

export type Topic = {
  id: string;
  title: string;
  heatLevel: 1 | 2 | 3 | 4 | 5;
  heatLabel: string;
  score: number;
  sourceCount: number;
  category: "LLM" | "产品" | "技术" | "商业";
  whyHot: string;
  pmAngle: string;
  signals: TopicSignal[];
  timeline: TopicTimelineItem[];
  disagreements: string[];
  readingOrder: string[];
  articleIds: string[];
};

export type Annotation = {
  term: string;
  explain: string;
};

export type ArticleImage = {
  id: string;
  url: string;
  alt?: string;
  caption?: string;
  source?: string;
};

export type BodyBlock =
  | {
      type: "paragraph";
      content: string;
      annotations?: string[];
    }
  | {
      type: "quote";
      sourceText: string;
    }
  | {
      type: "image";
      imageId?: string;
      url: string;
      alt?: string;
      caption?: string;
    };

export type Article = {
  id: string;
  topicId: string;
  source: string;
  sourceType: SourceType;
  publishedAt: string;
  originalUrl: string;
  category: "LLM" | "产品" | "技术" | "商业";
  heat: 1 | 2 | 3 | 4 | 5;
  readingTime: number;
  tags: string[];
  title: string;
  oneSentence: string;
  whyRecommended: string;
  whyNow: string;
  pmAngle: string;
  bodyBlocks: BodyBlock[];
  annotations: Annotation[];
  pmTakeaways: string[];
  relatedIds: string[];
  images?: ArticleImage[];
  heroImage?: ArticleImage | null;
};

export function toHeatScore(value: number | null | undefined, fallback = 60) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const score = number <= 5 ? number * 20 : number;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function getArticleHeatScore(
  article: Pick<Article, "heat" | "topicId">,
  topicList: Pick<Topic, "id" | "score">[] = [],
) {
  const topic = topicList.find((item) => item.id === article.topicId);
  return toHeatScore(topic?.score ?? article.heat);
}

export const topics: Topic[] = [
  {
    id: "ai-coding-workflow",
    title: "AI coding 正在从提速工具变成工作流入口",
    heatLevel: 5,
    heatLabel: "正在升温",
    score: 86,
    sourceCount: 4,
    category: "LLM",
    whyHot:
      "官方能力更新、工程博客拆解、HN 分歧讨论和产品媒体扩散在 72 小时内叠到一起，已经不只是单点工具新闻。",
    pmAngle:
      "执行成本下降后，产品团队更需要机制化地决定什么不做，否则功能生产速度会反过来放大产品一致性问题。",
    signals: [
      {
        label: "官方",
        type: "official",
        description: "能力更新给了事实起点，说明工具边界在继续外扩。",
        sources: ["OpenAI News", "Google Research"],
      },
      {
        label: "深度分析",
        type: "analysis",
        description: "开始讨论工程流程和组织分工，而不是只讨论补全速度。",
        sources: ["Simon Willison", "Latent Space"],
      },
      {
        label: "社区",
        type: "community",
        description: "争论集中在真实效率、代码质量和责任边界。",
        sources: ["Hacker News"],
      },
      {
        label: "媒体",
        type: "media",
        description: "报道开始进入竞品比较和产品入口层面。",
        sources: ["TechCrunch AI"],
      },
    ],
    timeline: [
      { time: "D-2", event: "官方源提到 Agent 能力和开发者工具链更新。" },
      { time: "D-1", event: "工程社区开始拆解真实工作流里的瓶颈。" },
      { time: "Today", event: "产品媒体把话题扩散到竞品和组织效率视角。" },
    ],
    disagreements: [
      "乐观派认为 AI coding agent 会重构软件团队的交付节奏。",
      "谨慎派担心更快的代码生产会放大需求含混和系统复杂度。",
    ],
    readingOrder: [
      "先读官方事实源，建立能力边界。",
      "再读 Simon Willison 的分析，理解工程实践中的真实摩擦。",
      "最后扫 HN 分歧，观察开发者对责任边界的反应。",
    ],
    articleIds: ["ai-code-judgement", "agent-workflow-boundary", "hn-coding-debate"],
  },
  {
    id: "multimodal-agent-delivery",
    title: "多模态 Agent 正在从演示走向可交付场景",
    heatLevel: 4,
    heatLabel: "值得关注",
    score: 74,
    sourceCount: 3,
    category: "技术",
    whyHot:
      "模型能力发布、应用案例和产品上新开始共同出现，说明多模态不再只是发布会里的演示片段。",
    pmAngle:
      "判断多模态产品时，重点不是能不能识别图片，而是能不能把识别结果接到稳定的任务闭环。",
    signals: [
      {
        label: "官方",
        type: "official",
        description: "模型能力继续覆盖图片、语音和屏幕上下文。",
        sources: ["Google DeepMind", "OpenAI News"],
      },
      {
        label: "产品",
        type: "product",
        description: "新产品开始把多模态能力包装成任务助手。",
        sources: ["Product Hunt"],
      },
      {
        label: "分析",
        type: "analysis",
        description: "深度文章关注从能力展示到可靠交付之间的距离。",
        sources: ["Interconnects"],
      },
    ],
    timeline: [
      { time: "D-3", event: "官方博客发布新一轮多模态能力说明。" },
      { time: "D-1", event: "Product Hunt 出现面向工作流的新产品。" },
      { time: "Today", event: "分析源开始复盘可交付场景与失败边界。" },
    ],
    disagreements: [
      "一派认为多模态会优先改造客服、质检和运营后台。",
      "另一派认为可靠性还不足以支撑高风险自动执行。",
    ],
    readingOrder: [
      "先看官方能力说明，确认输入输出边界。",
      "再看产品案例，判断包装方式是否真实解决任务。",
      "最后读分析源，识别可靠性风险。",
    ],
    articleIds: ["multimodal-real-work", "producthunt-agent-wave"],
  },
  {
    id: "open-model-platform",
    title: "开源模型生态的竞争点转向工具链和分发",
    heatLevel: 4,
    heatLabel: "值得关注",
    score: 69,
    sourceCount: 3,
    category: "商业",
    whyHot:
      "Hugging Face、研究博客和创业内容都在讨论模型之外的基础设施，生态竞争正在从参数表扩展到工具链。",
    pmAngle:
      "平台护城河不一定来自单个模型，而可能来自评测、部署、数据、社区和默认入口的组合。",
    signals: [
      {
        label: "官方",
        type: "official",
        description: "开源平台继续把模型、数据集和应用部署放到同一个体系。",
        sources: ["Hugging Face"],
      },
      {
        label: "创业",
        type: "product",
        description: "新团队围绕评测、路由和推理成本做产品化包装。",
        sources: ["YC Blog"],
      },
      {
        label: "分析",
        type: "analysis",
        description: "分析文章开始把开源生态视作分发网络。",
        sources: ["Import AI"],
      },
    ],
    timeline: [
      { time: "D-4", event: "平台源发布模型和工具链更新。" },
      { time: "D-2", event: "创业源提到推理、评测和路由方向。" },
      { time: "Today", event: "分析源把主题上升到生态分发竞争。" },
    ],
    disagreements: [
      "有人认为开源模型会持续压低闭源 API 的定价权。",
      "也有人认为真正稀缺的是稳定部署和企业集成能力。",
    ],
    readingOrder: [
      "先读 Hugging Face 平台更新。",
      "再看 YC 创业团队切入点。",
      "最后读 Import AI 的生态判断。",
    ],
    articleIds: ["open-model-toolchain", "inference-routing-startups"],
  },
  {
    id: "ai-browser-workflow",
    title: "AI browser 的机会不在浏览器，而在任务上下文",
    heatLevel: 3,
    heatLabel: "观察中",
    score: 58,
    sourceCount: 2,
    category: "产品",
    whyHot:
      "产品上新和社区讨论都有信号，但官方能力源暂时不足，还需要观察真实留存和任务完成率。",
    pmAngle:
      "AI browser 如果只是把聊天框放进网页，很难形成新入口；关键是能否记住任务状态并跨站点推进。",
    signals: [
      {
        label: "产品",
        type: "product",
        description: "新产品集中强调自动浏览、表单填写和研究助手。",
        sources: ["Product Hunt", "Lenny's Newsletter"],
      },
      {
        label: "社区",
        type: "community",
        description: "工程师主要质疑可靠性、隐私和权限边界。",
        sources: ["Hacker News"],
      },
    ],
    timeline: [
      { time: "D-5", event: "产品发现源出现多款 AI browser 相关工具。" },
      { time: "D-1", event: "HN 开始讨论浏览器自动化的权限边界。" },
      { time: "Today", event: "暂未看到强官方源共振。" },
    ],
    disagreements: [
      "产品叙事强调用户不用理解网页结构。",
      "技术讨论更担心自动执行导致的安全和信任问题。",
    ],
    readingOrder: [
      "先看产品页，理解新入口叙事。",
      "再看 HN，识别真实反对意见。",
    ],
    articleIds: ["ai-browser-context"],
  },
  {
    id: "pm-operating-system",
    title: "PM 的个人知识工作台开始被 Agent 化",
    heatLevel: 3,
    heatLabel: "观察中",
    score: 54,
    sourceCount: 2,
    category: "产品",
    whyHot:
      "深度作者和产品源都在讨论个人工作流，但还没形成足够强的多源共振。",
    pmAngle:
      "这类产品真正的价值不是替你保存资料，而是把资料变成下一次决策时可以复用的判断结构。",
    signals: [
      {
        label: "分析",
        type: "analysis",
        description: "开始把个人知识管理和 Agent 工作流放在一起讨论。",
        sources: ["One Useful Thing"],
      },
      {
        label: "产品",
        type: "product",
        description: "新产品强调自动整理、检索和行动建议。",
        sources: ["Product Hunt"],
      },
    ],
    timeline: [
      { time: "D-3", event: "分析源讨论 AI 对知识工作者的影响。" },
      { time: "Today", event: "产品源出现面向个人工作台的新应用。" },
    ],
    disagreements: [
      "一派关注个人效率提升。",
      "另一派认为没有组织上下文的数据很难产生可靠建议。",
    ],
    readingOrder: [
      "先读分析源，建立问题框架。",
      "再看产品源，判断形态是否只是资料夹升级。",
    ],
    articleIds: ["pm-agent-workbench"],
  },
];

export const articles: Article[] = [
  {
    id: "ai-code-judgement",
    topicId: "ai-coding-workflow",
    source: "Simon Willison",
    sourceType: "analysis",
    publishedAt: "2026-05-31T08:10:00+08:00",
    originalUrl: "https://simonwillison.net/",
    category: "LLM",
    heat: 5,
    readingTime: 7,
    tags: ["AI coding", "agent", "developer tools"],
    title: "AI 写代码变快了，但真正稀缺的是产品判断",
    oneSentence:
      "这篇文章真正想说的是，AI 降低了执行成本，却没有自动补上判断、取舍和品味。",
    whyRecommended:
      "不是又一篇效率神话，而是帮 PM 判断 AI coding 产品边界。",
    whyNow:
      "多个开发者工具和 Agent 产品正在同时升温，这篇适合作为理解 AI coding 产品边界的切入口。",
    pmAngle:
      "当执行变便宜，需求质量、验收标准和产品一致性会变得更贵。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "这篇文章有意思的地方，不在于又证明了一次 AI 能写代码，而在于它把注意力从“写得有多快”挪到了“到底该写什么”。对产品经理来说，这个变化更要命。",
        annotations: ["AI coding agent"],
      },
      {
        type: "quote",
        sourceText:
          "The bottleneck is no longer writing code, but deciding what should exist.",
      },
      {
        type: "paragraph",
        content:
          "如果团队把 AI coding agent 当作更快的外包手，它会带来更多功能碎片；如果把它当作产品判断的压力测试工具，它反而会逼团队更早暴露需求里的含混。",
        annotations: ["AI coding agent"],
      },
      {
        type: "paragraph",
        content:
          "文章里隐含的判断是：软件生产链路里最可自动化的是执行，最难自动化的是取舍。执行成本下降以后，坏需求不会自动消失，它只会更快变成线上复杂度。",
      },
    ],
    annotations: [
      {
        term: "AI coding agent",
        explain:
          "一种不只补全代码，而是能理解任务、修改文件、运行命令并反馈结果的编程助手。这里需要知道它，是因为文章讨论的效率变化已经不再是简单自动补全。",
      },
    ],
    pmTakeaways: [
      "执行成本下降后，产品团队更需要机制化地决定什么不做。",
      "功能生产速度越快，产品整体一致性越容易被破坏。",
      "AI coding 工具的好产品形态，可能更像协作流程的一部分，而不是一个单独编辑器插件。",
    ],
    relatedIds: ["agent-workflow-boundary", "hn-coding-debate"],
  },
  {
    id: "agent-workflow-boundary",
    topicId: "ai-coding-workflow",
    source: "Latent Space",
    sourceType: "analysis",
    publishedAt: "2026-05-31T07:30:00+08:00",
    originalUrl: "https://www.latent.space/",
    category: "技术",
    heat: 4,
    readingTime: 6,
    tags: ["workflow", "agent", "evaluation"],
    title: "Agent 产品的边界，藏在失败后怎么收场",
    oneSentence:
      "Agent 的成熟度不是看一次成功演示，而是看失败时能否解释、回退和继续协作。",
    whyRecommended:
      "适合用来判断 Agent 产品是否只是演示能力，还是已经具备工作流可靠性。",
    whyNow:
      "多款开发者 Agent 同时出现，可靠性和可恢复性会成为下一轮产品差异点。",
    pmAngle:
      "把失败状态设计清楚，比把成功路径做得更酷更重要。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "Agent 产品最容易在演示里显得神奇，因为演示天然选择了顺利路径。但真实工作流里，价值往往出现在失败之后：它有没有告诉你错在哪里，有没有保留上下文，有没有让人接手。",
        annotations: ["工作流可靠性"],
      },
      {
        type: "paragraph",
        content:
          "从 PM 视角看，Agent 的交互不是一次性问答，而是一串带状态的协作。只要状态不可见，用户就很难信任它继续执行。",
      },
    ],
    annotations: [
      {
        term: "工作流可靠性",
        explain:
          "指一个产品在多步骤任务里维持状态、处理异常、允许回退和让用户复核的能力。Agent 场景尤其依赖它。",
      },
    ],
    pmTakeaways: [
      "可靠 Agent 需要把失败、暂停、复核做成一等状态。",
      "演示转产品的关键，是让用户知道系统正在做什么和为什么停下。",
    ],
    relatedIds: ["ai-code-judgement", "hn-coding-debate"],
  },
  {
    id: "hn-coding-debate",
    topicId: "ai-coding-workflow",
    source: "Hacker News",
    sourceType: "community",
    publishedAt: "2026-05-31T06:45:00+08:00",
    originalUrl: "https://news.ycombinator.com/",
    category: "技术",
    heat: 4,
    readingTime: 5,
    tags: ["community", "developer tools", "quality"],
    title: "工程师争论 AI coding，焦点其实是责任边界",
    oneSentence:
      "社区分歧不是 AI 会不会写代码，而是出了问题以后谁负责理解和修正。",
    whyRecommended:
      "HN 评论能补上官方和产品稿里看不到的真实反对意见。",
    whyNow:
      "AI coding 热度升高时，工程社区的质疑可以帮助 PM 更早识别采用阻力。",
    pmAngle:
      "产品要降低的不只是输入成本，还包括复核、归因和回滚成本。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "HN 的讨论很少像产品发布稿那么顺滑，它更像真实采用前的压力测试。大家不只问 AI 能不能生成代码，也在问生成以后谁来理解、谁来修、谁来背锅。",
        annotations: ["HN"],
      },
      {
        type: "paragraph",
        content:
          "这类反对意见对 PM 很有价值，因为它指出了购买和留存之外的另一条路径：用户愿意试用，不代表愿意把核心责任交出去。",
      },
    ],
    annotations: [
      {
        term: "HN",
        explain:
          "Hacker News，工程师和创业者常用的技术社区。它的讨论适合观察技术产品在真实用户里的赞成、怀疑和反对理由。",
      },
    ],
    pmTakeaways: [
      "采用阻力常常来自责任不清，而不是能力不够。",
      "复核体验和可解释性会影响 AI coding 工具的留存。",
    ],
    relatedIds: ["ai-code-judgement", "agent-workflow-boundary"],
  },
  {
    id: "multimodal-real-work",
    topicId: "multimodal-agent-delivery",
    source: "Google DeepMind",
    sourceType: "official",
    publishedAt: "2026-05-30T22:20:00+08:00",
    originalUrl: "https://deepmind.google/blog/",
    category: "技术",
    heat: 4,
    readingTime: 6,
    tags: ["multimodal", "agent", "reliability"],
    title: "多模态能力真正进入产品，要先跨过任务闭环",
    oneSentence:
      "识别图片或语音只是入口，能否把理解结果稳定接到下一步行动才是产品价值。",
    whyRecommended:
      "官方能力源能帮助先确认事实边界，再判断产品包装是否夸大。",
    whyNow:
      "多模态能力发布和应用案例同时增多，适合重新校准它离可交付任务还有多远。",
    pmAngle:
      "多模态不是炫技层，而是任务上下文的一种输入方式。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "多模态发布通常会展示模型看图、听音频、理解屏幕的能力。但产品上真正重要的问题是：这些理解能不能进入一个稳定的任务闭环。",
        annotations: ["多模态"],
      },
      {
        type: "paragraph",
        content:
          "如果只是多一种输入形式，它会很快变成新鲜感；如果能减少用户在截图、解释、复制信息之间的切换，它才会变成工作流。",
      },
    ],
    annotations: [
      {
        term: "多模态",
        explain:
          "模型同时处理文本、图片、音频、视频或屏幕等多种输入输出形式。这里需要关注的是它如何进入任务，而不只是识别能力本身。",
      },
    ],
    pmTakeaways: [
      "评估多模态产品时，要看它能否减少上下文搬运。",
      "能力演示和任务交付之间还隔着异常处理、权限和验收。",
    ],
    relatedIds: ["producthunt-agent-wave"],
  },
  {
    id: "producthunt-agent-wave",
    topicId: "multimodal-agent-delivery",
    source: "Product Hunt",
    sourceType: "product",
    publishedAt: "2026-05-30T19:05:00+08:00",
    originalUrl: "https://www.producthunt.com/",
    category: "产品",
    heat: 3,
    readingTime: 4,
    tags: ["product", "agent", "workflow"],
    title: "新一批 Agent 产品都在卖“替你完成任务”",
    oneSentence:
      "产品叙事从“更聪明的聊天”转向“少做几步操作”，但可靠性仍然是硬门槛。",
    whyRecommended:
      "能快速观察创业产品如何包装多模态和 Agent 能力。",
    whyNow:
      "产品发现源集中出现相关工具，说明市场叙事正在靠近任务自动化。",
    pmAngle:
      "如果产品卖的是省步骤，就必须证明每一步失败时用户不用重新开始。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "这一批产品的共同点，是不再满足于说自己回答得更好，而是直接承诺替用户完成某类任务。这个叙事更强，也更危险。",
      },
      {
        type: "paragraph",
        content:
          "危险在于，用户对任务产品的容错更低。聊天错了可以重问，任务做错了可能会消耗真实时间、钱或者信誉。",
      },
    ],
    annotations: [],
    pmTakeaways: [
      "任务型 Agent 的承诺越大，异常状态越需要产品化。",
      "展示省步骤之前，先证明用户可以随时接管。",
    ],
    relatedIds: ["multimodal-real-work"],
  },
  {
    id: "open-model-toolchain",
    topicId: "open-model-platform",
    source: "Hugging Face",
    sourceType: "official",
    publishedAt: "2026-05-30T17:30:00+08:00",
    originalUrl: "https://huggingface.co/blog",
    category: "商业",
    heat: 4,
    readingTime: 6,
    tags: ["open model", "platform", "distribution"],
    title: "开源模型平台的护城河，越来越像工具链组合",
    oneSentence:
      "模型本身重要，但平台真正能沉淀的是评测、部署、社区和默认分发路径。",
    whyRecommended:
      "适合理解开源模型生态为什么不只是参数和榜单竞争。",
    whyNow:
      "开源平台、推理服务和创业公司都在同一时间强调模型之外的基础设施。",
    pmAngle:
      "平台产品的关键，是把零散能力压成用户默认选择的路径。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "如果只看模型榜单，很容易低估开源平台的长期价值。真正有黏性的部分，往往是用户反复经过的工具链：找模型、评测、部署、分享、再被别人发现。",
        annotations: ["开源模型"],
      },
      {
        type: "paragraph",
        content:
          "这就是平台和工具站的区别。工具站解决一次问题，平台让下一次问题默认回到它这里解决。",
      },
    ],
    annotations: [
      {
        term: "开源模型",
        explain:
          "权重、代码或使用方式较开放的模型生态。它的竞争不只在模型能力，也在围绕模型形成的工具、社区和分发网络。",
      },
    ],
    pmTakeaways: [
      "平台价值来自高频路径，而不是单次能力展示。",
      "开源生态越丰富，默认入口和信任机制越重要。",
    ],
    relatedIds: ["inference-routing-startups"],
  },
  {
    id: "inference-routing-startups",
    topicId: "open-model-platform",
    source: "YC Blog",
    sourceType: "product",
    publishedAt: "2026-05-30T13:05:00+08:00",
    originalUrl: "https://www.ycombinator.com/blog",
    category: "商业",
    heat: 3,
    readingTime: 5,
    tags: ["inference", "startup", "routing"],
    title: "推理路由创业公司，其实在卖 AI 成本的不确定性保险",
    oneSentence:
      "模型越多，企业越需要有人帮它在质量、速度和成本之间动态做选择。",
    whyRecommended:
      "能补充平台之外的创业切入点，帮助判断基础设施机会。",
    whyNow:
      "开源模型和闭源 API 同时增多，推理选择成本正在被产品化。",
    pmAngle:
      "当选择太多，新的产品机会常常不是再加一个选项，而是替用户承担选择过程。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "推理路由听起来像技术基础设施，但它卖的其实是一种确定性：在不同模型、价格和延迟之间，替企业找到当下够好的组合。",
        annotations: ["推理路由"],
      },
      {
        type: "paragraph",
        content:
          "这类产品很像云时代的成本优化工具。用户不是没有能力手动调参，而是不想每天把判断力耗在重复权衡上。",
      },
    ],
    annotations: [
      {
        term: "推理路由",
        explain:
          "根据任务、价格、延迟和质量要求，把请求动态分配给不同模型或供应商的机制。它把模型选择变成基础设施能力。",
      },
    ],
    pmTakeaways: [
      "AI 基础设施产品常常在“不确定性”里找价值。",
      "路由产品的核心壁垒来自评估数据和默认信任。",
    ],
    relatedIds: ["open-model-toolchain"],
  },
  {
    id: "ai-browser-context",
    topicId: "ai-browser-workflow",
    source: "Lenny's Newsletter",
    sourceType: "product",
    publishedAt: "2026-05-29T23:00:00+08:00",
    originalUrl: "https://www.lennysnewsletter.com/",
    category: "产品",
    heat: 3,
    readingTime: 5,
    tags: ["AI browser", "workflow", "context"],
    title: "AI browser 的机会不在浏览器，而在任务上下文",
    oneSentence:
      "浏览器只是容器，真正可能重塑入口的是跨页面理解任务状态的能力。",
    whyRecommended:
      "适合判断 AI browser 是新入口，还是旧浏览器加聊天框。",
    whyNow:
      "相关产品开始密集出现，但强共振还不够，值得观察而不是立刻下注。",
    pmAngle:
      "入口产品必须掌握上下文，否则只能停留在辅助功能。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "AI browser 最容易讲成一个宏大故事：浏览器是互联网入口，所以加上 AI 就会变成新入口。但这句话中间少了一步，AI 到底掌握了什么上下文。",
        annotations: ["AI browser"],
      },
      {
        type: "paragraph",
        content:
          "如果它只知道当前页面，那只是更方便的侧边栏；如果它知道你的任务、历史、权限和下一步目标，它才可能变成真正的工作流入口。",
      },
    ],
    annotations: [
      {
        term: "AI browser",
        explain:
          "把 AI 助手、网页理解和自动操作整合到浏览器里的产品方向。关键不只是聊天，而是跨网页维持任务上下文。",
      },
    ],
    pmTakeaways: [
      "不要把容器优势误认为任务优势。",
      "AI browser 的留存取决于它是否能持续推进真实任务。",
    ],
    relatedIds: [],
  },
  {
    id: "pm-agent-workbench",
    topicId: "pm-operating-system",
    source: "One Useful Thing",
    sourceType: "analysis",
    publishedAt: "2026-05-29T18:40:00+08:00",
    originalUrl: "https://www.oneusefulthing.org/",
    category: "产品",
    heat: 3,
    readingTime: 6,
    tags: ["PM", "knowledge work", "agent"],
    title: "PM 的个人知识工作台，正在从资料夹变成判断系统",
    oneSentence:
      "AI 让个人知识库的价值从保存信息，转向在下次决策时复用判断结构。",
    whyRecommended:
      "和 TrendLens 自身方向高度相关，适合作为产品形态参考。",
    whyNow:
      "个人工作流产品正在从整理资料转向主动生成分析和行动建议。",
    pmAngle:
      "知识产品的下一步不是更会搜索，而是更会把材料组织成可复用的判断链。",
    bodyBlocks: [
      {
        type: "paragraph",
        content:
          "个人知识管理过去常常像一个更会收纳的资料柜。AI 加进来以后，它有机会变成判断系统：不仅告诉你资料在哪里，还告诉你这批资料放在一起意味着什么。",
      },
      {
        type: "paragraph",
        content:
          "但这里也有一个陷阱。如果系统只会生成漂亮摘要，它很快会变成另一个信息过载源。真正有用的是把事实、分歧、时间和你的偏好组织成判断链。",
      },
    ],
    annotations: [],
    pmTakeaways: [
      "知识工作台要减少判断启动成本，而不是制造更多摘要。",
      "个人偏好和长期反馈会成为这类产品的核心数据。",
    ],
    relatedIds: [],
  },
];

export const sourceStats = [
  { id: "openai", name: "OpenAI News", category: "official", weight: 1.4, status: "ok" },
  { id: "google-deepmind", name: "Google DeepMind", category: "official", weight: 1.4, status: "ok" },
  { id: "huggingface", name: "Hugging Face", category: "official", weight: 1.3, status: "ok" },
  { id: "simon-willison", name: "Simon Willison", category: "analysis", weight: 1.3, status: "ok" },
  { id: "latent-space", name: "Latent Space", category: "analysis", weight: 1.2, status: "ok" },
  { id: "one-useful-thing", name: "One Useful Thing", category: "analysis", weight: 1.2, status: "ok" },
  { id: "producthunt", name: "Product Hunt", category: "product", weight: 1, status: "ok" },
  { id: "hn-ai", name: "Hacker News AI Filter", category: "community", weight: 1.1, status: "needs_review" },
];

export function getTopic(id: string) {
  return topics.find((topic) => topic.id === id);
}

export function getArticle(id: string) {
  return articles.find((article) => article.id === id);
}

export function getArticlesForTopic(topicId: string) {
  return articles.filter((article) => article.topicId === topicId);
}

export function getRelatedArticles(article: Article) {
  return article.relatedIds
    .map((id) => getArticle(id))
    .filter((item): item is Article => Boolean(item));
}

export function getFeaturedArticles() {
  return articles
    .slice()
    .sort((a, b) => b.heat - a.heat || b.readingTime - a.readingTime)
    .slice(0, 8);
}

export const generationStatus = {
  lastFetchedAt: "2026-05-31T08:30:00+08:00",
  nextRefreshAt: "2026-05-31T20:30:00+08:00",
  candidateCount: 37,
  recommendedCount: articles.length,
  trendCount: topics.length,
  parseFailureRate: "12%",
  fridayModel: "deepseek-v3-friday",
  fridayAppId: "1637742221455659024",
};

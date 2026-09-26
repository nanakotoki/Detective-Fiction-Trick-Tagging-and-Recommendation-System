# 知识库数据格式规范

本文档定义 `data/books/*.json` 中每部作品的字段规范。
所有校验逻辑都在 [`scripts/check-data.mjs`](../scripts/check-data.mjs) 中实现，运行 `npm run check` 即可验证。

题材口径另有一道闸门：`data/exclusions.json` 登记**不收**的作品（用户口径「纯恐怖、纯间谍不收」，
判定依据是馆藏 CNMARC 的主题词／中图法），由
[`scripts/check-exclusions.mjs`](../scripts/check-exclusions.mjs) 在每次 `npm run check`
与 `npm run build` 时核对——**排除项一旦回流即构建失败**。

---

## 一、文件组织

- 位置：`data/books/`
- 文件名：`batch-NN-<slug>.json`（例如 `batch-01-honkaku.json`）
- 内容：**一个 JSON 数组**，每个元素是一部作品
- 编码：UTF-8 **无 BOM**
- 下划线开头（`_*.json`）的文件会被校验脚本与构建脚本忽略，可用于临时草稿

新增批次后（纯静态模式）需在 `web/js/core/seed.js` 的 `SEED_FILES` 中登记；
后端模式会自动读取 `data/books/` 下的全部 `*.json`。

---

## 二、字段规范

### 2.1 标识与基础信息

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|:----:|------|------|
| `id` | string | ✅ | `^[a-zA-Z0-9._-]{1,64}$`，全库唯一 | 稳定标识，用于 URL 与引用，**不应再变更** |
| `title` | string | ✅ | 非空 | 中文书名 |
| `originalTitle` | string | | | 原书名（日文/英文原名） |
| `author` | string | ✅ | 非空 | 作者中文名 |
| `authorEn` | string | | | 作者外文名 |
| `genre` | string | ✅ | **受控值**（12 选一）：新本格 / 本格推理 / 社会派 / 硬汉派 / 变格 / 青春推理 / 历史推理 / 间谍小说 / 恐怖 / 日常之谜 / 犯罪悬疑 / 冒险悬疑。写入近似值时会被 `canonicalGenre()` 自动归一到词表内的合法值 |
| `firstPublished` | string | | 建议为四位年份 | **作品首次出版年**（原作年）。核不到就留空，**不得拿版本年顶替** |
| `editionYear` | string | | 建议为四位年份 | **本库所引版本的出版年**。与 `firstPublished` 语义不同：如《点与线》原作 1958 年、本库所引中译本 2007 年。**中文原创作品按惯例留空**（两者本就同年）；引进作品有可核来源就填，来源写在 `verification.editionYearSource` |
| `series` | string | | 空字符串表示非系列 | 系列名，如「金田一耕助系列」 |
| `detective` | string | | | 系列主角名 |
| `country` | string | | | 作者国籍或作品背景国别 |

### 2.2 标签

| 字段 | 类型 | 必填 | 约束 |
|------|------|:----:|------|
| `tags` | string[] | ✅ | 元素必须是 [`web/js/core/tags.js`](../web/js/core/tags.js) 中定义的标签 `id`；不得重复 |
| `schoolTags` | string[] | | **推理流派**维度的标签 `id`（`category: 'school'`），与 `tags` 正交，可为多个 |
| `customTags` | string[] | | 自定义标签中文名，原样展示，**不参与相似度计算** |

**标注要求**：

- 每部作品至少 **1 个诡计类标签**（否则无法参与推荐）；建议 **3 个以上**
- 准确性优先于数量 —— 为了凑数乱标会直接降低推荐质量
- 只标注「存在哪一类诡计」，不得暗示具体手法

> **为什么流派要单独一个字段**：`tags` 回答「这本书有哪些诡计」，
> `schoolTags` 回答「这本书属于哪一路写法」。二者是正交维度——
> **社会派作品同样可以有密室**。混进 `tags` 会让流派标签污染诡计类的
> 相似度计算（诡计类权重 3.0，会盖过真正的诡计匹配），
> 因此引擎用独立的 `bookTagIds()` 合并两者，并给流派单独的权重 1.4。
> 合法取值见 [`web/js/core/tags.js`](../web/js/core/tags.js) 中 `category: 'school'` 的 14 个标签。

### 2.3 无剧透简介

| 字段 | 类型 | 必填 | 约束 |
|------|------|:----:|------|
| `safeSummary` | string | ✅ | **≤ 100 字**（按 Unicode 码点计，中文算 1 个）；建议 ≥ 12 字 |

内容只概括**故事设定与悬念**：谁在什么处境下遇到什么怪事。
不得涉及凶手、手法、结局。

### 2.4 推荐理由

| 字段 | 类型 | 必填 | 约束 |
|------|------|:----:|------|
| `recommendationReason` | string | | 留空（`""`）则由算法根据真实共享标签自动生成 |

若手动填写，必须**只比较诡计类型与风格**，且引用的标签必须确实与目标作品共享。

### 2.5 平台评价

```jsonc
"ratings": {
  "douban":    { "score": 9.0, "count": 200000, "source": "豆瓣读书", "asOf": "2025-01", "summary": "……" },
  "hupu":      { "score": null, "count": null, "source": "虎扑", "asOf": null, "summary": "暂无数据" },
  "goodreads": { "score": 4.28, "count": 1300000, "source": "Goodreads", "asOf": "2025-01", "summary": "……" }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `score` | number \| null | `null` 表示暂无数据。**禁止编造** |
| `count` | number \| null | 评价人数 |
| `source` | string | 平台名 |
| `asOf` | string \| null | 数据时间点，如 `"2025-01"` |
| `summary` | string | 去剧透评价摘要（20~70 字为宜），无数据时写 `"暂无数据"` |

- `douban`、`hupu`、`goodreads` **三个键必须存在**（即使全部为 `null`）
- 可额外添加 `zhihu`（知乎）、`weread`（微信读书）或其他平台键
- 豆瓣为 10 分制，Goodreads 为 5 分制，**不要混用**

### 2.6 阅读提示

```jsonc
"readingTips": {
  "suitableFor": ["喜欢封闭空间群像案件的读者"],
  "watchFor": ["童谣文本与事件发生的先后顺序"],
  "warning": "本书存在叙述层面的设计，请留意叙述者本身。"
}
```

`watchFor` **只能写观察维度**（「留意什么」），绝不能写答案（「答案是什么」）。
例：

- ✅ 「留意叙述者提供信息的边界」
- ✅ 「注意每章交代的讲述者身份」
- ❌ 「留意凶手其实是叙述者」

### 2.7 谜底保险库

```jsonc
"vault": { "culprit": "", "coreTrick": "", "ending": "", "notes": "" }
```

- **种子数据中四个字段必须全部为空字符串**（校验脚本会直接报错）
- 该对象在渲染、导出、API 返回等所有出口都会被递归剥离
- 仅用于本机记录，存在的意义是「给剧透一个安全的去处」，而不是让它流向读者

### 2.8 元信息

| 字段 | 类型 | 说明 |
|------|------|------|
| `origin` | string | `seed` / `user` / `imported` |
| `recommendable` | boolean | `false` 时不参与推荐（用户自建条目默认为 `false`） |
| `verification` | object | `{ verified: boolean, verifiedAt: string\|null, source: string }` |
| `provenance` | object | `{ source: string, ratingsNote: string }` |

---

## 三、完整示例

```json
[
  {
    "id": "western-001",
    "title": "无人生还",
    "originalTitle": "And Then There Were None",
    "author": "阿加莎·克里斯蒂",
    "authorEn": "Agatha Christie",
    "genre": "本格推理",
    "firstPublished": "1939",
    "series": "",
    "detective": "",
    "country": "英国",
    "tags": [
      "closed-circle",
      "isolated-island",
      "nursery-rhyme",
      "psychological-misdirection",
      "ensemble",
      "revenge",
      "honkaku",
      "dark-atmosphere"
    ],
    "safeSummary": "十个彼此陌生的人被一封邀请函带到与世隔绝的孤岛上，接待他们的主人始终没有露面。随着一首旧童谣被逐句念出，岛上的秩序开始崩塌。",
    "recommendationReason": "",
    "ratings": {
      "douban": {
        "score": 9.0,
        "count": 200000,
        "source": "豆瓣读书",
        "asOf": "2025-01",
        "summary": "长期位居推理类高分榜，读者普遍认为封闭舞台与童谣结构的结合是类型标杆。"
      },
      "hupu": { "score": null, "count": null, "source": "虎扑", "asOf": null, "summary": "暂无数据" },
      "goodreads": {
        "score": 4.28,
        "count": 1300000,
        "source": "Goodreads",
        "asOf": "2025-01",
        "summary": "英文读者票选度极高，常被列为入门首选；部分读者认为人物刻画服务于结构。"
      }
    },
    "readingTips": {
      "suitableFor": ["喜欢封闭空间群像案件的读者", "偏好童谣/序列式结构的读者"],
      "watchFor": ["童谣文本与事件发生的先后顺序", "十个人各自携带的过去"],
      "warning": "请留意「邀请函」这一形式本身，以及参与者之间是否存在事前关联。"
    },
    "vault": { "culprit": "", "coreTrick": "", "ending": "", "notes": "" },
    "origin": "seed",
    "verification": { "verified": true, "verifiedAt": "2025-01", "source": "整理者据公开出版信息核对" }
  }
]
```

---

## 四、校验规则清单

`npm run check` 会逐条检查：

**错误级（必须修复）**

- JSON 解析失败 / 顶层不是数组
- 缺少 `id`、`title`、`author`、`genre`、`safeSummary`、`tags`、`ratings`
- `id` 不符合正则或全库重复
- `tags` 中出现字典未收录的 `id`
- `safeSummary` 超过 100 字
- `ratings` 缺少 `douban` / `hupu` / `goodreads` 任一键
- `vault` 四个字段非空
- 反剧透引擎命中**高危**规则

**警告级（建议修复）**

- 书名与其他条目重复
- 没有任何「诡计类」标签，或少于 2 个
- `safeSummary` 过短或为「可疑」级风险
- 标签重复
- 平台评分不是数字
- 文件名不符合 `batch-NN-<slug>.json` 规范
- 文件含 BOM

**提示级**

- 仅有 1 个诡计类标签
- 未使用的标签（全库层面）

使用 `npm run check:strict` 可把「可疑」级也视为失败，适合 CI。

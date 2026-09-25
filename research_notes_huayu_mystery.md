# 华语推理小说书目研究笔记 (raw research notes)

Working notes for bibliographic verification of 16 Chinese-language mystery/crime titles.
Rule applied throughout: report only sourced facts; no culprit/ending/trick-mechanics spoilers.

## Access notes (verified working)
- Baidu Baike desktop = HTTP 403. Use `https://wapbaike.baidu.com/item/<urlencoded>` (auto-resolves to `/item/<title>/<id>`).
- Douban title→ID JSON: `https://book.douban.com/j/subject_suggest?q=<urlencoded>` (lightweight, reliable).
- Douban subject: `https://book.douban.com/subject/<id>/` (large; header has 出版社/出版年/ISBN/丛书, plus 内容简介; "这本书的其他版本" section gives first edition).
- `m.douban.com` → cross-origin redirect, unusable. `search.douban.com` is JS-rendered, unusable.
- Chinese/Taiwan library OPACs are the best source for 出版年/出版社/丛编项.

---

## 陈浩基 (Chan Ho-Kei, HK)

### 《气球人》
- Douban 35451204: 花城出版社, 2021-5, ISBN 9787536093683, 342pp, 59.80元.
- Other editions (Douban works/1103437): 明日工作室 (2011) ← earliest found; 奇幻基地 (2020); 한스미디어 (2018, Korean); NXB Hà Nội (2022, Vietnamese).
- SHORT-STORY COLLECTION: yes. Author's own preface (花城 ed.): "写作过程跨越九年的短篇连作" (linked short stories written over 9 years).
- TOC (partial, Douban): 序 / 0. 气球人 / 1. 这样的一个麻烦 / 2. 十面埋伏 / 3. 傅科摆 / 4. 远在咫尺 / … (truncated).
- Premise genre: 异能/超能力 killer protagonist. Genre labels:
  - 中国作家网 (佟欣, 2021-03-05): "《气球人》是开篇就给主角开了'无敌外挂'的 SF硬汉派推理".
  - Baidu Baike author bio: listed among 异色小说 (with 《幸存者》《魔虫人间》).
  - Douban review: "每章的小反转"; "以犯罪者为主角，已知凶手来倒推受害者以及犯罪手法".
  - Douban review (户惑美马): story 0 "用了一个连主角也不知情的叙诡" → NARRATIVE TRICK (叙述性诡计) evidence, story 0 only.
  - A Douban review title notes the 简体版 deleted some content vs 繁体版 (《傅科摆》 section).
- Recurring protagonist: "气球人" (unnamed professional killer / first-person). Not a detective.
- Settings: contemporary 都市 (HK), episodic.

### 《第歐根尼變奏曲》 / 《第欧根尼变奏曲》
- Traditional ed.: 格子盒作室 (HK), 2019-01, ISBN 9789887804048, 320pp, HK$108. (Baidu Baike entry + Douban 30410365)
- Simplified ed.: Douban 36078199, year 2022 (后浪 / 后浪出版公司, per 中国作家网 review saying 简体版由后浪推出).
- SHORT-STORY COLLECTION: yes — 中短篇小说合集, 17 pieces, 5 sections arranged like a theme-and-variations on classical music. Douban note: "华文、港产推理作家第一人陈浩基首度推出中短篇小说合集".
- TOC (17 items, from Baidu Baike):
  Var.I Prélude: Largo〈窥伺蓝色的蓝〉/ Var.II Allegro e lusinghiero〈圣诞老人谋杀案〉/ Var.III Inquieto〈头顶〉/ Var.IV Tempo di valse〈时间就是金钱〉/ Étude.1〈习作．一〉/ Var.V Lento lugubre〈作家出道杀人事件〉/ Var.VI Allegro patetico〈必要的沉默〉/ Var.VII Andante cantabile〈今年的跨年夜，特别冷〉/ Var.VIII Scherzo〈加拉星第九号事件〉/ Var.IX Allegretto poco moderato〈Ellie, My Love〉/ Étude.2〈习作．二〉/ Var.X Presto misterioso〈咖啡与香烟〉/ Var.XI Allegretto malincolico〈姊妹〉/ Var.XII Allegretto giocoso〈恶魔党杀（怪）人事件〉/ Var.XIII Allegro molto moderato〈灵视〉/ Étude.3〈习作．三〉/ Var.XIV Finale: Allegro moderato ma rubato〈隐身的X〉
- Genre: mixed — Baidu Baike 题材 = 推理 / 奇幻 / 社会寓言; "结合本格推理与叙事诡计，部分篇章嵌入音乐化叙事实验".
- Trick-type evidence (中国作家网, 佟欣 2021-03-05 — https://www.chinawriter.com.cn/n1/2021/0305/c404031-32043796.html):
  - 〈窥伺蓝色的蓝〉: "可以看出他对叙述性诡计的熟练运用" → NARRATIVE TRICK confirmed; also 社会派 stance.
  - 〈时间就是金钱〉: SF (科幻色彩强烈); won 倪匡科幻奖 (per Baidu Baike author bio).
  - 〈作家出道杀人事件〉: "集合了不错的核诡和多重逆转等本格推理最看重的特质" → 本格 + MULTIPLE-SOLUTIONS/reversals evidence.
  - 〈隐身的X〉: "这是一篇日常推理" set in a university elective class → 日常之谜 confirmed, 校园-ish setting.
  - Collection overall spans 本格 / 硬汉 / SF / 社会派 / 悬疑 / 玄幻 / 奇幻.
- Note: 〈杰克魔豆杀人事件〉 and 〈蓝胡子的密室〉 are EARLY prize-shortlisted works mentioned in the author bio; whether they are inside this collection is NOT confirmed by the TOC above (they are not listed) — treat as separate.

### 《山羊獰笑的剎那》 / 《山羊狞笑的刹那》 (simplified 山羊狞笑的刹那)
- TITLE EXISTS. Publisher: 皇冠 (Crown, Taiwan). Announced in 皇冠讀樂電子報 第841期, 發報日 2018-03-14: "如今在春暖花開的三月，浩基又為大家帶來了《山羊獰笑的剎那》" (http://epaper.crown.com.tw/read/841.html). Crown product page bid=566004.
- Baidu Baike (陳浩基 author bio, in the 第歐根尼變奏曲 entry): "2018年推出恐怖奇幻小说《山羊狞笑的剎那》".
- Genre labels: 皇冠 editor: "《山羊獰笑的剎那》是恐怖、奇幻、懸疑等各種類型的華麗變奏，它將跨越推理的界線，顛覆你對鬼故事的認知". 皇冠 reviewer (小小平): "跨足到恐怖、奇幻、青春" + "骨子裡還是一本用「推理思維」寫就的娛樂小說，縝密的布局、出人意表的結局、暗號解謎".
- CIPHER: 暗號解謎 explicitly mentioned by 皇冠 → cipher element present.
- Setting: 校園 (university dormitory; 大一男學生 protagonist; 「諾宿七大怪談」 campus ghost stories) + 恐怖怪談.
- 中国作家网 review declines to describe it further to avoid spoilers ("考慮到涉及劇透，在此便不多言").
- Simplified/mainland edition: NOT FOUND (UNVERIFIED).
- Series: none found.

---

## 周浩晖 — CORRECTIONS (deep dive; series = 刑警罗飞系列)
### 《凶画》
- FIRST ed.: 2005-07, 中国长安出版社. (First-ed ISBN ambiguous: Douban 9787801753038 / Baike 9787801739094 — UNRESOLVED.)
- Other eds: 菁品文化 (Taiwan) 2008-10 ISBN 9789866773624 ← this was the 2008-10 I originally saw; 国际文化出版公司 2009-09 ISBN 9787801739445 (丛书 刑警罗飞系列, "凶画：刑警罗飞系列第一季 02"); 海南出版社 2015.
- Genre labels: publisher copy 「秉承了日本传统本格风格的悬疑推理」; Baidu Baike 作品类型 「侦探/悬疑/推理」; marketed in 恐怖 imprint 「胆小鬼中外恐怖系列丛书」; reviewers call it 本格派.
- TRICKS WITH EVIDENCE: **closed-circle (暴风雪山庄)** — blurb 「天降大雪，小小的寺庙顿时成了一座信息孤岛」; chapter 「大雪封山」; listed in Douban curated 「【中国有推理】长篇暴风雪山庄」. **faceless-corpse (无面尸)** MEDIUM-HIGH — 「无头鬼」传言, chapter titles 「行走的尸体」「无头恶草」. No evidence for 密室/不在场证明/叙述性诡计/时刻表/凶器消失/多重解答/暗号/一人二角.
- Setting: 孤岛/雪原/山区寺庙 (枯木禅寺, 大雪封山, 南明山区, 「死亡谷」传说).

### 《鬼望坡》
- FIRST ed.: 2007-03, 内蒙古人民出版社, ISBN 9784391623932, 丛书「推理书系原创系列」.
- Other eds: 菁品文化 (Taiwan) 2008; 国际文化出版公司 2009-09 ISBN 9787801739445 (丛书 刑警罗飞系列); 海南出版社 2015.
- Genre: sources split — 悬疑风格 / 「带着沉重社会现实的本格派推理」 / 社会派.
- TRICKS WITH EVIDENCE: **closed-circle / 孤岛** MEDIUM — 「偏僻的明泽岛」, 「岛上却发生了连环凶案」; reviewer 那多's piece titled 「又见孤岛」. Plus an impossible-appearance 谜面. No source uses 暴风雪山庄 for this book. No other types.
- Setting: 孤岛 (明泽岛, 渤海) + 岛屿村落.

### Series / 死亡通知单 / 暗黑者
- Both 《鬼望坡》 and 《凶画》 belong to **「刑警罗飞系列」** (Douban series 8438, 共7册). Recurring protagonist **罗飞** (刑警).
- 「死亡通知单」 is a sub-cycle INSIDE 刑警罗飞系列 (2009–2011), NOT a separate series.
- 《暗黑者》 is the 剧集/retitle branding of 《死亡通知单》 (CCTV《读书》 2022-11-28 episode 「周浩晖 《暗黑者》 刑警罗飞」). 罗飞 IS the detective in it too.

## 呼延云
### 《嬗变》 (2009)
- 河南文艺出版社, 2009. ISBN 978-7-80765-151-2, CNY26.00, 310pp, 24cm.
- 丛编项 (series statement, library CIP): "离奇时代.呼延云推理系列".
- Subtitle/other title: 杀戮者与推理者的顶级较量.
- Source: 河南省图书馆 OPAC https://tscx.open.ha.cn/opac/book/720263ca74519167f424bf6a9ae361ec

### 《真相推理师》
- Douban suggest returns individual volumes, not one book → 系列名.
- Baidu Baike 「真相推理师系列」: 2018年江苏文艺出版社出版的图书; 作者 呼延云; 出版时间 2018年7月; ISBN 9787539986920; 定价 220元; 32开.
- Volumes listed in Baike 内容简介: 《真相推理师：嬗变》《真相推理师：幸存》《真相推理师：复仇》《真相推理师：破镜》《真相推理师：凶宅》 (5). Bookdao lists "真相推理师系列（套装全五册）".
- Recurring characters (Baike): 刑事鉴识专家刘思缈; 女法医蕾蓉 (appears in 〈凶宅〉).
- Genre/case types per Baike: 密室杀人、凶宅谜案、复仇诡计; 社会议题 (保健品诈骗、家庭悲剧); "以精密诡计为核心".
- Douban: 《真相推理师：嬗变》 2017 (26604034); 《真相推理师：凶宅》 2018 (27120450).
- Whether 《真相推理师：嬗变》 is a retitle of 2009 《嬗变》: same blurb text (血骨头/石头棺材/火柴盒) → very likely, pending subagent confirmation.

---

## 唐隐
### 《大唐悬疑录》 (HISTORICAL MYSTERY series; the title the user may have meant)
- 4 volumes:
  1. 《大唐悬疑录：兰亭序密码》 2016-01, ISBN 9787313133434 (Baidu Baike says 上海紫焰文化传媒; also "2015年12月国内上市" mentioned). New ed. 2020-06 人民文学出版社 ISBN 9787020134267.
  2. 《大唐悬疑录2：璇玑图密码》 2016-08, ISBN 9787214192974. New ed. 2020-06 人民文学出版社 ISBN 9787020132638.
  3. 《大唐悬疑录3：长恨歌密码》 2017-02, ISBN 9787214202215.
  4. 《大唐悬疑录4：大明宫密码》 2017-08, ISBN 9787214210722.
- 繁体版 by 春天出版社 (Taiwan) from 2016-06-07; 系列繁体版累计加印达61次.
- Recurring protagonists: 女神探裴玄静 (female detective) + 郎中崔淼. Supporting historical figures: 聂隐娘, 段成式, 韩湘子, 白居易, 唐宪宗.
- Genre labels: 历史悬疑 / 文化悬疑 / "悬疑；推理；文化；侦探；历史"; 唐隐 styled "中国文化悬疑小说第一人".
- CIPHER evidence: 京华时报 — 《兰亭序密码》's puzzle "被发现是一首'离合诗'，而离合诗就是古代的密码题" → 暗号密码/密码题 element.
- Setting: 唐 (Tang dynasty), 元和年间 (815–819), 长安/大明宫.
- Also by 唐隐: 《大唐悬疑录：最后的狄仁杰》系列.

### 《大明悬案录》 — ⚠ NOT FOUND as a 唐隐 title
- Douban suggest returns ZERO results for 大明悬案录.
- Titles that DO exist and are NOT by 唐隐:
  - 《大明悬案录：血棋局》 by 望舒 — 豆瓣阅读 web serial (古风历史悬疑, 密室 in the premise, protagonist 锦衣卫千户沈惟 + 病弱公子谢玄). https://read.douban.com/column/74758507/
  - 《穿越之大明悬案录》 by 晨義散人 — unrelated web novel. https://read.douban.com/column/64369801/
- Closest 唐隐 title containing 大明: 《大唐悬疑录4：大明宫密码》.
- STATUS: 唐隐《大明悬案录》 = UNVERIFIED / most likely does not exist.

---

## 马伯庸
### 《风起陇西》
- 光明网「中国网络小说好看榜」(2017-06-27): "著名作家马伯庸于2005年在起点中文网创作的古代谍战小说《风起陇西》" → FIRST appearance 2005, 起点中文网, genre label 古代谍战小说.
- Douban editions: 2011 (6025373), 2017 (27113800).
- Protagonists (光明网): 荀诩 (字孝和) central; also 陈恭(=白帝), 糜冲, 狐忠, 高堂秉, 柳萤, 郭刚, 邓先.
- Setting: 三国 (Three Kingdoms), 魏/蜀/吴; 蜀汉建兴七年 / 魏太和三年; 陇西, 南郑, 陈仓.
- Hidden-identity/mole structure is central to the espionage plot (双重身份 as spy-fiction convention).

### 《长安十二时辰》
- Douban: 2017, 上/下 (26899537 / 26899538).
- Origin: 人民网/中国新闻出版广电报 (2019-08-07) — story originated from 马伯庸's 2016 知乎 answer to a question about where one would set an 《刺客信条》 story; he then expanded it into the novel 《长安十二时辰》 and published it.
- Structure: 24-hour countdown ("十二个时辰"), 上元节, 长安; 靖安司; 望楼 city-wide signal network for transmitting messages.
- (See subagent C for full detail.)

---

## 蔡骏
### 《无尽之夏》
- Serialized: 《收获》2018年长篇专号（秋卷）(中国作家网 2018-09-13 选读).
- Book: 北京十月文艺出版社, 2018年10月, ISBN 9787530218945, 45.00元 (中国作家网 书汇 2018-12-20).
- Setting: 1997, 上海 (苏州河, 南京路) → 崇明岛; 台风「白鲸」; 30-years-earlier historical tragedy.
- Genre framing (中国作家网): "悬疑作家蔡骏倾情书写一代人的年少和离愁。不止是悬疑小说" ; 青春/成长 + 悬疑.

### 《谋杀似水年华》
- Douban 6719658: 2011.

---

## 那多
### 《骑士的献祭》
- 上海文艺出版社, 2020-05/06. ISBN 9787532175413. Standalone, no series, no recurring detective.
- Genre: 现实题材的犯罪小说 / 社会派推理 (author's own label: "现实题材的犯罪小说").
- Inspired by the 2011 上海宝山7.14杀人碎尸案 (author-confirmed).
- NO evidence for any of the 14 trick types; author deliberately avoided complex plotting.

### 《亡者低语》
- 新世界出版社, 2010-11, ISBN 9787510413544. Later ed. 北京联合出版公司 2020-05, ISBN 9787559641069.
- Series: 《那多灵异手记》 (Douban series 4065, 17 vols); Baike: 12th work in the series, sequel to 《亡者永生》. Recurring protagonist: 记者那多 (first-person narrator named after author). Supporting: 梁应物, 何夕, 郭栋, 林杰.
- Genre: 悬疑小说 / 灵异 + 软科幻. NO evidence for any of the 14 trick types.

---

## 雷米
### 《殉罪者》
- 中国友谊出版公司 (磨铁图书), 2016-07, ISBN 9787505737396.
- RETITLED 2022-04 重庆出版社/华章同人 as 《执念》 ISBN 9787229166489 (same work, same TOC).
- STANDALONE — explicitly not 心理罪/方木 (北京晨报 2016-08-26: "并没有延续《心理罪》主要人物方木等的故事").
- Genre: 犯罪心理小说 / 悬疑推理 / 社会派.
- TRICK: 模仿杀人/模仿作案 (nursery-rhyme family / imitation crime) — evidence from review titles. No other types.

---

## 蜘蛛
### 《十宗罪2》
- 湖南文艺出版社, 2011-07, ISBN 9787540449834. Subtitle given two ways: 中国十大恐怖凶杀案 (Douban) vs 中国十大变态凶杀案 (library CIP 其它题名).
- Series: 《十宗罪》 (Douban series 12848, 8 vols).
- Recurring cast: 梁教授 (梁书夜, 特案组组长, wheelchair), 画龙, 包斩, 苏眉.
- Structure: 10 cases × 5 chapters → a case collection, not a single novel.
- Genre: 推理、恐怖、犯罪 / 悬疑小说; marketing "中国版《犯罪心理》".
- Publisher claims adaptation from real cases; a prominent reader review disputes it.
- NO evidence for any of the 14 trick types.

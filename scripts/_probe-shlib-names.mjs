/**
 * 探针 9：上图作者索引对**本库现有拼法**的命中率
 * ============================================
 * 本库的作者名是历轮整理出来的固定写法（`S·S·范·达因`、`多萝西·L·塞耶斯`、
 * `弗里曼·威尔斯·克劳夫茨`…），未必等于上图作者索引里的规范形式。
 * 若命中率低，就要写「拼法回退」（去中圆点、去缩写、取姓氏…）。
 *
 * 本探针按「全名 → 去中点缩写 → 末段姓氏」三级回退试，看哪一级救得回来。
 */
import { scanAuthor } from './lib/shlib.mjs';

const NAMES = [
  'S·S·范·达因', '多萝西·L·塞耶斯', '阿加莎·克里斯蒂', '尤·奈斯博', '江户川乱步',
  '埃勒里·奎因', '高罗佩', '陈舜臣', '冈本绮堂', '二阶堂黎人', '帕特里夏·康薇尔',
  '弗里曼·威尔斯·克劳夫茨', '约瑟芬·铁伊', '雷蒙德·钱德勒', '宫部美雪', '京极夏彦',
  '保罗·霍尔特', '安东尼·霍洛维茨', '达希尔·哈米特', '约翰·迪克森·卡尔',
];

/** 末段姓氏：去掉「·」分段里的名字部分；CJK 直接原样 */
const surname = (n) => {
  const segs = String(n).split(/[·.．]/).filter(Boolean);
  return segs.length > 1 ? segs[segs.length - 1] : n;
};
/** 去掉中圆点与缩写段：S·S·范·达因 → 范达因 */
const compact = (n) => String(n).replace(/[·.．\s]/g, '');

const results = [];
for (const name of NAMES) {
  let used = name;
  let r;
  try {
    r = await scanAuthor(name, { max: 5, delay: 500 });
    if (r.count === 0) {
      const s = surname(name);
      if (s !== name) {
        r = await scanAuthor(s, { max: 5, delay: 500 });
        used = s;
      }
    }
    if (r.count === 0) {
      const c = compact(name);
      if (c !== name) {
        r = await scanAuthor(c, { max: 5, delay: 500 });
        used = c;
      }
    }
  } catch (e) {
    console.log(`【${name}】✗ ${e.message}`);
    continue;
  }
  results.push({ name, used, count: r.count });
  const sample = r.records.slice(0, 3).map((x) => x.title).join('、');
  console.log(
    `【${name.padEnd(14)}】${r.count > 0 ? '✓' : '✗'} count=${String(r.count).padStart(4)}  用「${used}」  ${sample}`,
  );
  await new Promise((res) => setTimeout(res, 400));
}

const miss = results.filter((r) => r.count === 0);
console.log(`\n命中 ${results.length - miss.length} / ${results.length}；未命中：${miss.map((m) => m.name).join('、') || '无'}`);

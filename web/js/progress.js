/* 学习进度：按知识点记录答题对错，识别薄弱点，localStorage 持久化 */
(function () {
  const KEY = "ds_tutor_progress_v1";
  const MAX_EVENTS = 50; // 最近作答记录上限

  function blank() {
    return { topics: {}, events: [] };
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (d && typeof d === "object" && d.topics) return d;
    } catch { /* 数据损坏时重置 */ }
    return blank();
  }

  function save(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

  /**
   * 记录一次作答
   * @param {string} topic 知识点标签（如 "栈与队列"）
   * @param {boolean} ok 是否答对
   * @param {object} meta {kind: 题型, brief: 题目简述}
   */
  function record(topic, ok, meta = {}) {
    topic = (topic || "未标注").trim().slice(0, 20) || "未标注";
    const d = load();
    const t = (d.topics[topic] ||= { right: 0, wrong: 0 });
    ok ? t.right++ : t.wrong++;
    d.events.unshift({
      ts: Date.now(), topic, ok,
      kind: meta.kind || "",
      brief: (meta.brief || "").replace(/\s+/g, " ").slice(0, 60),
    });
    if (d.events.length > MAX_EVENTS) d.events.length = MAX_EVENTS;
    save(d);
  }

  /**
   * 汇总统计
   * @returns {{total, right, wrong, acc, topics: Array, weak: Array, events: Array}}
   * weak：作答 ≥2 次且正确率 <60% 的知识点，按正确率升序
   */
  function summary() {
    const d = load();
    let right = 0, wrong = 0;
    const topics = Object.entries(d.topics).map(([name, t]) => {
      right += t.right; wrong += t.wrong;
      const total = t.right + t.wrong;
      return { name, right: t.right, wrong: t.wrong, total, acc: total ? t.right / total : 0 };
    }).sort((a, b) => b.total - a.total || a.acc - b.acc);
    const total = right + wrong;
    const weak = topics.filter((t) => t.total >= 2 && t.acc < 0.6)
      .sort((a, b) => a.acc - b.acc);
    return { total, right, wrong, acc: total ? right / total : 0, topics, weak, events: d.events };
  }

  /** 系统提示词用的学习档案摘要（无记录时返回空串） */
  function promptBrief() {
    const s = summary();
    if (!s.total) return "";
    let txt = `\n【学生学习档案】累计测验 ${s.total} 题，总正确率 ${Math.round(s.acc * 100)}%。`;
    if (s.weak.length) {
      txt += "薄弱知识点：" + s.weak.map((t) => `${t.name}（答对 ${t.right}/${t.total}）`).join("、") + "。";
      txt += "讲解涉及这些知识点时请放慢、多举例；学生主动要求练题或一个话题讲解收尾时，可优先针对薄弱点用 quiz 出题。";
    } else {
      txt += "各知识点掌握尚可，出题时可适当增加难度。";
    }
    return txt;
  }

  function clear() { localStorage.removeItem(KEY); }

  window.Progress = { record, summary, promptBrief, clear };
})();

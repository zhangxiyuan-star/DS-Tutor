/* ============================================================
 * 可视化引擎：本地根据真实算法生成动画帧并渲染
 * LLM 只负责选剧目和传数据，所有动画/序列由这里计算，保证教学正确
 *
 * Visualizer.create(spec) -> {ok,title,frames,summary} | {ok:false,error}
 * Visualizer.mount(container, spec) -> 在容器内挂载播放器卡片
 * ============================================================ */
(function () {
  // ---------------- 主题色 ----------------
  const C = {
    nodeFill: "#fffdf7",
    nodeStroke: "#8d8778",
    text: "#2a2721",
    active: "#b3503a",   // 当前访问/交换（赭红）
    done: "#2e6d5b",     // 已完成（松绿）
    hint: "#a87f2f",     // 比较/发现（金）
    edge: "#b8b09e",
    edgeActive: "#2e6d5b",
    dying: "#c9b8a0",
    bar: "#8aa397",
    barSorted: "#2e6d5b",
    barCmp: "#d4a84a",
    barSwap: "#b3503a",
    barPivot: "#7d6b9e",
    rangeFill: "rgba(168,127,47,.08)",
  };

  const LIMITS = {
    seqOps: 14,       // 栈/队列/链表操作步数
    graphNodes: 9,
    treeVals: 31,
    sortVals: 12,
  };

  function esc(v) {
    return String(v).replace(/[&<>"]/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[s]));
  }
  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
  function cap(v, n = 5) { const s = String(v); return s.length > n ? s.slice(0, n) + "…" : s; }

  // ---------------- 帧构造器（各算法） ----------------

  // 栈：数组尾部为栈顶，竖排，栈顶在上
  function buildStack(spec) {
    const frames = [];
    let s = (spec.initial || []).slice();
    frames.push({ caption: "初始状态，栈顶在上方", cells: s.slice(), marks: s.map((_, i) => (i === s.length - 1 ? "top" : "")) });

    for (const op of spec.ops || []) {
      if (op.op === "push") {
        if (!isNum(op.value) && typeof op.value !== "string") return err("push 操作缺少 value");
        frames.push({ caption: `执行 push(${cap(op.value)})：新元素从栈顶进入`, cells: [...s, op.value], marks: marksWith(s.length + 1, s.length, "entering") });
        s.push(op.value);
        frames.push({ caption: `入栈完成，top 指向 ${cap(op.value)}`, cells: s.slice(), marks: marksWith(s.length, s.length - 1, "top") });
      } else if (op.op === "pop") {
        if (!s.length) frames.push({ caption: "执行 pop()：栈已空，下溢（无法弹出）", cells: [], marks: [] });
        else {
          const v = s[s.length - 1];
          frames.push({ caption: `执行 pop()：栈顶元素 ${cap(v)} 被取出`, cells: s.slice(), marks: marksWith(s.length, s.length - 1, "leaving") });
          s.pop();
          frames.push({ caption: `弹出 ${cap(v)} 完成，新的栈顶${s.length ? "是 " + cap(s[s.length - 1]) : "——栈空"}`, cells: s.slice(), marks: marksWith(s.length, s.length - 1, "top") });
        }
      } else return err("栈只支持 push / pop 操作");
    }
    if (frames.length > 200) return err("操作步数过多");
    return ok("stack", "栈 · push/pop 演示", frames);
  }
  function marksWith(len, idx, mark) {
    return Array.from({ length: len }, (_, i) => (i === idx ? mark : ""));
  }

  // 队列：横排固定槽位 + front/rear 指针
  function buildQueue(spec) {
    const frames = [];
    const q = { cells: (spec.initial || []).slice(), front: 0, rear: (spec.initial || []).length };
    const pushFrame = (caption, markIdx, mark) =>
      frames.push({ caption, cells: q.cells.slice(), front: q.front, rear: q.rear, markIdx: markIdx ?? -1, mark: mark || "" });

    pushFrame("初始状态：front 指向队头，rear 指向下一个入队位置");
    for (const op of spec.ops || []) {
      if (op.op === "enqueue") {
        if (!isNum(op.value) && typeof op.value !== "string") return err("enqueue 操作缺少 value");
        pushFrame(`执行 enqueue(${cap(op.value)})：元素到达队尾`, q.rear, "entering");
        q.cells[q.rear] = op.value;
        q.rear++;
        pushFrame(`入队完成，rear 后移，队中 ${q.rear - q.front} 个元素`);
      } else if (op.op === "dequeue") {
        if (q.front >= q.rear) pushFrame("执行 dequeue()：队列已空，无法出队");
        else {
          const v = q.cells[q.front];
          pushFrame(`执行 dequeue()：队头元素 ${cap(v)} 出队`, q.front, "leaving");
          q.cells[q.front] = null;
          q.front++;
          pushFrame(`出队完成，front 后移${q.front === q.rear ? "，队列空" : ""}`);
        }
      } else return err("队列只支持 enqueue / dequeue 操作");
    }
    return ok("queue", "队列 · 入队/出队演示", frames);
  }

  // 单链表：固定槽位，插入/删除时分镜展示指针变化
  function buildLinkedList(spec) {
    const frames = [];
    let list = (spec.initial || []).slice();
    const maxLen = list.length + (spec.ops || []).filter((o) => o.op === "insert").length;

    const frame = (caption, nodes, arrows, headSlot, extra) =>
      frames.push(Object.assign({ caption, slots: maxLen + 1, nodes, arrows, headSlot: headSlot ?? null }, extra || {}));

    const snap = (offset = 0, startSlot = 0) =>
      list.map((v, i) => ({ v, slot: i + offset + startSlot, state: "normal" }));
    const arrowsOf = (nodes, opts = {}) =>
      nodes.slice(0, -1).map((n, i) => ({ from: n.slot, to: nodes[i + 1].slot, state: "normal" }))
        .concat(nodes.length ? [{ from: nodes[nodes.length - 1].slot, to: null, state: "normal" }] : []);

    frame("单链表初始状态：head 指向首元结点，结点的 next 指针串成一条链，末结点指向 ∧",
      snap(), arrowsOf(snap()), 0);

    for (const op of spec.ops || []) {
      const idx = op.index;
      if (op.op === "insert") {
        if (!isNum(idx) || idx < 0 || idx > list.length) return err(`insert 的 index 必须在 0~${list.length} 之间`);
        if (!isNum(op.value) && typeof op.value !== "string") return err("insert 缺少 value");

        // 定位前驱（逐结点路径帧）
        for (let p = 0; p < Math.max(idx - 1, 0); p++) {
          const nodes = snap();
          const ar = arrowsOf(nodes);
          nodes[p].state = "active";
          if (p > 0) ar[p - 1].state = "active";
          frame(`沿 next 指针向后查找：当前到达第 ${p + 1} 个结点 ${cap(list[p])}`, nodes, ar, 0);
        }
        if (idx > 0) {
          const nodes = snap();
          const ar = arrowsOf(nodes);
          nodes[idx - 1].state = "active";
          frame(`找到插入位置的前驱：第 ${idx} 个结点 ${cap(list[idx - 1])}（在它后面插入）`, nodes, ar, 0);
        } else {
          frame("头插法：新结点将插在最前面，head 指针稍后改指向它", snap(), arrowsOf(snap()), 0);
        }

        // 新结点出现（其后结点整体右移一槽）
        let nodes = list.map((v, i) => ({ v, slot: i >= idx ? i + 1 : i, state: i >= idx ? "shift" : "normal" }));
        nodes.splice(idx, 0, { v: op.value, slot: idx, state: "new" });
        let ar = arrowsOf(nodes);
        ar.forEach((a) => { if (a.from >= idx && a.to !== null) a.state = "shift"; });
        frame(`① 申请新结点 ${cap(op.value)}（金色虚线），其后的结点为它腾出位置`, nodes, ar, idx === 0 ? 0 : 0);

        // 新结点指向后继
        nodes = nodes.map((n) => ({ ...n, state: n.state === "shift" ? "normal" : n.state }));
        ar = arrowsOf(nodes);
        if (idx < list.length) ar[idx].state = "active"; // 新结点 -> 原后继
        frame(idx < list.length
          ? `② 新结点的 next 指向后继 ${cap(list[idx])}`
          : "② 新结点位于链尾，next 指向 ∧", nodes, ar, 0);

        // 前驱改指向 / head 移动
        ar = arrowsOf(nodes);
        if (idx < list.length) ar[idx].state = "active";
        if (idx > 0) {
          ar[idx - 1] = { from: idx - 1, to: idx, state: "active" };
          frame(`③ 前驱 ${cap(list[idx - 1])} 的 next 改指向新结点，插入完成`, nodes, ar, 0);
        } else {
          frame("③ head 改指向新结点，头插完成", nodes, ar, idx);
        }
        list.splice(idx, 0, op.value);
      } else if (op.op === "remove") {
        if (!isNum(idx) || idx < 0 || idx >= list.length) return err(`remove 的 index 必须在 0~${list.length - 1} 之间`);
        // 定位
        for (let p = 0; p < Math.max(idx, 0); p++) {
          const nodes = snap();
          const ar = arrowsOf(nodes);
          nodes[p].state = "active";
          if (p > 0) ar[p - 1].state = "active";
          frame(`沿链查找待删结点：当前到达 ${cap(list[p])}`, nodes, ar, 0);
        }
        let nodes = snap();
        let ar = arrowsOf(nodes);
        nodes[idx].state = "remove";
        frame(`定位到待删结点 ${cap(list[idx])}（红色）`, nodes, ar, 0);

        if (idx > 0) {
          ar = arrowsOf(nodes);
          // 前驱跨过待删结点
          ar[idx - 1] = { from: idx - 1, to: idx + 1 < list.length ? idx + 1 : null, state: "active" };
          if (idx + 1 < list.length) ar[idx].state = "dying";
          frame(idx + 1 < list.length
            ? `前驱 ${cap(list[idx - 1])} 的 next 跨过待删结点，直接指向 ${cap(list[idx + 1])}`
            : `前驱 ${cap(list[idx - 1])} 的 next 改为 ∧`, nodes, ar, 0);
        }

        // 摘除并左移
        const removed = list[idx];
        list.splice(idx, 1);
        nodes = list.map((v, i) => ({ v, slot: i, state: i >= idx ? "shift" : "normal" }));
        ar = arrowsOf(nodes);
        frame(idx === 0
          ? `head 改指向新的首元结点${list.length ? " " + cap(list[0]) : "（链表为空）"}，删除完成`
          : `摘除结点 ${cap(removed)}，后面的结点前移，删除完成`, nodes, ar, 0);
      } else return err("链表只支持 insert / remove 操作");
    }
    if (frames.length > 60) return err("操作步数过多，请减少操作数量");
    return ok("linked_list", "单链表 · 插入/删除演示", frames);
  }

  // 二叉树：层序数组建树，四种遍历逐帧点亮
  function buildBinaryTree(spec) {
    const vals = spec.values || [];
    if (!Array.isArray(vals) || !vals.length) return err("二叉树需要非空的层序 values 数组（空位用 null）");
    if (vals.length > LIMITS.treeVals) return err(`结点数不能超过 ${LIMITS.treeVals}`);
    const orderName = { preorder: "前序遍历（根 → 左 → 右）", inorder: "中序遍历（左 → 根 → 右）",
      postorder: "后序遍历（左 → 右 → 根）", levelorder: "层序遍历（按层从上到下，同层从左到右）" };
    const tr = spec.traversal || "preorder";
    if (!orderName[tr]) return err("traversal 必须是 preorder/inorder/postorder/levelorder");

    // 完全二叉树槽位定位
    const nodes = vals.map((v, i) => {
      if (v === null || v === undefined) return null;
      const depth = Math.floor(Math.log2(i + 1));
      const pos = i - (2 ** depth - 1);
      return { id: i, v, depth, x: ((pos + 0.5) / 2 ** depth), y: depth };
    }).filter(Boolean);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [];
    nodes.forEach((n) => {
      const l = n.id * 2 + 1, r = l + 1;
      if (ids.has(l)) edges.push([n.id, l]);
      if (ids.has(r)) edges.push([n.id, r]);
    });

    const frames = [{
      caption: `${orderName[tr]}。注意观察结点点亮的先后顺序`,
      nodes: nodes.map((n) => ({ ...n, state: "idle" })), edges: edges.map((e) => [...e, "normal"]), output: "",
    }];

    const order = [];
    const stateAt = new Map();
    function emit(nodeId, queueInfo) {
      const n = vals[nodeId];
      order.push(n);
      stateAt.set(nodeId, "done");
      frames.push({
        caption: queueInfo || `访问结点 ${cap(n)}，输出：${order.map((x) => cap(x)).join(" → ") || "（空）"}`,
        nodes: nodes.map((x) => ({ ...x, state: x.id === nodeId ? "active" : (stateAt.get(x.id) || "idle") })),
        edges: edges.map(([a, b]) => [a, b, b === nodeId ? "active" : (stateAt.get(a) === "done" && stateAt.get(b) === "done" ? "soft" : "normal")]),
        output: order.slice(),
      });
    }

    if (tr === "preorder" || tr === "inorder" || tr === "postorder") {
      function dfs(i) {
        if (!ids.has(i)) return;
        if (tr === "preorder") emit(i);
        dfs(i * 2 + 1);
        if (tr === "inorder") emit(i);
        dfs(i * 2 + 2);
        if (tr === "postorder") emit(i);
      }
      dfs(0);
    } else {
      const q = [0];
      while (q.length) {
        const i = q.shift();
        emit(i, `队首 ${cap(vals[i])} 出队并访问；当前队列：[${q.map((x) => cap(vals[x])).join(", ")}]，输出：${order.join(" → ")}`);
        const l = i * 2 + 1, r = l + 1;
        if (ids.has(l)) q.push(l);
        if (ids.has(r)) q.push(r);
      }
    }
    frames.push({
      caption: `${orderName[tr]}结束，完整序列：${order.map((x) => cap(x)).join(" → ")}`,
      nodes: nodes.map((n) => ({ ...n, state: "done" })),
      edges: edges.map((e) => [...e, "soft"]), output: order.slice(),
    });
    return ok("binary_tree", `二叉树 · ${orderName[tr]}`, frames, `${orderName[tr].split("（")[0]}序列：${order.map((x) => cap(x)).join(" → ")}`);
  }

  // 图：圆形布局，DFS/BFS，显示发现/访问状态与边
  function buildGraph(spec) {
    const labels = spec.nodes || [];
    if (!Array.isArray(labels) || labels.length < 2) return err("图至少需要 2 个结点");
    if (labels.length > LIMITS.graphNodes) return err(`图结点不超过 ${LIMITS.graphNodes} 个`);
    if (new Set(labels.map(String)).size !== labels.length) return err("结点标签不能重复");
    const alg = spec.algorithm === "bfs" ? "bfs" : "dfs";
    if (!spec.start || !labels.includes(spec.start)) return err(`start 必须是结点标签之一：${labels.join("/")}`);

    const adj = new Map(labels.map((l) => [l, []]));
    for (const e of spec.edges || []) {
      if (!Array.isArray(e) || e.length !== 2 || !labels.includes(e[0]) || !labels.includes(e[1]))
        return err(`边必须是两个存在结点的标签，如 ["A","B"]，收到 ${JSON.stringify(e)}`);
      adj.get(e[0]).push(e[1]);
      adj.get(e[1]).push(e[0]);
    }
    adj.forEach((v) => v.sort((a, b) => labels.indexOf(a) - labels.indexOf(b)));

    // 圆形坐标
    const n = labels.length;
    const pos = new Map();
    labels.forEach((l, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pos.set(l, { x: 0.5 + 0.42 * Math.cos(ang), y: 0.5 + 0.40 * Math.sin(ang) });
    });
    const nodeSnap = (stateMap, activeLabel) => labels.map((l) =>
      ({ v: l, ...pos.get(l), state: l === activeLabel ? "active" : (stateMap.get(l) || "idle") }));
    const edgeSnap = (treeEdges, activeEdge) => (spec.edges || []).map(([a, b]) => {
      let st = "normal";
      if (activeEdge && ((activeEdge[0] === a && activeEdge[1] === b) || (activeEdge[0] === b && activeEdge[1] === a))) st = "active";
      else if (treeEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) st = "soft";
      return [a, b, st];
    });

    const frames = [];
    const state = new Map(); // idle/discovered/done
    const order = [];
    const treeEdges = [];
    const startFrame = (caption, bag, activeLabel, activeEdge) =>
      frames.push(Object.assign({
        caption,
        nodes: nodeSnap(state, activeLabel),
        edges: edgeSnap(treeEdges, activeEdge),
        output: order.slice(),
      }, bag || {}));

    startFrame(`${alg === "dfs" ? "深度优先搜索（DFS）：一条路走到黑，走不通就回溯" : "广度优先搜索（BFS）：由近及远按层扩展"}，起点 ${spec.start}`,
      { frontier: [] });

    if (alg === "dfs") {
      const stack = [spec.start];
      state.set(spec.start, "discovered");
      startFrame(`起点 ${spec.start} 入栈，标记为“已发现”（金色描边）`, { frontier: stack.slice() });
      state.set(spec.start, "done");
      order.push(spec.start);
      startFrame(`访问栈顶 ${spec.start}（红色）并输出`, { frontier: stack.slice() }, spec.start);
      while (stack.length) {
        const u = stack[stack.length - 1];
        const next = adj.get(u).find((w) => !state.has(w));
        if (next) {
          state.set(next, "discovered");
          stack.push(next);
          startFrame(`从 ${cap(u)} 沿未走过的边抵达 ${cap(next)}：入栈、标记已发现`, { frontier: stack.slice() }, next, [u, next]);
          state.set(next, "done");
          order.push(next);
          treeEdges.push([u, next]);
          startFrame(`访问 ${cap(next)}（红色）。输出：${order.map((x) => cap(x)).join(" → ")}`, { frontier: stack.slice() }, next);
        } else {
          stack.pop();
          if (stack.length)
            startFrame(`${cap(u)} 的邻接点都已访问，回溯到 ${cap(stack[stack.length - 1])}`, { frontier: stack.slice() });
        }
      }
    } else {
      const q = [spec.start];
      state.set(spec.start, "discovered");
      startFrame(`起点 ${spec.start} 入队，标记为“已发现”`, { frontier: q.slice() });
      while (q.length) {
        const u = q.shift();
        state.set(u, "done");
        order.push(u);
        startFrame(`队首 ${cap(u)} 出队并访问（红色）。输出：${order.map((x) => cap(x)).join(" → ")}`, { frontier: q.slice() }, u);
        const added = [];
        adj.get(u).forEach((w) => {
          if (!state.has(w)) { state.set(w, "discovered"); q.push(w); treeEdges.push([u, w]); added.push(w); }
        });
        if (added.length)
          startFrame(`把 ${cap(u)} 未访问的邻接点 ${added.map((x) => cap(x)).join("、")} 入队（金色描边），绿色边记录遍历路径`,
            { frontier: q.slice() });
      }
    }
    startFrame(`${alg === "dfs" ? "DFS" : "BFS"} 结束，访问序列：${order.map((x) => cap(x)).join(" → ")}（绿色边为遍历经过的边）`,
      { frontier: [] });
    return ok("graph", `图 · ${alg === "dfs" ? "DFS 深度优先" : "BFS 广度优先"}`, frames,
      `${alg === "dfs" ? "DFS" : "BFS"} 访问序列：${order.map((x) => cap(x)).join(" → ")}`);
  }

  // 排序：柱状图，逐帧标记 比较/交换/基准/有序
  function buildSort(spec) {
    const alg = spec.algorithm;
    const a = spec.values || [];
    if (!Array.isArray(a) || a.length < 2) return err("排序需要至少 2 个数字");
    if (a.length > LIMITS.sortVals) return err(`排序元素不超过 ${LIMITS.sortVals} 个`);
    if (!a.every(isNum)) return err("排序 values 必须全是数字");
    const names = { bubble: "冒泡排序", selection: "选择排序", insertion: "插入排序", quick: "快速排序", merge: "归并排序" };
    if (!names[alg]) return err("algorithm 必须是 bubble/selection/insertion/quick/merge");

    const frames = [];
    const sorted = new Set();
    const snap = (caption, marks) =>
      frames.push({ caption, a: a.slice(), sorted: [...sorted], marks: marks || {} });

    snap(`${names[alg]}开始：金色=正在比较，红色=交换/写入，紫色=基准，绿色=已确定位置`, {});

    if (alg === "bubble") {
      for (let i = 0; i < a.length - 1; i++) {
        let swapped = false;
        for (let j = 0; j < a.length - 1 - i; j++) {
          snap(`比较相邻元素 ${a[j]} 和 ${a[j + 1]}`, { cmp: [j, j + 1] });
          if (a[j] > a[j + 1]) {
            [a[j], a[j + 1]] = [a[j + 1], a[j]]; swapped = true;
            snap(`${a[j + 1]} > ${a[j]}，逆序，交换`, { swap: [j, j + 1] });
          }
        }
        sorted.add(a.length - 1 - i);
        snap(`第 ${i + 1} 趟结束，${a[a.length - 1 - i]} 已沉到最终位置`, {});
        if (!swapped) { for (let k = 0; k < a.length - 1 - i; k++) sorted.add(k); break; }
      }
      a.forEach((_, i) => sorted.add(i));
    } else if (alg === "selection") {
      for (let i = 0; i < a.length - 1; i++) {
        let m = i;
        snap(`第 ${i + 1} 轮：在未排序区找最小值，先假定 ${a[m]} 最小`, { pivot: m, range: [i, a.length - 1] });
        for (let j = i + 1; j < a.length; j++) {
          snap(`比较 ${a[j]} 与当前最小 ${a[m]}`, { cmp: [j, m], pivot: m, range: [i, a.length - 1] });
          if (a[j] < a[m]) { m = j; snap(`发现更小的 ${a[m]}，更新最小值位置`, { pivot: m, range: [i, a.length - 1] }); }
        }
        if (m !== i) {
          [a[i], a[m]] = [a[m], a[i]];
          snap(`把最小值 ${a[i]} 与位置 ${i + 1} 的元素交换`, { swap: [i, m] });
        }
        sorted.add(i);
        snap(`${a[i]} 就位`, {});
      }
      a.forEach((_, i) => sorted.add(i));
    } else if (alg === "insertion") {
      sorted.add(0);
      for (let i = 1; i < a.length; i++) {
        const t = a[i];
        snap(`取出未排序区第一个元素 ${t}，向左侧有序区找插入位置`, { pivot: i });
        let j = i - 1;
        while (j >= 0 && a[j] > t) {
          snap(`比较：${a[j]} > ${t}，${a[j]} 后移一格`, { cmp: [j, j + 1], pivot: j + 1 });
          a[j + 1] = a[j];
          snap(`${a[j]} 后移完成`, { swap: [j, j + 1] });
          j--;
        }
        a[j + 1] = t;
        sorted.add(i);
        snap(`${t} 插入到位置 ${j + 2}，有序区扩大到前 ${i + 1} 个`, {});
      }
      a.forEach((_, i) => sorted.add(i));
    } else if (alg === "quick") {
      function qs(lo, hi) {
        if (lo > hi) return;
        if (lo === hi) { sorted.add(lo); snap(`单元素区间 ${a[lo]} 天然有序`, {}); return; }
        snap(`对区间 [${lo + 1}..${hi + 1}] 分区，选最右元素 ${a[hi]} 为基准 pivot`, { pivot: hi, range: [lo, hi] });
        const pivot = a[hi]; let i = lo;
        for (let j = lo; j < hi; j++) {
          snap(`比较 ${a[j]} 与基准 ${pivot}`, { cmp: [j, hi], pivot: hi, range: [lo, hi] });
          if (a[j] < pivot) {
            if (i !== j) {
              [a[i], a[j]] = [a[j], a[i]];
              snap(`小元素 ${a[i]}（小于 pivot）换到左侧位置 ${i + 1}`, { swap: [i, j], pivot: hi, range: [lo, hi] });
            }
            i++;
          }
        }
        [a[i], a[hi]] = [a[hi], a[i]];
        sorted.add(i);
        snap(`基准 ${pivot} 放到位置 ${i + 1}（左小右大），该位置最终确定`, { swap: [i, hi] });
        qs(lo, i - 1);
        qs(i + 1, hi);
      }
      qs(0, a.length - 1);
      a.forEach((_, i) => sorted.add(i));
    } else {
      // 归并排序
      function ms(lo, hi) {
        if (lo >= hi) return;
        const mid = (lo + hi) >> 1;
        if (hi - lo >= 2) snap(`分割区间 [${lo + 1}..${hi + 1}] 为两半`, { range: [lo, hi] });
        ms(lo, mid); ms(mid + 1, hi);
        const tmp = [];
        let i = lo, j = mid + 1;
        snap(`合并两个有序子区间 [${lo + 1}..${mid + 1}] 与 [${mid + 2}..${hi + 1}]`, { range: [lo, hi] });
        while (i <= mid && j <= hi) {
          snap(`比较两区间队首 ${a[i]} 和 ${a[j]}`, { cmp: [i, j], range: [lo, hi] });
          tmp.push(a[i] <= a[j] ? a[i++] : a[j++]);
        }
        while (i <= mid) tmp.push(a[i++]);
        while (j <= hi) tmp.push(a[j++]);
        for (let k = 0; k < tmp.length; k++) {
          a[lo + k] = tmp[k];
          snap(`写回 ${tmp[k]} 到位置 ${lo + k + 1}`, { swap: [lo + k], range: [lo, hi] });
        }
        if (hi - lo === a.length - 1) a.forEach((_, x) => sorted.add(x));
      }
      ms(0, a.length - 1);
      a.forEach((_, i) => sorted.add(i));
    }
    snap(`排序完成：${a.join(" → ")}`, {});
    return ok("sort", `${names[alg]} · 排序过程`, frames, `排序结果：${a.join(" → ")}`);
  }

  function ok(kind, title, frames, summary) {
    return { ok: true, kind, title, frames, summary: summary || "" };
  }
  function err(msg) { return { ok: false, error: msg }; }

  // ---------------- 入口 ----------------
  function create(spec) {
    if (!spec || typeof spec !== "object") return err("可视化参数为空");
    try {
      switch (spec.kind) {
        case "stack": return buildStack(spec);
        case "queue": return buildQueue(spec);
        case "linked_list": return buildLinkedList(spec);
        case "binary_tree": return buildBinaryTree(spec);
        case "graph": return buildGraph(spec);
        case "sort": return buildSort(spec);
        default: return err(`未知可视化类型：${spec.kind}（可选 stack/queue/linked_list/binary_tree/graph/sort）`);
      }
    } catch (e) {
      return err("可视化生成异常：" + (e.message || e));
    }
  }

  /* ================ SVG 渲染（按 kind 分发） ================ */
  function svgEl(w, h, body) {
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  }
  const arrowHead = `
    <marker id="varrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.edge}"/></marker>
    <marker id="varrow-a" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.edgeActive}"/></marker>
    <marker id="varrow-d" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
      <path d="M0,0 L9,4.5 L0,9 z" fill="${C.dying}"/></marker>`;

  const CELL_W = 56, CELL_H = 40, GAP = 34;

  function renderStack(f) {
    const n = f.cells.length;
    const w = 124, h = 24 + (n + 1) * (CELL_H + 8);
    // 栈顶在上：倒序绘制
    let body = arrowHead;
    body += `<rect x="20" y="14" width="${CELL_W + 28}" height="${h - 28}" rx="6" fill="none" stroke="${C.nodeStroke}" stroke-dasharray="4 4"/>`;
    f.cells.forEach((v, i) => {
      const fromTop = n - 1 - i;
      const y = 20 + fromTop * (CELL_H + 8);
      const st = f.marks[i];
      const fill = st === "entering" ? "rgba(168,127,47,.15)" : "#fffdf7";
      const stroke = st === "top" ? C.active : (st === "entering" ? C.hint : C.nodeStroke);
      const dash = st === "entering" ? "5 3" : "";
      body += `<g class="v-anim">
        <rect x="34" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${st === "top" ? 2.4 : 1.5}" stroke-dasharray="${dash}"/>
        <text x="${34 + CELL_W / 2}" y="${y + CELL_H / 2 + 5}" text-anchor="middle" font-size="15" font-family="monospace" font-weight="600" fill="${C.text}">${esc(cap(v))}</text>
      </g>`;
      if (st === "top" || st === "entering")
        body += `<text x="${34 + CELL_W + 12}" y="${y + CELL_H / 2 + 5}" font-size="12" fill="${C.active}">top ↑</text>`;
    });
    if (!n) body += `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="${C.nodeStroke}">（空栈）</text>`;
    return svgEl(w, Math.max(h, 90), body);
  }

  function renderQueue(f) {
    const total = Math.max(f.cells.length, 4);
    const w = 24 + total * (CELL_W + GAP) + 44, h = 132;
    let body = arrowHead;
    f.cells.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const x = 24 + i * (CELL_W + GAP);
      const y = 40;
      const st = i === f.markIdx ? f.mark : "";
      const fill = st === "entering" ? "rgba(168,127,47,.15)" : "#fffdf7";
      const stroke = st === "leaving" ? C.active : (st === "entering" ? C.hint : C.nodeStroke);
      body += `<g class="v-anim">
        <rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="${st === "entering" ? "5 3" : ""}"/>
        <text x="${x + CELL_W / 2}" y="${y + 25}" text-anchor="middle" font-size="15" font-family="monospace" font-weight="600">${esc(cap(v))}</text>
      </g>`;
    });
    // front/rear 指针
    const ptr = (idx, label, color) => {
      const x = 24 + idx * (CELL_W + GAP) + CELL_W / 2;
      return `<line x1="${x}" y1="22" x2="${x}" y2="36" stroke="${color}" stroke-width="2" marker-end="url(#varrow-a)"/>
              <text x="${x}" y="16" text-anchor="middle" font-size="12" fill="${color}">${label}</text>`;
    };
    body += ptr(f.front, "front", C.done);
    body += ptr(f.rear, "rear", C.active);
    return svgEl(w, h, body);
  }

  function renderLinkedList(f) {
    const NW = 66, NH = 42, SLOT = NW + 42;
    const slots = f.slots || 6;
    const w = 24 + slots * SLOT + 30, h = 120;
    let body = arrowHead;
    const xOf = (slot) => 30 + slot * SLOT;
    // 箭头先画
    (f.arrows || []).forEach((a) => {
      const x1 = xOf(a.from) + NW, y1 = 56;
      if (a.to === null) {
        const x2 = x1 + 22;
        body += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${a.state === "dying" ? C.dying : C.edge}" stroke-width="2" ${a.state === "dying" ? 'stroke-dasharray="4 3"' : ""}/>
                 <text x="${x2 + 4}" y="${y1 + 5}" font-size="16" fill="${C.nodeStroke}">∧</text>`;
      } else {
        const x2 = xOf(a.to) - 2;
        const color = a.state === "active" ? C.edgeActive : (a.state === "dying" ? C.dying : (a.state === "shift" ? C.hint : C.edge));
        const mk = a.state === "active" ? "url(#varrow-a)" : (a.state === "dying" ? "url(#varrow-d)" : "url(#varrow)");
        body += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}" stroke="${color}" stroke-width="${a.state === "active" ? 3 : 2}"
                 marker-end="${mk}" class="v-anim" ${a.state === "dying" ? 'stroke-dasharray="6 3"' : ""}/>`;
      }
    });
    // head 指针
    if (f.headSlot !== null && f.headSlot !== undefined && f.nodes.some((n) => n.slot === f.headSlot)) {
      const hx = xOf(f.headSlot) + NW / 2;
      body += `<line x1="${hx}" y1="14" x2="${hx}" y2="30" stroke="${C.active}" stroke-width="2.4" marker-end="url(#varrow-a)"/>
               <text x="${hx}" y="10" text-anchor="middle" font-size="12" fill="${C.active}">head</text>`;
    }
    // 结点（data | next 两格）
    f.nodes.forEach((n) => {
      const x = xOf(n.slot);
      const stroke = n.state === "active" ? C.active : (n.state === "new" ? C.hint : (n.state === "remove" ? C.active : C.nodeStroke));
      const fill = n.state === "remove" ? "rgba(179,80,58,.12)" : "#fffdf7";
      body += `<g class="v-anim">
        <rect x="${x}" y="34" width="${NW}" height="${NH}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="${n.state === "normal" ? 1.5 : 2.6}" stroke-dasharray="${n.state === "new" ? "5 3" : ""}"/>
        <line x1="${x + NW - 20}" y1="34" x2="${x + NW - 20}" y2="${34 + NH}" stroke="${stroke}" stroke-width="1.2"/>
        <text x="${x + (NW - 20) / 2}" y="60" text-anchor="middle" font-size="14" font-family="monospace" font-weight="600">${esc(cap(n.v, 4))}</text>
      </g>`;
    });
    return svgEl(w, h, body);
  }

  function renderTree(f) {
    const W = 720, HDEPTH = 88;
    const depth = Math.max(...f.nodes.map((n) => n.depth));
    const h = 60 + depth * HDEPTH + 20;
    const X = (nx) => 24 + nx * (W - 48);
    const Y = (ny) => 40 + ny * HDEPTH;
    let body = arrowHead;
    f.edges.forEach(([a, b, st]) => {
      const na = f.nodes.find((x) => x.id === a), nb = f.nodes.find((x) => x.id === b);
      body += `<line x1="${X(na.x)}" y1="${Y(na.y)}" x2="${X(nb.x)}" y2="${Y(nb.y)}"
        stroke="${st === "active" ? C.edgeActive : (st === "soft" ? "rgba(46,109,91,.45)" : C.edge)}" stroke-width="${st === "active" ? 3 : 1.7}" class="v-anim"/>`;
    });
    f.nodes.forEach((n) => {
      const x = X(n.x), y = Y(n.y);
      const st = n.state;
      const fill = st === "done" ? C.done : (st === "active" ? C.active : "#fffdf7");
      const stroke = st === "idle" ? C.nodeStroke : fill;
      const tcolor = st === "idle" ? C.text : "#f8f6ef";
      body += `<g class="v-anim">
        <circle cx="${x}" cy="${y}" r="22" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>
        <text x="${x}" y="${y + 5.5}" text-anchor="middle" font-size="15" font-family="monospace" font-weight="700" fill="${tcolor}">${esc(cap(n.v, 4))}</text>
      </g>`;
    });
    return svgEl(W, h, body);
  }

  function renderGraph(f) {
    const W = 480, H = 360;
    const X = (nx) => 20 + nx * (W - 40), Y = (ny) => 20 + ny * (H - 40);
    let body = arrowHead;
    f.edges.forEach(([a, b, st]) => {
      const na = f.nodes.find((x) => x.v === a), nb = f.nodes.find((x) => x.v === b);
      body += `<line x1="${X(na.x)}" y1="${Y(na.y)}" x2="${X(nb.x)}" y2="${Y(nb.y)}"
        stroke="${st === "active" ? C.edgeActive : (st === "soft" ? "rgba(46,109,91,.55)" : C.edge)}"
        stroke-width="${st === "active" ? 3 : 1.7}" class="v-anim"/>`;
    });
    f.nodes.forEach((n) => {
      const x = X(n.x), y = Y(n.y);
      const st = n.state;
      const fill = st === "done" ? C.done : (st === "active" ? C.active : "#fffdf7");
      const stroke = st === "done" ? C.done : (st === "active" ? C.active : (st === "discovered" ? C.hint : C.nodeStroke));
      const tcolor = (st === "done" || st === "active") ? "#f8f6ef" : C.text;
      body += `<g class="v-anim">
        <circle cx="${x}" cy="${y}" r="22" fill="${fill}" stroke="${stroke}" stroke-width="${st === "discovered" ? 3 : 2}"/>
        <text x="${x}" y="${y + 5.5}" text-anchor="middle" font-size="14" font-family="monospace" font-weight="700" fill="${tcolor}">${esc(cap(n.v, 3))}</text>
      </g>`;
    });
    // 栈/队列内容显示在左下角
    if (f.frontier && f.frontier.length) {
      body += `<rect x="12" y="${H - 34}" rx="5" width="250" height="24" fill="rgba(168,127,47,.1)"/>
               <text x="20" y="${H - 17}" font-size="12" fill="${C.hint}">容器中的结点：[ ${f.frontier.map(esc).join(" , ")} ]</text>`;
    }
    return svgEl(W, H, body);
  }

  function renderSort(f) {
    const n = f.a.length;
    const W = 480, H = 240, PAD_L = 16, BASE = H - 30, TOP = 16;
    const maxV = Math.max(...f.a.map(Math.abs), 1);
    const slotW = (W - PAD_L * 2) / n;
    const bw = Math.min(34, slotW - 8);
    let body = "";
    // 区间高亮
    const r = f.marks.range;
    if (r) {
      body += `<rect x="${PAD_L + r[0] * slotW}" y="${TOP - 4}" width="${(r[1] - r[0] + 1) * slotW}" height="${BASE - TOP + 8}" fill="${C.rangeFill}" rx="4"/>`;
    }
    const colorOf = (i) => {
      if (f.sorted.includes(i)) return C.barSorted;
      if (f.marks.swap && f.marks.swap.includes(i)) return C.barSwap;
      if (f.marks.cmp && f.marks.cmp.includes(i)) return C.barCmp;
      if (f.marks.pivot === i) return C.barPivot;
      return C.bar;
    };
    f.a.forEach((v, i) => {
      const hgt = 8 + (Math.abs(v) / maxV) * (BASE - TOP - 14);
      const x = PAD_L + i * slotW + (slotW - bw) / 2;
      const y = BASE - hgt;
      body += `<g class="v-anim">
        <rect x="${x}" y="${y}" width="${bw}" height="${hgt}" rx="3" fill="${colorOf(i)}"/>
        <text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="12" font-family="monospace" font-weight="600" fill="${C.text}">${esc(v)}</text>
      </g>`;
    });
    body += `<line x1="10" y1="${BASE}" x2="${W - 10}" y2="${BASE}" stroke="${C.nodeStroke}" stroke-width="1.4"/>`;
    return svgEl(W, H, body);
  }

  const RENDERERS = {
    stack: renderStack, queue: renderQueue, linked_list: renderLinkedList,
    binary_tree: renderTree, graph: renderGraph, sort: renderSort,
  };

  /* ================ 播放器卡片 ================ */
  function mount(container, spec) {
    const result = create(spec);
    const card = document.createElement("div");
    card.className = "vis-card";

    if (!result.ok) {
      card.innerHTML = `<div class="vis-head"><span class="vis-title vis-err">可视化生成失败</span></div>
        <div class="vis-error">${esc(result.error)}</div>`;
      container.appendChild(card);
      return result;
    }

    const { frames, title, kind } = result;
    card.innerHTML = `
      <div class="vis-head">
        <span class="vis-title">◆ ${esc(title)}</span>
        <span class="vis-framecount">${frames.length} 个分镜</span>
      </div>
      <div class="vis-stage"></div>
      <div class="vis-caption"></div>
      <div class="vis-controls">
        <button class="vc-btn" data-act="first" title="回到开头">⏮</button>
        <button class="vc-btn vc-play" data-act="play" title="播放/暂停">▶</button>
        <button class="vc-btn" data-act="next" title="下一镜">⏭</button>
        <input class="vc-slider" type="range" min="0" max="${frames.length - 1}" value="0">
        <span class="vc-progress">1/${frames.length}</span>
        <span class="vc-speeds">
          <button class="vc-sp" data-ms="1000">慢</button>
          <button class="vc-sp active" data-ms="650">中</button>
          <button class="vc-sp" data-ms="350">快</button>
        </span>
      </div>`;
    container.appendChild(card);

    const stage = card.querySelector(".vis-stage");
    const captionEl = card.querySelector(".vis-caption");
    const slider = card.querySelector(".vc-slider");
    const progressEl = card.querySelector(".vc-progress");
    const playBtn = card.querySelector(".vc-play");

    let idx = 0, timer = null, ms = 650;

    function render() {
      stage.innerHTML = RENDERERS[kind](frames[idx]);
      captionEl.textContent = frames[idx].caption || "";
      slider.value = idx;
      progressEl.textContent = `${idx + 1}/${frames.length}`;
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      playBtn.textContent = "▶";
    }
    function play() {
      if (timer) { stop(); return; }
      if (idx >= frames.length - 1) { idx = 0; render(); }
      playBtn.textContent = "⏸";
      timer = setInterval(() => {
        if (idx >= frames.length - 1) { stop(); return; }
        idx++; render();
      }, ms);
    }

    card.querySelector('[data-act="first"]').onclick = () => { stop(); idx = 0; render(); };
    card.querySelector('[data-act="next"]').onclick = () => { stop(); idx = Math.min(frames.length - 1, idx + 1); render(); };
    playBtn.onclick = play;
    slider.oninput = () => { stop(); idx = +slider.value; render(); };
    card.querySelectorAll(".vc-sp").forEach((b) => {
      b.onclick = () => {
        card.querySelectorAll(".vc-sp").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        ms = +b.dataset.ms;
        if (timer) { stop(); play(); }
      };
    });

    render();
    // 自动开始播放
    setTimeout(play, 250);
    return result;
  }

  window.Visualizer = { create, mount, LIMITS };
})();

(() => {
  // Prefer repaired file first, then fallback
  const DATA_CANDIDATES = [
    "./data/questions.fixed.json",
    "./data/questions.json"
  ];

  const STORAGE_KEY = "mcq_quiz_state_v5";

  // ----- State -----
  let questionBank = [];
  let quiz = [];
  let index = 0;
  let score = 0;
  let answered = false;
  let currentFilter = "ALL";
  let mode = "ALL"; // "ALL" | "WRONG"
  let wrongSet = new Set(); // store question ids
  let stats = {}; // { [section]: { attempted, correct } }

  // ----- Elements -----
  const metaEl = document.getElementById("meta");
  const questionTextEl = document.getElementById("questionText");
  const optionsEl = document.getElementById("options");
  const feedbackEl = document.getElementById("feedback");
  const nextBtn = document.getElementById("nextBtn");
  const restartBtn = document.getElementById("restartBtn");
  const retryWrongBtn = document.getElementById("retryWrongBtn");
  const analyticsEl = document.getElementById("analytics");
  const errorBox = document.getElementById("errorBox");
  const sectionFilterEl = document.getElementById("sectionFilter");

  // Guard missing required elements
  const required = [
    ["meta", metaEl],
    ["questionText", questionTextEl],
    ["options", optionsEl],
    ["feedback", feedbackEl],
    ["nextBtn", nextBtn],
    ["restartBtn", restartBtn],
    ["retryWrongBtn", retryWrongBtn],
    ["analytics", analyticsEl],
    ["errorBox", errorBox],
    ["sectionFilter", sectionFilterEl]
  ];

  for (const [name, el] of required) {
    if (!el) {
      console.error(`Missing element id="${name}" in index.html`);
      return;
    }
  }

  // ----- Utils -----
  function showError(message) {
    errorBox.innerHTML = `<div class="error">${message}</div>`;
  }

  function clearError() {
    errorBox.innerHTML = "";
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeId(section, qText, i) {
    return `${section}|||${qText}|||${i}`;
  }

  // Extract question objects robustly (handles nested/repeated wrappers)
  function extractQuestionObjects(anyData) {
    const out = [];
    const stack = [anyData];

    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;

      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
        continue;
      }

      if (typeof cur === "object") {
        if (Array.isArray(cur.questions)) {
          stack.push(cur.questions);
        }

        if (typeof cur.q === "string" && Array.isArray(cur.options)) {
          out.push(cur);
        }

        for (const key of Object.keys(cur)) {
          if (key !== "questions") stack.push(cur[key]);
        }
      }
    }

    return out;
  }

  function normalizeQuestions(raw) {
    const candidates = extractQuestionObjects(raw);
    const seen = new Set();
    const cleaned = [];

    for (let i = 0; i < candidates.length; i++) {
      const q = candidates[i];
      const section = (q.section || "未分類").toString().trim();
      const qText = (q.q || "").toString().trim();

      if (!qText) continue;
      if (!Array.isArray(q.options) || q.options.length < 2) continue;

      const options = q.options
        .filter(o => o && typeof o.text === "string")
        .map(o => ({
          text: o.text.trim(),
          correct: o.correct === true
        }));

      if (options.length < 2) continue;
      const correctCount = options.filter(o => o.correct).length;
      if (correctCount !== 1) continue;

      // dedupe by section + question text
      const dedupeKey = `${section}|||${qText}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      cleaned.push({
        id: q.id || makeId(section, qText, i),
        section,
        q: qText,
        options
      });
    }

    return cleaned;
  }

  async function fetchFirstAvailableJson() {
    let lastErr = null;

    for (const url of DATA_CANDIDATES) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { data, url };
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error("No data file available");
  }

  // ----- Persistence -----
  function saveState() {
    const state = {
      currentFilter,
      mode,
      index,
      score,
      answered,
      wrongIds: [...wrongSet],
      stats,
      quiz
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const s = JSON.parse(raw);
      currentFilter = s.currentFilter || "ALL";
      mode = s.mode || "ALL";
      index = Number.isInteger(s.index) ? s.index : 0;
      score = Number.isFinite(s.score) ? s.score : 0;
      answered = !!s.answered;
      wrongSet = new Set(Array.isArray(s.wrongIds) ? s.wrongIds : []);
      stats = s.stats && typeof s.stats === "object" ? s.stats : {};
      quiz = Array.isArray(s.quiz) ? s.quiz : [];

      return true;
    } catch {
      return false;
    }
  }

  // ----- Filter / Mode -----
  function buildSectionFilter() {
    const sections = [...new Set(questionBank.map(q => q.section))]
      .sort((a, b) => a.localeCompare(b, "zh-HK"));

    sectionFilterEl.innerHTML = `<option value="ALL">全部</option>`;
    for (const s of sections) {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      sectionFilterEl.appendChild(opt);
    }

    if (!sections.includes(currentFilter)) currentFilter = "ALL";
    sectionFilterEl.value = currentFilter;
  }

  function getFilteredQuestions() {
    const bySection = currentFilter === "ALL"
      ? questionBank
      : questionBank.filter(q => q.section === currentFilter);

    if (mode === "WRONG") {
      return bySection.filter(q => wrongSet.has(q.id));
    }
    return bySection;
  }

  // ----- Analytics -----
  function ensureStats(section) {
    if (!stats[section]) stats[section] = { attempted: 0, correct: 0 };
  }

  function renderAnalytics() {
    const entries = Object.entries(stats).sort((a, b) =>
      a[0].localeCompare(b[0], "zh-HK")
    );

    const totalAttempted = entries.reduce((sum, [, v]) => sum + (v.attempted || 0), 0);
    const totalCorrect = entries.reduce((sum, [, v]) => sum + (v.correct || 0), 0);
    const overall = totalAttempted ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

    const lines = entries.map(([sec, v]) => {
      const attempted = v.attempted || 0;
      const correct = v.correct || 0;
      const p = attempted ? Math.round((correct / attempted) * 100) : 0;
      return `${sec}: ${correct}/${attempted} (${p}%)`;
    });

    analyticsEl.innerHTML = `
      <strong>學習統計</strong><br>
      整體：${totalCorrect}/${totalAttempted} (${overall}%)<br>
      錯題池：${wrongSet.size}<br>
      ${lines.join("<br>")}
    `;
  }

  // ----- Render -----
  function updateMeta() {
    const total = quiz.length;
    const currentNo = total ? Math.min(index + 1, total) : 0;
    const modeText = mode === "WRONG" ? "重做錯題" : "全部題目";
    metaEl.textContent = `篩選：${currentFilter}｜模式：${modeText}｜第 ${currentNo}/${total} 題｜分數：${score}`;
  }

  function renderQuestion() {
    feedbackEl.textContent = "";
    nextBtn.disabled = true;
    answered = false;

    if (index >= quiz.length) {
      questionTextEl.textContent = "完成！🎉";
      optionsEl.innerHTML = "";
      feedbackEl.textContent = `最終分數：${score} / ${quiz.length}`;
      nextBtn.disabled = true;
      retryWrongBtn.disabled = wrongSet.size === 0;
      updateMeta();
      renderAnalytics();
      saveState();
      return;
    }

    const current = quiz[index];
    questionTextEl.textContent = `【${current.section}】 ${current.q}`;
    optionsEl.innerHTML = "";

    current.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.textContent = `${String.fromCharCode(65 + i)}. ${opt.text}`;
      btn.addEventListener("click", () => handleAnswer(i));
      optionsEl.appendChild(btn);
    });

    retryWrongBtn.disabled = wrongSet.size === 0;
    updateMeta();
    renderAnalytics();
    saveState();
  }

  function handleAnswer(selectedIndex) {
    if (answered || index >= quiz.length) return;
    answered = true;

    const current = quiz[index];
    const buttons = optionsEl.querySelectorAll(".option");
    buttons.forEach(b => (b.disabled = true));

    ensureStats(current.section);
    stats[current.section].attempted += 1;

    const isCorrect = current.options[selectedIndex].correct === true;

    if (isCorrect) {
      buttons[selectedIndex].classList.add("correct");
      feedbackEl.textContent = "✅ 正確！";
      score += 1;
      stats[current.section].correct += 1;

      // in WRONG mode, answering correctly removes from wrong pool
      if (mode === "WRONG") wrongSet.delete(current.id);
    } else {
      buttons[selectedIndex].classList.add("wrong");
      const correctIndex = current.options.findIndex(o => o.correct);
      if (correctIndex >= 0) buttons[correctIndex].classList.add("correct");
      feedbackEl.textContent = "❌ 錯誤。";
      wrongSet.add(current.id);
    }

    nextBtn.disabled = false;
    retryWrongBtn.disabled = wrongSet.size === 0;
    updateMeta();
    renderAnalytics();
    saveState();
  }

  function startQuiz(newMode = "ALL") {
    mode = newMode;
    index = 0;
    score = 0;
    answered = false;
    feedbackEl.textContent = "";

    const filtered = getFilteredQuestions();

    if (!filtered.length) {
      quiz = [];
      questionTextEl.textContent =
        mode === "WRONG" ? "沒有錯題可重做。👏" : "此部分暫時沒有題目。";
      optionsEl.innerHTML = "";
      nextBtn.disabled = true;
      retryWrongBtn.disabled = wrongSet.size === 0;
      updateMeta();
      renderAnalytics();
      saveState();
      return;
    }

    quiz = shuffle(filtered).map(q => ({
      ...q,
      options: shuffle(q.options)
    }));

    renderQuestion();
  }

  // ----- Events -----
  nextBtn.addEventListener("click", () => {
    index += 1;
    renderQuestion();
  });

  restartBtn.addEventListener("click", () => {
    startQuiz("ALL");
  });

  retryWrongBtn.addEventListener("click", () => {
    if (wrongSet.size === 0) {
      feedbackEl.textContent = "目前沒有錯題可重做。";
      return;
    }
    startQuiz("WRONG");
  });

  sectionFilterEl.addEventListener("change", e => {
    currentFilter = e.target.value;
    startQuiz(mode); // keep current mode
  });

  // ----- Init -----
  async function init() {
    try {
      clearError();

      const { data, url } = await fetchFirstAvailableJson();
      questionBank = normalizeQuestions(data);

      if (!questionBank.length) {
        throw new Error("No valid questions found after normalization.");
      }

      buildSectionFilter();
      restartBtn.disabled = false;

      const restored = loadState();
      if (
        restored &&
        Array.isArray(quiz) &&
        quiz.length &&
        [...sectionFilterEl.options].some(o => o.value === currentFilter)
      ) {
        sectionFilterEl.value = currentFilter;
        renderQuestion();
      } else {
        currentFilter = "ALL";
        sectionFilterEl.value = "ALL";
        mode = "ALL";
        startQuiz("ALL");
      }

      console.log(`Loaded from: ${url}. Questions: ${questionBank.length}`);
    } catch (err) {
      metaEl.textContent = "Could not load questions.";
      questionTextEl.textContent = "";
      optionsEl.innerHTML = "";
      nextBtn.disabled = true;
      restartBtn.disabled = true;
      retryWrongBtn.disabled = true;

      showError(
        `Failed to load questions.<br>
         Error: ${err.message}<br><br>
         請確認 data/questions.fixed.json 或 data/questions.json 存在，並使用 local server。`
      );
      console.error(err);
    }
  }

  init();
})();

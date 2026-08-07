let questionBank = [];
let quiz = [];
let index = 0;
let score = 0;
let answered = false;
let currentFilter = "ALL";

const metaEl = document.getElementById("meta");
const questionTextEl = document.getElementById("questionText");
const optionsEl = document.getElementById("options");
const feedbackEl = document.getElementById("feedback");
const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");
const errorBox = document.getElementById("errorBox");
const sectionFilterEl = document.getElementById("sectionFilter");

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function showError(message) {
  errorBox.innerHTML = `<div class="error">${message}</div>`;
}
function clearError() {
  errorBox.innerHTML = "";
}

async function loadQuestions() {
  try {
    const res = await fetch("./data/questions.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    questionBank = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(questionBank) || questionBank.length === 0) {
      throw new Error("No questions found in questions.json");
    }

    // 基本驗證
    for (const q of questionBank) {
      if (!q.q || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error("Invalid question format in questions.json");
      }
      const correctCount = q.options.filter(o => o.correct === true).length;
      if (correctCount !== 1) {
        throw new Error(`Question "${q.q}" must have exactly ONE correct option.`);
      }
    }

    restartBtn.disabled = false;
    startQuiz();
  } catch (err) {
    metaEl.textContent = "Could not load questions.";
    showError(
      `Failed to load <code>data/questions.json</code>.<br>
       Error: ${err.message}<br><br>
       請用 local server 開啟（不要直接雙擊 html）。`
    );
    console.error(err);
  }
}

function getFilteredQuestions() {
  if (currentFilter === "ALL") return questionBank;
  return questionBank.filter(q => (q.section || "").startsWith(currentFilter));
}

function startQuiz() {
  clearError();
  const filtered = getFilteredQuestions();

  if (filtered.length === 0) {
    quiz = [];
    index = 0;
    score = 0;
    questionTextEl.textContent = "此部分暫時沒有題目。";
    optionsEl.innerHTML = "";
    metaEl.textContent = `篩選：${currentFilter} | 0 題`;
    nextBtn.disabled = true;
    return;
  }

  // 深拷貝 + shuffle
  quiz = filtered.map(q => ({
    section: q.section || "",
    q: q.q,
    options: q.options.map(o => ({ ...o }))
  }));

  shuffle(quiz);
  quiz.forEach(q => shuffle(q.options));

  index = 0;
  score = 0;
  answered = false;
  renderQuestion();
}

function renderQuestion() {
  feedbackEl.textContent = "";
  nextBtn.disabled = true;
  answered = false;

  if (index >= quiz.length) {
    questionTextEl.textContent = "Quiz complete 🎉";
    optionsEl.innerHTML = "";
    metaEl.textContent = `篩選：${currentFilter} | Final Score: ${score} / ${quiz.length}`;
    return;
  }

  const current = quiz[index];
  metaEl.textContent = `篩選：${currentFilter} | 第 ${index + 1} / ${quiz.length} 題 | Score: ${score}`;
  questionTextEl.textContent = `${current.section ? "【" + current.section + "】" : ""} ${current.q}`;
  optionsEl.innerHTML = "";

  current.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.textContent = `${String.fromCharCode(65 + i)}. ${opt.text}`;
    btn.addEventListener("click", () => handleAnswer(i));
    optionsEl.appendChild(btn);
  });
}

function handleAnswer(selectedIndex) {
  if (answered) return;
  answered = true;

  const current = quiz[index];
  const buttons = optionsEl.querySelectorAll(".option");
  buttons.forEach(b => (b.disabled = true));

  if (current.options[selectedIndex].correct) {
    buttons[selectedIndex].classList.add("correct");
    feedbackEl.textContent = "✅ Correct!";
    score++;
  } else {
    buttons[selectedIndex].classList.add("wrong");
    const correctIndex = current.options.findIndex(o => o.correct);
    if (correctIndex >= 0) buttons[correctIndex].classList.add("correct");
    feedbackEl.textContent = "❌ Wrong!";
  }

  metaEl.textContent = `篩選：${currentFilter} | 第 ${index + 1} / ${quiz.length} 題 | Score: ${score}`;
  nextBtn.disabled = false;
}

nextBtn.addEventListener("click", () => {
  index++;
  renderQuestion();
});

restartBtn.addEventListener("click", startQuiz);

sectionFilterEl.addEventListener("change", (e) => {
  currentFilter = e.target.value;
  startQuiz();
});

loadQuestions();

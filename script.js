(function() {
  "use strict";
  lucide.createIcons();

  // ---------- CONFIGURATION ----------
  const BASE_URL = 'https://tutoriumfree.onrender.com'; // Public API

  // ---------- VISIT TRACKING ----------
  (async function trackVisit() {
    try {
      fetch(BASE_URL + '/visit', { method: 'POST' }).catch(() => {});

      const res = await fetch(BASE_URL + '/visit-count');
      if (!res.ok) throw new Error('stats fetch failed');
      const data = await res.json();

      const el = document.getElementById('visit-count-display');
      if (el) el.textContent = data.count ?? '—';
    } catch (e) {
      const el = document.getElementById('visit-count-display');
      if (el) el.textContent = '—';
    }
  })();
  // Extract URL parameters (kept for reference but not used for auto-selection)
  const urlParams = new URLSearchParams(window.location.search);
  const paramClassId = urlParams.get('classId');
  const paramSubjectId = urlParams.get('subjectId');
  const paramChapterId = urlParams.get('chapterId');

  // State (initialized to null - no pre-selection)
  let currentClassId = null;
  let currentSubjectId = null;
  let currentChapterId = null;
  let chaptersList = [];
  let activePlayerInstance = null; // reference to SimpleYouTubePlayer instance
  let classesData = []; // store fetched classes with subjects

  // ---------- PRACTICE STATE ----------
  let practiceMode = false; // true = showing questions, false = showing posts
  let practiceCursor = null;
  let practiceHasMore = true;
  let practiceLoading = false;
  let practiceQuestionCount = 0; // running total for global question numbering

  // DOM elements
  const dropdownContainer = document.getElementById('dropdown-container');
  const selectedValueSpan = document.getElementById('selected-value');
  const dropdownItemsContainer = document.getElementById('dropdown-items-container');
  const postsGrid = document.getElementById('posts-grid');
  const courseWrapper = document.getElementById('courseSelectWrapper');
  const subjectWrapper = document.getElementById('subjectSelectWrapper');

  // ---------- DISABLE UNWANTED INTERACTIONS ----------
  document.addEventListener('dblclick', e => e.preventDefault());
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- UTILS ----------
  function formatDate(createdAt) {
    if (!createdAt) return 'Unknown date';
    try {
      let date;
      if (typeof createdAt === 'object' && createdAt._seconds) {
        date = new Date(createdAt._seconds * 1000);
      } else if (typeof createdAt === 'string') {
        date = new Date(createdAt);
      } else if (typeof createdAt === 'number') {
        date = new Date(createdAt * 1000);
      } else {
        return 'Invalid date';
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Date error';
    }
  }

  function extractYouTubeID(url) {
    if (!url) return null;
    const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/, /youtube\.com\/shorts\/([^&\n?#]+)/];
    for (let pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return null;
  }

  function getThumbnailUrl(videoUrl, providedThumbnail) {
    if (providedThumbnail && providedThumbnail.trim() !== '') return providedThumbnail;
    const videoId = extractYouTubeID(videoUrl);
    return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : 'https://images.unsplash.com/photo-1581091226033-d5c48150dbaa?q=80&w=1200&auto=format&fit=crop';
  }

  // ---------- CUSTOM DROPDOWN HELPERS (for course/subject) ----------
  function closeAllCustomDropdowns() {
    document.querySelectorAll('.custom-select-dropdown').forEach(dd => dd.classList.remove('show'));
    document.querySelectorAll('.custom-select-trigger').forEach(tr => tr.classList.remove('open'));
  }

  function buildCustomSelect(options, placeholder, selectedValue, onSelect) {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    const triggerSpan = document.createElement('span');
    const selectedOption = options.find(opt => opt.value === selectedValue);
    triggerSpan.textContent = selectedOption ? selectedOption.label : placeholder;
    trigger.appendChild(triggerSpan);
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';

    if (!options.length) {
      const noOpt = document.createElement('div');
      noOpt.className = 'custom-select-option disabled';
      noOpt.textContent = 'No options available';
      noOpt.style.cursor = 'default';
      noOpt.style.opacity = '0.6';
      dropdown.appendChild(noOpt);
    } else {
      options.forEach(opt => {
        const optDiv = document.createElement('div');
        optDiv.className = 'custom-select-option';
        if (selectedValue === opt.value) optDiv.classList.add('selected');
        optDiv.textContent = opt.label;
        optDiv.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerSpan.textContent = opt.label;
          dropdown.classList.remove('show');
          trigger.classList.remove('open');
          onSelect(opt.value, opt.label);
          // Update selected class
          dropdown.querySelectorAll('.custom-select-option').forEach(el => el.classList.remove('selected'));
          optDiv.classList.add('selected');
        });
        dropdown.appendChild(optDiv);
      });
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllCustomDropdowns();
      dropdownContainer.classList.remove('dropdown-open');
      dropdown.classList.add('show');
      trigger.classList.add('open');
      dropdown.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(dropdown);
    return wrapper;
  }

  // Close custom dropdowns on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-select-wrapper')) {
      closeAllCustomDropdowns();
    }
  });

  // ---------- DROPDOWN LOGIC (existing chapter) ----------
  window.toggleDropdown = function() {
    dropdownContainer.classList.toggle('dropdown-open');
    if (dropdownContainer.classList.contains('dropdown-open')) {
      const list = dropdownContainer.querySelector('.dropdown-content');
      (list || dropdownContainer).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  window.selectItem = function(chapterId, chapterName) {
    selectedValueSpan.innerText = chapterName;
    currentChapterId = chapterId === 'all' ? null : chapterId;
    dropdownContainer.classList.remove('dropdown-open');
    updateFeedSectionHeader();
    if (currentChapterId) {
      showLecturesView();
    } else {
      practiceMode = false;
      document.getElementById('practice-section').classList.remove('visible');
      postsGrid.style.display = '';
      loadPostsForCurrentChapter();
    }
  };

  // Close chapter dropdown on outside click (separate from custom dropdowns)
  window.onclick = function(event) {
    if (!event.target.closest('#dropdown-container')) {
      dropdownContainer.classList.remove('dropdown-open');
    }
  };

  // Populate/Repopulate chapter dropdown
  function repopulateChapterDropdown(chapters) {
    chaptersList = chapters || [];
    dropdownItemsContainer.innerHTML = '';

    // "Default Feed" option (renamed from "All Chapters")
    const allBtn = document.createElement('button');
    allBtn.className = 'dropdown-item px-5 py-3.5 text-left text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors';
    allBtn.textContent = 'Default Feed';
    allBtn.onclick = () => selectItem('all', 'Default Feed');
    dropdownItemsContainer.appendChild(allBtn);

    // API chapters
    chaptersList.forEach(ch => {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item px-5 py-3.5 text-left text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors';
      btn.textContent = ch.chapterName;
      btn.onclick = () => selectItem(ch.chapterId, ch.chapterName);
      dropdownItemsContainer.appendChild(btn);
    });

    // Reset selected display to placeholder
    selectedValueSpan.innerText = '--- Select Chapter ---';
    currentChapterId = null;
  }

  // Initial populate with possible URL param (kept for compatibility but not used for auto-selection)
  function populateDropdown(chapters) {
    chaptersList = chapters || [];
    dropdownItemsContainer.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'dropdown-item px-5 py-3.5 text-left text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors';
    allBtn.textContent = 'Default Feed';
    allBtn.onclick = () => selectItem('all', 'Default Feed');
    dropdownItemsContainer.appendChild(allBtn);

    chaptersList.forEach(ch => {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item px-5 py-3.5 text-left text-sm font-semibold text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors';
      btn.textContent = ch.chapterName;
      btn.onclick = () => selectItem(ch.chapterId, ch.chapterName);
      dropdownItemsContainer.appendChild(btn);
    });

    // Placeholder (no auto-selection)
    selectedValueSpan.innerText = '--- Select Chapter ---';
    currentChapterId = null;
  }

  // ---------- API CALLS ----------
  async function fetchClasses() {
    try {
      const res = await fetch(`${BASE_URL}/classes`);
      if (!res.ok) throw new Error(`Classes API error: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to fetch classes:', err);
      return [];
    }
  }

  async function fetchChapters() {
    try {
      const res = await fetch(`${BASE_URL}/chapters?classId=${currentClassId}&subjectId=${currentSubjectId}`);
      if (!res.ok) throw new Error(`Chapters API error: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to fetch chapters:', err);
      return [];
    }
  }

  async function fetchRecentPosts() {
    try {
      // CHANGE 1: removed classId parameter
      const res = await fetch(`${BASE_URL}/posts/recent`);
      if (!res.ok) throw new Error(`Recent posts error: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to fetch recent posts:', err);
      throw err;
    }
  }

  async function fetchPostsByChapter(chapterId) {
    try {
      const res = await fetch(`${BASE_URL}/posts?classId=${currentClassId}&subjectId=${currentSubjectId}&chapterId=${chapterId}`);
      if (!res.ok) throw new Error(`Posts by chapter error: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Failed to fetch chapter posts:', err);
      throw err;
    }
  }

  // ---------- PRACTICE: API ----------
  async function fetchQuestionsPage(reset = false) {
    if (!practiceHasMore || practiceLoading) return;
    if (!currentClassId || !currentSubjectId || !currentChapterId) {
      document.getElementById('practice-error').style.display = 'block';
      document.getElementById('practice-error').textContent = '⚠️ Please select a Class, Subject, and Chapter first.';
      return;
    }
    practiceLoading = true;
    const loaderEl = document.getElementById('practice-loader');
    if (!reset) loaderEl.style.display = 'block';

    try {
      const params = new URLSearchParams({
        classId: currentClassId,
        subjectId: currentSubjectId,
        chapterId: currentChapterId
      });
      if (practiceCursor !== null) params.append('after', practiceCursor.toString());

      const res = await fetch(`${BASE_URL}/questions?${params.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      const questions = data.questions || [];
      const container = document.getElementById('questions-container');

      if (reset) {
        container.innerHTML = '';
        practiceQuestionCount = 0;
        if (questions.length === 0) {
          document.getElementById('practice-empty').style.display = 'block';
          practiceHasMore = false;
        }
      }

      if (questions.length > 0) {
        document.getElementById('practice-empty').style.display = 'none';
        appendQuestions(questions);
      }

      practiceCursor = (data.nextCursor !== null && data.nextCursor !== undefined) ?
        (typeof data.nextCursor === 'number' ? data.nextCursor : parseInt(data.nextCursor, 10)) :
        null;
      practiceHasMore = data.hasMore === true;
    } catch (err) {
      console.error('Failed to fetch questions:', err);
      if (reset) {
        document.getElementById('practice-error').style.display = 'block';
      }
    } finally {
      practiceLoading = false;
      document.getElementById('practice-loader').style.display = 'none';
    }
  }

  // ---------- PRACTICE: RENDER ----------
  function replaceNewlinesWithBr(text) {
    if (!text) return text;
    return text.replace(/\r?\n/g, '<br>');
  }

  function renderMathInElementWithDelay(element) {
    if (!element) return;
    const tryRender = () => {
      if (typeof renderMathInElement === 'function') {
        try {
          renderMathInElement(element, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false,
            errorColor: '#cc0000'
          });
        } catch (e) { console.warn('KaTeX error:', e); }
      } else {
        setTimeout(tryRender, 150);
      }
    };
    tryRender();
  }

  function getYouTubeEmbedUrl(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?#]+)/,
      /youtube\.com\/embed\/([^?]+)/
    ];
    for (let pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return `https://www.youtube.com/embed/${match[1]}`;
    }
    return null;
  }

  function createVideoElement(url) {
    if (!url) return null;
    const container = document.createElement('div');
    container.className = 'video-container';
    const youtubeEmbed = getYouTubeEmbedUrl(url);
    if (youtubeEmbed) {
      const iframe = document.createElement('iframe');
      iframe.src = youtubeEmbed;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.frameBorder = '0';
      iframe.style.width = '100%';
      iframe.style.aspectRatio = '16/9';
      container.appendChild(iframe);
    } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.style.width = '100%';
      const source = document.createElement('source');
      source.src = url;
      source.type = 'video/mp4';
      video.appendChild(source);
      container.appendChild(video);
    }
    return container;
  }

  function createQuestionElement(q, globalIndex) {
    const formattedQuestionText = replaceNewlinesWithBr(q.questionText);
    const formattedOptions = q.questionOptions ? q.questionOptions.map(opt => replaceNewlinesWithBr(opt)) : [];
    const formattedSolutionText = q.solutionText ? replaceNewlinesWithBr(q.solutionText).replace(/\*\*(.+?)\*\*/g, '<strong><u>$1</u></strong>') : null;
    const isSubjective = (q.questionType === 'Subjective');

    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    if (isSubjective) questionDiv.classList.add('subjective');

    const qTag = document.createElement('div');
    qTag.className = 'q-tag';
    qTag.textContent = `Question ${globalIndex} ${isSubjective ? '(Subjective)' : '(Objective)'}`;

    const qText = document.createElement('div');
    qText.className = 'question-text';
    qText.innerHTML = formattedQuestionText;

    questionDiv.appendChild(qTag);
    questionDiv.appendChild(qText);

    // Question image
    if (q.questionImageUrl) {
      const img = document.createElement('img');
      img.src = q.questionImageUrl;
      img.alt = 'Question illustration';
      img.style.maxWidth = '100%';
      img.style.marginBottom = '12px';
      img.style.borderRadius = '4px';
      questionDiv.appendChild(img);
    }

    let optionsDiv = null,
      optionContainers = [],
      submitBtn = null,
      correctAnswerBox = null;

    // Objective: options + submit
    if (!isSubjective) {
      optionsDiv = document.createElement('div');
      optionsDiv.className = 'options-list';
      formattedOptions.forEach((opt, optIdx) => {
        const label = document.createElement('label');
        label.className = 'option-container';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `pq_${globalIndex}`;
        radio.value = optIdx;
        const span = document.createElement('span');
        span.innerHTML = opt;
        label.appendChild(radio);
        label.appendChild(span);
        optionsDiv.appendChild(label);
        optionContainers.push(label);
      });
      questionDiv.appendChild(optionsDiv);
    }

    // Action buttons
    const actionRow = document.createElement('div');
    actionRow.className = 'action-buttons';


    const videoSolutionBtn = document.createElement('button');
    videoSolutionBtn.textContent = 'Video Solution';
    videoSolutionBtn.className = 'action-btn video-solution-btn';

    if (!isSubjective) {
      submitBtn = document.createElement('button');
      submitBtn.textContent = 'Submit';
      submitBtn.className = 'action-btn submit-btn';
      actionRow.appendChild(submitBtn);
    }

    actionRow.appendChild(videoSolutionBtn);

    const textSolutionBtn = document.createElement('button');
    textSolutionBtn.innerHTML =
      `<svg style="width:22px;height:22px;color:white;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.2));" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L14.8 9.2L22 12L14.8 14.8L12 22L9.2 14.8L2 12L9.2 9.2L12 2Z"/></svg>`;
    textSolutionBtn.className = 'btn-gold-text-solution';
    textSolutionBtn.title = 'Text Solution';
    actionRow.appendChild(textSolutionBtn);
    questionDiv.appendChild(actionRow);

    // Correct answer box (objective only)
    if (!isSubjective) {
      correctAnswerBox = document.createElement('div');
      correctAnswerBox.className = 'correct-answer-box';
      const correctLabel = document.createElement('span');
      correctLabel.className = 'correct-answer-label';
      correctLabel.textContent = 'Correct Answer:';
      const correctAnswerSpan = document.createElement('span');
      correctAnswerSpan.innerHTML = formattedOptions[q.correctIndex] || 'N/A';
      correctAnswerBox.appendChild(correctLabel);
      correctAnswerBox.appendChild(correctAnswerSpan);
      questionDiv.appendChild(correctAnswerBox);
    }

    // Text solution container
    const textSolutionContainer = document.createElement('div');
    textSolutionContainer.className = 'solution-container';
    if (formattedSolutionText) {
      const textBox = document.createElement('div');
      textBox.className = 'solution-box';
      const solutionPara = document.createElement('p');
      solutionPara.innerHTML = formattedSolutionText;
      textBox.appendChild(solutionPara);
      if (q.solutionImageUrl) {
        const img = document.createElement('img');
        img.src = q.solutionImageUrl;
        img.alt = 'Solution illustration';
        img.style.maxWidth = '100%';
        img.style.marginTop = '10px';
        img.style.borderRadius = '4px';
        textBox.appendChild(img);
      }
      textSolutionContainer.appendChild(textBox);
      const aiNotice = document.createElement('div');
      aiNotice.className = 'p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg shadow-sm mt-3';
      aiNotice.innerHTML =
        '<p class="text-sm leading-relaxed text-red-900 font-medium"><span class="font-bold uppercase tracking-wide mr-1">Notice:</span>This solution is AI-generated. It may contain errors—verify before relying on it.</p>';
      textSolutionContainer.appendChild(aiNotice);
    }
    questionDiv.appendChild(textSolutionContainer);

    // Video solution container
    const videoSolutionContainer = document.createElement('div');
    videoSolutionContainer.className = 'solution-container';
    if (q.solutionVideoUrl) {
      const videoElem = createVideoElement(q.solutionVideoUrl);
      if (videoElem) videoSolutionContainer.appendChild(videoElem);
    }
    questionDiv.appendChild(videoSolutionContainer);

    // Submit logic (objective)
    if (!isSubjective) {
      let submitted = false;

      videoSolutionBtn.disabled = true;
      textSolutionBtn.disabled = true;
      submitBtn.onclick = () => {
        if (submitted) return;
        const selectedRadio = document.querySelector(`input[name="pq_${globalIndex}"]:checked`);
        if (!selectedRadio) { alert('Please select an answer'); return; }
        const selectedIndex = parseInt(selectedRadio.value);
        const isCorrect = (selectedIndex === q.correctIndex);
        optionContainers.forEach((container, i) => {
          if (i === q.correctIndex) {
            container.classList.add('correct-bg');
          } else if (i === selectedIndex) {
            container.classList.add('wrong-bg');
          }
        });
        if (correctAnswerBox) correctAnswerBox.classList.add('visible');

        if (q.solutionVideoUrl) videoSolutionBtn.disabled = false;
        if (q.solutionText) textSolutionBtn.disabled = false;
        submitted = true;
        submitBtn.disabled = true;
      };
    } else {

      videoSolutionBtn.disabled = false;
      if (q.solutionText) textSolutionBtn.disabled = false;
    }

    // Solution toggle logic

    videoSolutionBtn.onclick = () => {
      const wasVisible = videoSolutionContainer.classList.contains('visible');
      videoSolutionContainer.classList.toggle('visible', !wasVisible);
      if (!wasVisible) textSolutionContainer.classList.remove('visible');
    };

    textSolutionBtn.onclick = () => {
      const wasVisible = textSolutionContainer.classList.contains('visible');
      textSolutionContainer.classList.toggle('visible', !wasVisible);
      if (!wasVisible) videoSolutionContainer.classList.remove('visible');
    };

    renderMathInElementWithDelay(questionDiv);
    return questionDiv;
  }

  function appendQuestions(questions) {
    const container = document.getElementById('questions-container');
    const fragment = document.createDocumentFragment();
    questions.forEach(q => {
      practiceQuestionCount++;
      fragment.appendChild(createQuestionElement(q, practiceQuestionCount));
    });
    container.appendChild(fragment);
  }

  function showNudgeToast(message) {
    let toast = document.getElementById('nudge-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'nudge-toast';
      toast.className = 'nudge-toast';
      toast.innerHTML = '<i class="fas fa-triangle-exclamation"></i><span></span>';
      document.body.appendChild(toast);
    }
    toast.querySelector('span').textContent = message;
    toast.classList.remove('show');
    void toast.offsetWidth; // restart the shake animation on repeat clicks
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  // ---------- PRACTICE: VIEW TOGGLE ----------
  function showPracticeView() {
    if (!currentClassId || !currentSubjectId || !currentChapterId) {
      showNudgeToast('Pick a class, subject, and chapter first');
      return;
    }
    practiceMode = true;

    // Hide posts, show practice
    postsGrid.style.display = 'none';
    document.getElementById('feed-section-header').classList.add('visible');
    document.getElementById('practice-section').classList.add('visible');
    document.getElementById('practice-error').style.display = 'none';
    document.getElementById('practice-empty').style.display = 'none';

    // Reset and fetch
    practiceCursor = null;
    practiceHasMore = true;
    practiceLoading = false;
    practiceQuestionCount = 0;
    document.getElementById('questions-container').innerHTML =
      `<div class="loader-grid col-span-full"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div></div>`;

    fetchQuestionsPage(true);
  }

  function showLecturesView() {
    practiceMode = false;

    // Hide practice, show posts
    document.getElementById('practice-section').classList.remove('visible');
    postsGrid.style.display = '';
    updateFeedSectionHeader();
    loadPostsForCurrentChapter();
  }

  window.copyChapterLink = function() {
    if (!currentClassId || !currentSubjectId || !currentChapterId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('classId', currentClassId);
    url.searchParams.set('subjectId', currentSubjectId);
    url.searchParams.set('chapterId', currentChapterId);
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = document.getElementById('copy-link-btn');
      const icon = btn.querySelector('i');
      icon.className = 'fas fa-check text-sm';
      setTimeout(() => { icon.className = 'fas fa-link text-sm'; }, 1500);
      let toast = document.getElementById('copy-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'copy-toast';
        toast.style.cssText =
          'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:white;padding:10px 24px;border-radius:9999px;font-size:0.85rem;font-weight:600;font-family:Montserrat,sans-serif;z-index:99999;opacity:0;transition:opacity 0.3s ease;pointer-events:none;white-space:nowrap;';
        document.body.appendChild(toast);
      }
      toast.textContent = '🔗 Link Copied!';
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }).catch(() => {
      alert('Could not copy. Please copy the URL manually.');
    });
  };

  // ---------- PRACTICE: INFINITE SCROLL ---------
  function checkInfiniteScroll(scrollTop, viewHeight, totalHeight) {
    if (!practiceMode) return;
    if (scrollTop + viewHeight >= totalHeight - 300) {
      fetchQuestionsPage(false);
    }
  }

  window.addEventListener('scroll', () => {
    checkInfiniteScroll(
      window.pageYOffset || document.documentElement.scrollTop,
      window.innerHeight,
      document.documentElement.scrollHeight
    );
  });

  document.querySelector('.main-content').addEventListener('scroll', function() {
    checkInfiniteScroll(this.scrollTop, this.clientHeight, this.scrollHeight);
  });

  async function loadPostsForCurrentChapter() {
    postsGrid.innerHTML =
      `<div class="loader-grid col-span-full"><div class="loader-dot"></div><div class="loader-dot"></div><div class="loader-dot"></div></div>`;

    try {
      let posts;
      if (currentChapterId) {
        posts = await fetchPostsByChapter(currentChapterId);
      } else {
        posts = await fetchRecentPosts();
      }
      renderPosts(posts);
    } catch (error) {
      postsGrid.innerHTML = `<div class="error-message col-span-full">⚠️ Failed to load lessons. Please try again.</div>`;
    }
  }

  // ---------- COURSE/SUBJECT UI BUILDERS ----------
  function renderCourseSelect(preSelectId = null) {
    const options = classesData.map(c => ({ value: c.classId, label: c.className }));
    // CHANGE 3: no pre-selection, placeholder changed
    const selectEl = buildCustomSelect(options, '--- Select Course ---', preSelectId, (classId) => {
      currentClassId = classId;
      // Find selected class and repopulate subjects without auto-selection
      const selectedClass = classesData.find(c => c.classId === classId);
      renderSubjectSelect(selectedClass ? selectedClass.subjects : []);
      // Reset chapter dropdown to empty/placeholder, do NOT auto-select subject
      currentSubjectId = null;
      repopulateChapterDropdown([]);
      // Do NOT call resetAndReloadAfterSubjectChange here; wait for subject selection
    });
    courseWrapper.innerHTML = '';
    courseWrapper.appendChild(selectEl);
  }

  function renderSubjectSelect(subjects, preSelectId = null) {
    const options = subjects.map(s => ({ value: s.subjectId, label: s.subjectName }));
    // CHANGE 3: no pre-selection, placeholder changed
    const selectEl = buildCustomSelect(options, '--- Select Subject ---', preSelectId, (subjectId) => {
      currentSubjectId = subjectId;
      // Only now reload chapters and posts
      resetAndReloadAfterSubjectChange();
    });
    subjectWrapper.innerHTML = '';
    subjectWrapper.appendChild(selectEl);
  }

  async function resetAndReloadAfterSubjectChange() {
    currentChapterId = null;
    selectedValueSpan.innerText = '--- Select Chapter ---';
    updateFeedSectionHeader();
    const chapters = await fetchChapters();
    repopulateChapterDropdown(chapters);
    await loadPostsForCurrentChapter();
  }

  function updateFeedSectionHeader() {
    const header = document.getElementById('feed-section-header');
    const chapterDiv = document.getElementById('feed-header-chapter');
    const recentDiv = document.getElementById('feed-header-recent');
    const chapterText = document.getElementById('feed-chapter-text');
    const metaText = document.getElementById('feed-meta-text');

    const allSelected = currentClassId && currentSubjectId && currentChapterId;

    if (allSelected) {
      // Find class name and subject name from classesData
      const selectedClass = classesData.find(c => c.classId === currentClassId);
      const className = selectedClass ? selectedClass.className : '';
      const selectedSubject = selectedClass ?
        (selectedClass.subjects || []).find(s => s.subjectId === currentSubjectId) :
        null;
      const subjectName = selectedSubject ? selectedSubject.subjectName : '';

      chapterText.textContent = selectedValueSpan.innerText;
      metaText.textContent = className + (subjectName ? '—' + subjectName : '');

      chapterDiv.style.display = 'block';
      recentDiv.style.display = 'none';
      header.classList.add('visible');
    } else if (!currentClassId && !currentSubjectId && !currentChapterId) {
      // Nothing selected — show "Latest Updates"
      chapterDiv.style.display = 'none';
      recentDiv.style.display = 'block';
      header.classList.add('visible');
    } else {
      // Partial selection — hide header
      header.classList.remove('visible');
    }

    const copyBtn = document.getElementById('copy-link-btn');
    if (copyBtn) copyBtn.style.display = allSelected ? 'flex' : 'none';
  }

  // ---------- IN-CARD PLAYER (with double-tap modifications) ----------
  class SimpleYouTubePlayer {
    constructor(containerElement, videoId) {
      this.container = containerElement;
      this.videoId = videoId;
      this.player = null;
      this.updateInterval = null;
      this.currentPlaybackRate = 1;
      this.playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      this.uniqueId = 'player-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      this.doubleTapTimer = null;
      this.lastTapTime = 0;
      this.init();
    }

    init() {
      this.container.innerHTML = `
                        <div class="video-player-container" id="${this.uniqueId}">
                            <div class="double-tap-indicator double-tap-left"><div class="double-tap-text">-10s</div></div>
                            <div class="double-tap-indicator double-tap-right"><div class="double-tap-text">+20s</div></div>
                            <div class="youtube-iframe-wrapper"></div>
                            <div class="video-overlay">
                                <div class="modern-control-bar">
                                    <div class="top-progress-container">
                                        <div class="progress-track"></div>
                                        <div class="progress-thumb"></div>
                                    </div>
                                    <div class="controls-row">
                                        <div class="left-controls">
                                            <button class="control-btn play-pause-btn">
                                                <svg class="play-icon" width="24" height="24" fill="currentColor" viewBox="0 0 512 512"><path d="M464 256A208 208 0 1 0 48 256a208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM188.3 147.1c7.6-4.2 16.8-4.1 24.3 .5l144 88c7.1 4.4 11.5 12.1 11.5 20.5s-4.4 16.1-11.5 20.5l-144 88c-7.4 4.5-16.7 4.7-24.3 .5s-12.3-12.2-12.3-20.9V168c0-8.7 4.7-16.7 12.3-20.9z"/></svg>
                                                <svg class="pause-icon" style="display:none;" width="24" height="24" fill="currentColor" viewBox="0 0 512 512"><path d="M464 256A208 208 0 1 0 48 256a208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm224-72V328c0 13.3-10.7 24-24 24s-24-10.7-24-24V184c0-13.3 10.7-24 24-24s24 10.7 24 24zm112 0V328c0 13.3-10.7 24-24 24s-24-10.7-24-24V184c0-13.3 10.7-24 24-24s24 10.7 24 24z"/></svg>
                                            </button>
                                        </div>
                                        <div class="center-controls"><span class="time-display">0:00 / 0:00</span></div>
                                        <div class="right-controls">
                                            <button class="control-btn speed-btn">1x</button>
                                            <button class="control-btn volume-btn"><i class="fas fa-volume-up"></i></button>
                                            <button class="control-btn fullscreen-btn"><i class="fas fa-expand"></i></button>
                                        </div>
                                    </div>
                                </div>
                                <div class="video-loading" style="display:none;"><div class="video-loading-spinner"></div><span>Loading video...</span></div>
                            </div>
                        </div>
                    `;

      const iframe = document.createElement('iframe');
      iframe.id = `yt-${this.uniqueId}`;
      iframe.width = '100%';
      iframe.height = '100%';
      iframe.src =
        `https://www.youtube.com/embed/${this.videoId}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&controls=0&disablekb=1&modestbranding=1&fs=0&rel=0&iv_load_policy=3&playsinline=1&autoplay=0`;
      iframe.frameBorder = '0';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.style.pointerEvents = 'none';

      const wrapper = this.container.querySelector('.youtube-iframe-wrapper');
      if (wrapper) wrapper.appendChild(iframe);

      this.loadYouTubeAPI().then(() => this.initializePlayer()).catch(err => {
        console.error('YouTube API load error:', err);
      });
    }

    loadYouTubeAPI() {
      return new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) return resolve();
        if (window.youtubeAPILoading) {
          const check = setInterval(() => {
            if (window.YT && window.YT.Player) { clearInterval(check);
              resolve(); }
          }, 100);
          setTimeout(() => { clearInterval(check); if (!window.YT) reject('Timeout'); }, 15000);
          return;
        }
        window.youtubeAPILoading = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.onerror = () => { window.youtubeAPILoading = false;
          reject('Script load failed'); };
        document.head.appendChild(tag);
        window.onYouTubeIframeAPIReady = () => {
          window.youtubeAPILoading = false;
          resolve();
        };
      });
    }

    initializePlayer() {
      const iframe = this.container.querySelector(`#yt-${this.uniqueId}`);
      if (!iframe) return;

      try {
        this.player = new YT.Player(iframe.id, {
          events: {
            onReady: (e) => this.onPlayerReady(e),
            onStateChange: (e) => this.onStateChange(e),
            onError: (e) => console.error('YT error:', e.data),
            onPlaybackRateChange: (e) => {
              this.currentPlaybackRate = e.data;
              const btn = this.container.querySelector('.speed-btn');
              if (btn) btn.textContent = `${this.currentPlaybackRate}x`;
            }
          },
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin
          }
        });
        this.setupControls();
      } catch (err) {
        console.error('Player init error:', err);
        setTimeout(() => this.initializePlayer(), 1000);
      }
    }

    onPlayerReady(event) {
      event.target.setVolume(100);
      event.target.setPlaybackRate(this.currentPlaybackRate);
      event.target.playVideo();
      this.startUpdateInterval();
    }

    onStateChange(event) {
      const playIcon = this.container.querySelector('.play-icon');
      const pauseIcon = this.container.querySelector('.pause-icon');
      if (event.data === YT.PlayerState.PLAYING) {
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
        this.hideControlsAfterDelay();
      } else {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
      }
    }

    setupControls() {
      const c = this.container;
      const playBtn = c.querySelector('.play-pause-btn');
      if (playBtn) playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.player) return;
        this.player.getPlayerState() === YT.PlayerState.PLAYING ?
          this.player.pauseVideo() :
          this.player.playVideo();
      });

      const progressBar = c.querySelector('.top-progress-container');
      if (progressBar) {
        const seek = (clientX) => {
          if (!this.player) return;
          const rect = progressBar.getBoundingClientRect();
          const pct = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
          this.player.seekTo(pct * this.player.getDuration(), true);
        };
        progressBar.addEventListener('click', (e) => { e.stopPropagation();
          seek(e.clientX); });
        progressBar.addEventListener('touchstart', (e) => { e.stopPropagation();
          seek(e.touches[0].clientX); }, { passive: true });
        progressBar.addEventListener('touchmove', (e) => { e.stopPropagation();
          seek(e.touches[0].clientX); }, { passive: true });
      }

      const volBtn = c.querySelector('.volume-btn');
      if (volBtn) volBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.player) return;
        const muted = this.player.getVolume() === 0;
        this.player.setVolume(muted ? 100 : 0);
        volBtn.innerHTML = muted ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
      });

      const speedBtn = c.querySelector('.speed-btn');
      if (speedBtn) speedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.player) return;
        const idx = this.playbackRates.indexOf(this.currentPlaybackRate);
        this.currentPlaybackRate = this.playbackRates[(idx + 1) % this.playbackRates.length];
        this.player.setPlaybackRate(this.currentPlaybackRate);
        speedBtn.textContent = `${this.currentPlaybackRate}x`;
      });

      const fsBtn = c.querySelector('.fullscreen-btn');
      if (fsBtn) fsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = c.querySelector('.video-player-container');
        if (!document.fullscreenElement) {
          (target.requestFullscreen || target.webkitRequestFullscreen).call(target);
          fsBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          fsBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
      });

      const overlay = c.querySelector('.video-overlay');
      if (overlay) {
        const show = () => {
          const bar = c.querySelector('.modern-control-bar');
          if (bar) bar.classList.add('visible');
        };
        overlay.addEventListener('mouseenter', () => { show();
          this.hideControlsAfterDelay(); });
        overlay.addEventListener('mousemove', () => { show();
          this.hideControlsAfterDelay(); });
        overlay.addEventListener('mouseleave', () => this.hideControlsAfterDelay());
        overlay.addEventListener('touchstart', (e) => {
          const bar = c.querySelector('.modern-control-bar');
          if (bar && bar.classList.contains('visible')) {
            bar.classList.remove('visible');
          } else {
            show();
            this.hideControlsAfterDelay();
          }
        }, { passive: true });

        // CHANGE 5: Double-tap handling with new seek deltas (-10 min, +20 min)
        overlay.addEventListener('touchstart', (e) => {
          const touch = e.touches[0];
          const rect = overlay.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const isLeft = x < rect.width / 2;
          const now = Date.now();
          const doubleTapDelay = 300;

          if (now - this.lastTapTime < doubleTapDelay) {
            // Double tap detected
            e.preventDefault();
            if (this.player && this.player.getDuration) {
              const currentTime = this.player.getCurrentTime();
              const newTime = isLeft ?
                Math.max(0, currentTime - 10) // -10 minutes
                :
                Math.min(this.player.getDuration(), currentTime + 20); // +20 minutes
              this.player.seekTo(newTime, true);

              // Show indicator
              const indicator = isLeft ?
                c.querySelector('.double-tap-left') :
                c.querySelector('.double-tap-right');
              if (indicator) {
                indicator.classList.add('show');
                setTimeout(() => indicator.classList.remove('show'), 500);
              }
            }
            clearTimeout(this.doubleTapTimer);
            this.lastTapTime = 0;
          } else {
            this.lastTapTime = now;
            this.doubleTapTimer = setTimeout(() => {
              this.lastTapTime = 0;
            }, doubleTapDelay);
          }
        }, { passive: false });
      }
    }

    hideControlsAfterDelay() {
      const bar = this.container.querySelector('.modern-control-bar');
      if (!bar) return;
      setTimeout(() => {
        if (this.player && this.player.getPlayerState() === YT.PlayerState.PLAYING) {
          bar.classList.remove('visible');
        }
      }, 3000);
    }

    startUpdateInterval() {
      if (this.updateInterval) clearInterval(this.updateInterval);
      this.updateInterval = setInterval(() => {
        if (!this.player) return;
        try {
          const cur = this.player.getCurrentTime() || 0;
          const dur = this.player.getDuration() || 0;
          const pct = dur > 0 ? (cur / dur) * 100 : 0;
          const track = this.container.querySelector('.progress-track');
          const thumb = this.container.querySelector('.progress-thumb');
          if (track) track.style.width = pct + '%';
          if (thumb) thumb.style.left = pct + '%';
          const time = this.container.querySelector('.time-display');
          if (time) {
            const fmt = s => isNaN(s) ? '0:00' : `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
            time.textContent = `${fmt(cur)} / ${fmt(dur)}`;
          }
        } catch (e) {}
      }, 500);
    }

    destroy() {
      if (this.updateInterval) clearInterval(this.updateInterval);
      if (this.doubleTapTimer) clearTimeout(this.doubleTapTimer);
      try { if (this.player && this.player.destroy) this.player.destroy(); } catch (e) {}
    }
  }

  // ---------- RENDERING ----------
  function renderPosts(posts) {
    if (activePlayerInstance) {
      activePlayerInstance.destroy();
      activePlayerInstance = null;
    }

    if (!posts || posts.length === 0) {
      postsGrid.innerHTML = `<div class="empty-state col-span-full">📚 No lessons found.</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    posts.forEach(post => {
      const card = createPostCard(post);
      fragment.appendChild(card);
    });
    postsGrid.innerHTML = '';
    postsGrid.appendChild(fragment);
  }

  function createPostCard(post) {
    const article = document.createElement('article');
    article.className = 'bg-white rounded-xl shadow-md overflow-hidden card-hover border border-gray-100 flex flex-col';

    const thumbnailUrl = getThumbnailUrl(post.videoUrl, post.thumbnailUrl);
    const tutorName = post.tutorName || 'Instructor';
    const formattedDate = formatDate(post.createdAt);
    const postTitle = post.postTitle || 'Untitled Lesson';
    const postSubtitle = post.postSubtitle || '';

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'relative h-48 bg-gray-200 overflow-hidden';
    const img = document.createElement('img');
    img.src = thumbnailUrl;
    img.alt = postTitle;
    img.className = 'w-full h-full object-cover';
    img.loading = 'lazy';
    img.onerror = () => { img.src =
      'https://images.unsplash.com/photo-1581091226033-d5c48150dbaa?q=80&w=1200&auto=format&fit=crop'; };
    thumbDiv.appendChild(img);

    const playBtn = document.createElement('div');
    playBtn.className = 'play-overlay-btn';
    playBtn.innerHTML = '<i class="fas fa-play"></i>';
    playBtn.setAttribute('aria-label', 'Play video');

    const launchPlayer = (e) => {
      e.stopPropagation();
      const videoId = extractYouTubeID(post.videoUrl);
      if (!videoId) {
        alert('Invalid video URL');
        return;
      }
      if (activePlayerInstance) {
        activePlayerInstance.destroy();
        activePlayerInstance = null;
      }
      activePlayerInstance = new SimpleYouTubePlayer(thumbDiv, videoId);
    };

    playBtn.onclick = launchPlayer;
    thumbDiv.appendChild(playBtn);
    article.appendChild(thumbDiv);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'p-5 flex-grow';

    const metaRow = document.createElement('div');
    metaRow.className = 'flex justify-between items-center mb-3';
    const tutorBadge = document.createElement('span');
    tutorBadge.className = 'text-xs font-semibold px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full uppercase';
    tutorBadge.textContent = tutorName;
    const dateSpan = document.createElement('span');
    dateSpan.className = 'text-xs font-medium px-2 py-1 bg-gray-100 text-gray-500 rounded-full';
    dateSpan.textContent = formattedDate;
    metaRow.appendChild(tutorBadge);
    metaRow.appendChild(dateSpan);
    bodyDiv.appendChild(metaRow);

    const titleEl = document.createElement('h3');
    titleEl.className = 'text-lg font-bold text-gray-800 mb-2 leading-tight';
    titleEl.textContent = postTitle;
    bodyDiv.appendChild(titleEl);

    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'text-gray-600 text-sm line-clamp-2';
    subtitleEl.textContent = postSubtitle;
    bodyDiv.appendChild(subtitleEl);

    article.appendChild(bodyDiv);

    const footerDiv = document.createElement('div');
    footerDiv.className = 'p-5 pt-0 border-t border-gray-50 mt-auto';
    const watchBtn = document.createElement('button');
    watchBtn.className =
      'w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2';
    watchBtn.innerHTML = '<i class="fa-brands fa-youtube text-lg"></i><span>Watch On YouTube</span>';
    watchBtn.onclick = (e) => {
      e.stopPropagation();
      const videoId = extractYouTubeID(post.videoUrl);
      if (!videoId) {
        alert('Invalid video URL');
        return;
      }
      window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank', 'noopener');
    };
    footerDiv.appendChild(watchBtn);
    article.appendChild(footerDiv);

    return article;
  }

  // ---------- INITIAL LOAD (CHANGE 2 applied) ----------
  async function initialize() {
    try {
      // CHANGE 2: Fetch only classes and recent posts in parallel, no chapters
      const [classes, recentPosts] = await Promise.all([
        fetchClasses(),
        fetchRecentPosts().catch(() => [])
      ]);

      classesData = classes;

      if (paramClassId && paramSubjectId && paramChapterId) {
        currentClassId = paramClassId;
        currentSubjectId = paramSubjectId;
        const selectedClass = classesData.find(c => c.classId === paramClassId);
        renderCourseSelect(paramClassId);
        renderSubjectSelect(selectedClass ? selectedClass.subjects : [], paramSubjectId);
        const chapters = await fetchChapters();
        populateDropdown(chapters);
        const matchedChapter = chapters.find(ch => ch.chapterId === paramChapterId);
        if (matchedChapter) {
          selectedValueSpan.innerText = matchedChapter.chapterName;
        }
        currentChapterId = paramChapterId;
        updateFeedSectionHeader();
        showLecturesView();
      } else {
        currentClassId = null;
        currentSubjectId = null;
        renderCourseSelect();
        renderSubjectSelect([]);
        populateDropdown([]);
        renderPosts(recentPosts);
        updateFeedSectionHeader();
      }
    } catch (err) {
      console.error('Init error:', err);
      postsGrid.innerHTML = `<div class="error-message col-span-full">Failed to load initial data. Please refresh.</div>`;
    }
  }

  initialize();
  // ---------- CAPSULE CLICK HANDLERS ----------
  document.getElementById('capsule-practice').addEventListener('click', showPracticeView);
  document.getElementById('capsule-lectures').addEventListener('click', showLecturesView);
})();

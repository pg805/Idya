// View: Lore — sidebar of sections, detail panel renders markdown body.
(function() {
  let sections = [];
  let selectedTitle = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Tiny markdown -> HTML for the lore body. Handles what the lore doc uses:
  // H2/H3 headings, **bold**, *italic*, --- rules, - bullets, blank-line paragraphs.
  function renderMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let inList = false;
    let paragraph = [];

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const text = paragraph.join(' ').trim();
      if (text) out.push(`<p>${formatInline(text)}</p>`);
      paragraph = [];
    };
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^---+$/.test(line.trim())) {
        flushParagraph(); closeList();
        out.push('<hr>');
        continue;
      }
      const h2 = line.match(/^## (.+)$/);
      if (h2) { flushParagraph(); closeList(); out.push(`<h2>${formatInline(h2[1])}</h2>`); continue; }
      const h3 = line.match(/^### (.+)$/);
      if (h3) { flushParagraph(); closeList(); out.push(`<h3>${formatInline(h3[1])}</h3>`); continue; }
      const bullet = line.match(/^- (.+)$/);
      if (bullet) {
        flushParagraph();
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push(`<li>${formatInline(bullet[1])}</li>`);
        continue;
      }
      if (line.trim() === '') { flushParagraph(); closeList(); continue; }
      paragraph.push(line);
    }
    flushParagraph(); closeList();
    return out.join('\n');
  }

  function formatInline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function mount(root) {
    setLayoutTitle('Lore');
    root.innerHTML = `
      <div class="lore-body">
        <aside class="lore-sidebar">
          <h2>Lore</h2>
          <div class="lore-list" id="lore-list"></div>
        </aside>
        <main class="lore-detail" id="lore-detail">
          <p class="lore-hint">Select a section.</p>
        </main>
      </div>
    `;

    const res = await fetch('/api/info/lore');
    if (!res.ok) {
      document.getElementById('lore-detail').innerHTML = `<p class="lore-hint">Could not load lore.</p>`;
      return;
    }
    const data = await res.json();
    sections = data.sections;

    const list = document.getElementById('lore-list');
    list.innerHTML = '';
    for (const s of sections) {
      const btn = document.createElement('button');
      btn.className = 'lore-btn';
      btn.dataset.slug = slugify(s.title);
      btn.textContent = s.title;
      btn.onclick = () => select(s.title);
      list.appendChild(btn);
    }

    if (sections.length > 0) select(sections[0].title);
  }

  function select(title) {
    const sec = sections.find(s => s.title === title);
    if (!sec) return;
    selectedTitle = title;
    const slug = slugify(title);
    document.querySelectorAll('.lore-btn').forEach(b => b.classList.toggle('active', b.dataset.slug === slug));

    document.getElementById('lore-detail').innerHTML = `
      <article class="lore-article">
        <h1>${esc(sec.title)}</h1>
        ${renderMarkdown(sec.body)}
      </article>
    `;
    document.getElementById('lore-detail').scrollTop = 0;
  }

  function unmount() {
    sections = [];
    selectedTitle = null;
  }

  window.Views = window.Views ?? {};
  window.Views.lore = { mount, unmount };
})();

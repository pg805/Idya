// View: Reference — game terms + pages overview. Mirrors lore.js with the
// reference endpoint + a tiny inline-table renderer in the markdown step.
(function() {
  let sections = [];
  let selectedTitle = null;

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatInline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ref-link">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  function renderMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let inList = false;
    let paragraph = [];
    let tableRows = null;          // null | array of cell-arrays
    let tableHeader = null;

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const text = paragraph.join(' ').trim();
      if (text) out.push(`<p>${formatInline(text)}</p>`);
      paragraph = [];
    };
    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    const closeTable = () => {
      if (!tableRows) return;
      const head = tableHeader ? `<thead><tr>${tableHeader.map(h => `<th>${formatInline(h)}</th>`).join('')}</tr></thead>` : '';
      const body = tableRows.map(r => `<tr>${r.map(c => `<td>${formatInline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<table class="ref-table">${head}<tbody>${body}</tbody></table>`);
      tableRows = null; tableHeader = null;
    };

    for (const raw of lines) {
      const line = raw.trimEnd();
      const tableRow = line.match(/^\|(.+)\|$/);
      const tableSep = line.match(/^\|[\s\-:|]+\|$/);

      if (tableRow && !tableSep) {
        flushParagraph(); closeList();
        const cells = tableRow[1].split('|').map(c => c.trim());
        if (!tableRows) { tableHeader = cells; tableRows = []; }
        else { tableRows.push(cells); }
        continue;
      }
      if (tableSep) continue; // separator row between header + body — ignored
      if (tableRows) closeTable();

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
    flushParagraph(); closeList(); closeTable();
    return out.join('\n');
  }

  function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function mount(root) {
    setLayoutTitle('Reference');
    root.innerHTML = `
      <div class="lore-body">
        <aside class="lore-sidebar">
          <h2>Reference</h2>
          <div class="lore-list" id="ref-list"></div>
        </aside>
        <main class="lore-detail" id="ref-detail">
          <p class="lore-hint">Select a section.</p>
        </main>
      </div>
    `;

    const res = await fetch('/api/info/reference');
    if (!res.ok) {
      document.getElementById('ref-detail').innerHTML = `<p class="lore-hint">Could not load reference.</p>`;
      return;
    }
    const data = await res.json();
    sections = data.sections;

    const list = document.getElementById('ref-list');
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
    const detail = document.getElementById('ref-detail');
    detail.innerHTML = `
      <article class="lore-article">
        <h1>${esc(sec.title)}</h1>
        ${renderMarkdown(sec.body)}
      </article>
    `;
    detail.scrollTop = 0;

    // Intercept intra-page anchor links (#section-slug) and route them to
    // select() so they switch sections instead of doing a full navigation.
    detail.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const slug = a.getAttribute('href').slice(1);
        const target = sections.find(s => slugify(s.title) === slug);
        if (target) select(target.title);
      });
    });
  }

  function unmount() {
    sections = [];
    selectedTitle = null;
  }

  window.Views = window.Views ?? {};
  window.Views.reference = { mount, unmount };
})();

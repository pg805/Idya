// View: About — single-section narrative page. Reuses the lore-article
// styles for type/spacing.
(function() {
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatInline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  }

  // Tiny markdown -> HTML; same shape as lore.js, no tables / lists needed
  // for the About copy.
  function renderMarkdown(md) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let paragraph = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const text = paragraph.join(' ').trim();
      if (text) out.push(`<p>${formatInline(text)}</p>`);
      paragraph = [];
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (/^---+$/.test(line.trim())) { flushParagraph(); out.push('<hr>'); continue; }
      const h2 = line.match(/^## (.+)$/);
      if (h2) { flushParagraph(); out.push(`<h2>${formatInline(h2[1])}</h2>`); continue; }
      if (line.trim() === '') { flushParagraph(); continue; }
      paragraph.push(line);
    }
    flushParagraph();
    return out.join('\n');
  }

  async function mount(root) {
    setLayoutTitle('About');
    root.innerHTML = `<div class="about-body"><p class="lore-hint">Loading…</p></div>`;
    const res = await fetch('/api/info/about');
    if (!res.ok) {
      root.querySelector('.about-body').innerHTML = `<p class="lore-hint">Could not load.</p>`;
      return;
    }
    const data = await res.json();
    const section = data.sections[0];
    if (!section) {
      root.querySelector('.about-body').innerHTML = `<p class="lore-hint">No content.</p>`;
      return;
    }
    root.querySelector('.about-body').innerHTML = `
      <article class="lore-article">
        <h1>${esc(section.title)}</h1>
        ${renderMarkdown(section.body)}
      </article>
    `;
  }

  function unmount() {}

  window.Views = window.Views ?? {};
  window.Views.about = { mount, unmount };
})();

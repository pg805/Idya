// View: Professions — info page showing what each level of each profession unlocks.
(function() {
  let data = null;
  let activeProf = 'lumberjack';

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function mount(root) {
    setLayoutTitle('Professions');
    root.innerHTML = `
      <div id="prof-body">
        <div id="prof-subtabs"></div>
        <div id="prof-content"></div>
      </div>
    `;
    if (!data) {
      const res = await fetch('/api/info/professions');
      if (!res.ok) {
        document.getElementById('prof-content').innerHTML = `<p class="prof-empty">Could not load profession data.</p>`;
        return;
      }
      data = await res.json();
    }
    render();
  }

  function render() {
    const subtabs = document.getElementById('prof-subtabs');
    subtabs.innerHTML = Object.entries(data.professions).map(([key, p]) => `
      <button class="prof-tab${key === activeProf ? ' active' : ''}" onclick="Views.professions.pick('${key}')">${esc(p.label)}</button>
    `).join('');

    const prof = data.professions[activeProf];
    const content = document.getElementById('prof-content');

    const rows = prof.levels.map(lvl => {
      const recipeText = lvl.recipes.length
        ? lvl.recipes.map(r => esc(r.name)).join(', ')
        : '<span class="prof-none">—</span>';
      const budgetText = lvl.budget_added > 0
        ? `<span class="prof-budget">+${lvl.budget_added} budget</span> <span class="prof-budget-total">(${lvl.budget} total)</span>`
        : (lvl.budget > 0 ? `<span class="prof-budget-total">${lvl.budget} budget</span>` : '<span class="prof-none">—</span>');
      return `<tr>
        <td class="prof-lvl">${lvl.level}</td>
        <td class="prof-unlocks">${recipeText}</td>
        <td class="prof-budget-cell">${budgetText}</td>
      </tr>`;
    }).join('');

    content.innerHTML = `
      <table class="prof-table">
        <thead><tr>
          <th>Level</th>
          <th>Recipes Unlocked</th>
          <th>Upgrade Budget</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function pick(key) {
    activeProf = key;
    render();
  }

  function unmount() {}

  window.Views = window.Views ?? {};
  window.Views.professions = { mount, unmount, pick };
})();

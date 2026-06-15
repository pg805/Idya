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

    // Upgrades climb a weapon toward Lv 5 at 3 per level, so N upgrades on a Lv 1
    // weapon = level 1 + N/3, shown as 1.0 → 1.3 → 1.6 → 2.0 → … (each upgrade ≈ +.3).
    const reachLevel = (n) => {
      const lv = 1 + Math.floor(n / 3);
      const dec = (n % 3) * 3;            // 0, 3, 6
      return dec ? `${lv}.${dec}` : `${lv}`;
    };
    const rows = prof.levels.map(lvl => {
      const recipeText = lvl.recipes.length
        ? lvl.recipes.map(r => esc(r.name)).join(', ')
        : '<span class="prof-none">—</span>';
      const budgetText = lvl.budget > 0
        ? `<span class="prof-budget-total">${lvl.budget} upgrade${lvl.budget !== 1 ? 's' : ''}</span> <span class="prof-budget">→ Lv ${reachLevel(lvl.budget)}</span>`
        : '<span class="prof-none">—</span>';
      return `<tr>
        <td class="prof-lvl">${lvl.level}</td>
        <td class="prof-unlocks">${recipeText}</td>
        <td class="prof-budget-cell">${budgetText}</td>
      </tr>`;
    }).join('');

    content.innerHTML = `
      <table class="prof-table">
        <thead><tr>
          <th>Rank</th>
          <th>Recipes Unlocked</th>
          <th>Upgrades / Weapon</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="prof-note">Each weapon can take this many upgrades — <b>3 upgrades = 1 weapon level</b>, climbing toward Lv 5. The level shown is for a <b>Lv 1</b> weapon; a higher-level weapon reaches Lv 5 with fewer (a Lv 3 weapon caps at 6 upgrades, a Lv 4 weapon at 3). One upgrade ≈ +0.3 of a level (1.0 → 1.3 → 1.6 → 2.0).</p>
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

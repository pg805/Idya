let weapons = [];
let selected = null;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function load() {
  await claimAuthFromUrl();
  const res  = await fetch('/api/weapons');
  const data = await res.json();
  weapons = data.weapons.filter(w => w.key !== 'honor');

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  await mountLayout({ title: 'Weapons' });

  const list = document.getElementById('weapon-list');
  list.innerHTML = '';
  for (const w of weapons) {
    const btn = document.createElement('button');
    btn.className = 'weapon-btn';
    btn.dataset.key = w.key;
    btn.innerHTML = `<span class="wname">${esc(w.name)}</span><span class="wlevel">Lv ${w.level}</span>`;
    btn.onclick = () => selectWeapon(w.key);
    list.appendChild(btn);
  }
}

function selectWeapon(key) {
  selected = weapons.find(w => w.key === key);
  if (!selected) return;

  document.querySelectorAll('.weapon-btn').forEach(b => b.classList.toggle('active', b.dataset.key === key));

  const w = selected;
  const resourceLine = w.resource ? `${w.resource.name} ${w.resource.max}` : '—';

  let rows = '';
  for (const set of w.sets) {
    for (let i = 0; i < set.actions.length; i++) {
      const a         = set.actions[i];
      const stat      = a.field ? `[${a.field.join(', ')}]` : `${a.value ?? 0}`;
      const costLabel = a.cost > 0 ? `−${a.cost}` : a.cost < 0 ? `+${Math.abs(a.cost)}` : '0';
      const mode      = a.field ? (a.aimed ? 'Aimed' : 'Reactive') : '—';
      const range     = a.range != null ? `${a.range}` : '—';
      const setCell   = i === 0
        ? `<td class="td-set" rowspan="${set.actions.length}">${esc(set.label)}</td>`
        : '';
      rows += `<tr>
        ${setCell}
        <td class="td-name">${esc(a.name)}</td>
        <td class="td-type">${esc(a.type_name)}</td>
        <td class="td-stat">${esc(stat)}</td>
        <td class="td-cost">${costLabel}</td>
        <td class="td-mode">${mode}</td>
        <td class="td-range">${range}</td>
        <td class="td-dmg">${esc(a.damage_subtype)}</td>
      </tr>`;
    }
  }

  document.getElementById('detail').innerHTML = `
    <div class="weapon-header">
      <h2>${esc(w.name)}</h2>
      <p class="weapon-meta">Lv ${w.level} &nbsp;·&nbsp; ${w.hp} HP &nbsp;·&nbsp; ${resourceLine}</p>
      ${w.professions.length ? `<p class="weapon-prof">Crafted by: ${w.professions.join(', ')}</p>` : ''}
      <p class="wdesc">${esc(w.description)}</p>
    </div>
    <table class="action-table">
      <thead><tr>
        <th>Set</th><th>Name</th><th>Type</th><th>Field / Value</th>
        <th>Cost</th><th>Mode</th><th>Range</th><th>Damage</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

load();

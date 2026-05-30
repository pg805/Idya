let weapons = [];
let selected = null;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fieldSummary(field) {
  const min = Math.min(...field);
  const max = Math.max(...field);
  const avg = (field.reduce((a, b) => a + b, 0) / field.length).toFixed(1);
  if (min === max) return `${min}`;
  return `${min}–${max} <span class="avg">avg ${avg}</span>`;
}

async function load() {
  const res = await fetch('/api/weapons');
  const data = await res.json();
  weapons = data.weapons;

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

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

  let setsHtml = '';
  for (const set of w.sets) {
    setsHtml += `<div class="action-set"><p class="set-label">${esc(set.label)}</p>`;
    for (const a of set.actions) {
      const statHtml = a.field
        ? `<span class="stat">${fieldSummary(a.field)}</span>`
        : `<span class="stat">${a.value ?? 0}</span>`;
      const costLabel = a.cost > 0 ? `−${a.cost}` : a.cost < 0 ? `+${Math.abs(a.cost)}` : '0';
      const modeTag = a.field
        ? `<span class="tag">${a.aimed ? 'Aimed' : 'Reactive'}</span>`
        : '';
      const rangeTag = a.range != null
        ? `<span class="tag">Range ${a.range}</span>`
        : '';
      setsHtml += `
        <div class="action-row">
          <span class="aname">${esc(a.name)}</span>
          <span class="atype">${esc(a.type_name)}</span>
          ${statHtml}
          <span class="cost tag">${costLabel}</span>
          ${modeTag}${rangeTag}
          <span class="dmgtype tag">${esc(a.damage_subtype)}</span>
        </div>`;
    }
    setsHtml += `</div>`;
  }

  document.getElementById('detail').innerHTML = `
    <div class="weapon-header">
      <h2>${esc(w.name)}</h2>
      <div class="weapon-meta">
        <span class="meta-chip">Lv ${w.level}</span>
        <span class="meta-chip">${w.hp} HP</span>
        <span class="meta-chip">${resourceLine}</span>
      </div>
      <p class="wdesc">${esc(w.description)}</p>
    </div>
    <div class="action-sets">${setsHtml}</div>
  `;
}

load();

// Sidebar walkthrough. Highlights each nav group with a tooltip card and
// Next/Skip controls. Only fires when ?tour=1 is in the URL — the tutorial's
// "Go to Town" link sets that param so the tour shows up after the tutorial
// battle, not during character creation.

// Order is the gameplay loop: where you spend money → how you make money →
// where you see your balance → what professions do → the activities sidebar
// → the workshop → reference info.
const TOUR_STEPS = [
  {
    selector: '#app-sidebar > .nav-group:nth-of-type(3)',
    title:    'Town Shops',
    body:     'Take your loot to the town shops to earn korel, the currency of the empire. Use korel to buy materials, items, weapons, or bait.',
  },
  {
    selector: '#app-sidebar a[data-path="/hunt"]',
    title:    'Hunting',
    body:     'Once you have bought some bait in the shops, hunt any creature you have bait for. Creatures will drop loot that you can sell back to the store.',
  },
  {
    selector: '.layout-korel',
    title:    'Korel',
    body:     'Your live korel count is shown in the top right.',
  },
  {
    selector: '.layout-prof-cards',
    title:    'Professions',
    body:     'Your professions determine what weapons you can craft and upgrade. Train your professions on your Character page.',
  },
  {
    selector: '#app-sidebar > .nav-group:nth-of-type(1)',
    title:    'Character & Activities',
    body:     'Manage your character sheet, browse your inventory, head out to hunt, and start a trade with another player.',
  },
  {
    selector: '#app-sidebar > .nav-group:nth-of-type(2)',
    title:    'The Bench',
    body:     'Craft items from materials, upgrade your equipped weapon, and apply magical enchants.',
  },
  {
    selector: '#app-sidebar > .nav-group:nth-of-type(4)',
    title:    'Reference',
    body:     'Profession recipe trees, enemy stats and drops, weapon stat tables.',
  },
];

function ensureTourDom() {
  if (document.getElementById('tour-root')) return;
  const root = document.createElement('div');
  root.id = 'tour-root';
  root.innerHTML = `
    <div id="tour-highlight"></div>
    <div id="tour-card">
      <div id="tour-progress"></div>
      <h3 id="tour-title"></h3>
      <p id="tour-body"></p>
      <div id="tour-actions">
        <button id="tour-skip" type="button">Skip</button>
        <button id="tour-next" type="button">Next</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
}

let stepIdx = 0;

function positionCard(targetRect) {
  const card = document.getElementById('tour-card');
  const cardW = card.offsetWidth;
  const cardH = card.offsetHeight;
  // Place card to the right of the highlight if there's room, else below.
  const margin = 14;
  const wantX  = targetRect.right + margin;
  const fitsRight = wantX + cardW <= window.innerWidth - 12;
  const x = fitsRight ? wantX : Math.max(12, Math.min(window.innerWidth - cardW - 12, targetRect.left));
  const y = fitsRight
    ? Math.max(12, Math.min(window.innerHeight - cardH - 12, targetRect.top))
    : Math.max(12, Math.min(window.innerHeight - cardH - 12, targetRect.bottom + margin));
  card.style.left = `${x}px`;
  card.style.top  = `${y}px`;
}

function showStep(idx) {
  stepIdx = idx;
  const step = TOUR_STEPS[idx];
  if (!step) { endTour(); return; }

  const target = document.querySelector(step.selector);
  if (!target) { endTour(); return; }

  const r = target.getBoundingClientRect();
  const hi = document.getElementById('tour-highlight');
  const pad = 6;
  hi.style.left   = `${r.left - pad}px`;
  hi.style.top    = `${r.top - pad}px`;
  hi.style.width  = `${r.width + pad * 2}px`;
  hi.style.height = `${r.height + pad * 2}px`;

  document.getElementById('tour-title').textContent    = step.title;
  document.getElementById('tour-body').textContent     = step.body;
  document.getElementById('tour-progress').textContent = `${idx + 1} / ${TOUR_STEPS.length}`;
  const nextBtn = document.getElementById('tour-next');
  nextBtn.textContent = idx === TOUR_STEPS.length - 1 ? 'Got it' : 'Next';

  // Position the card on next frame so its dimensions are accurate.
  requestAnimationFrame(() => positionCard(r));
}

function startTour() {
  ensureTourDom();
  document.body.classList.add('tour-active');
  document.getElementById('tour-skip').onclick = () => endTour();
  document.getElementById('tour-next').onclick = () => showStep(stepIdx + 1);
  window.addEventListener('resize', onResize);
  showStep(0);
}

function onResize() {
  const step = TOUR_STEPS[stepIdx];
  if (!step) return;
  const target = document.querySelector(step.selector);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const hi = document.getElementById('tour-highlight');
  const pad = 6;
  hi.style.left   = `${r.left - pad}px`;
  hi.style.top    = `${r.top - pad}px`;
  hi.style.width  = `${r.width + pad * 2}px`;
  hi.style.height = `${r.height + pad * 2}px`;
  positionCard(r);
}

function endTour() {
  document.body.classList.remove('tour-active');
  const root = document.getElementById('tour-root');
  if (root) root.remove();
  window.removeEventListener('resize', onResize);
}

window.maybeStartTour = function maybeStartTour() {
  const params = new URLSearchParams(location.search);
  if (params.get('tour') !== '1') return;
  params.delete('tour');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  startTour();
};

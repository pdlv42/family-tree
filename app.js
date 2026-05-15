/**
 * FAMILY TREE – app.js
 * Pure vanilla JS, no framework.
 * Architecture:
 *  - DataStore   : manages persons + relations, localStorage, undo/redo
 *  - TreeRenderer: layout calculation + DOM/SVG rendering
 *  - UI          : modals, panels, sidebar, toolbar events
 *  - App         : bootstrap + wiring
 */

/* ─────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────── */
const uid = () => `p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

const deepClone = obj => JSON.parse(JSON.stringify(obj));

/** Show a toast notification */
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark', info:'fa-circle-info', warning:'fa-triangle-exclamation' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type]} toast-icon"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

/** Show confirm dialog, returns promise */
function confirm(title, message) {
  return new Promise(resolve => {
    const ov = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    ov.classList.remove('hidden');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const cleanup = val => {
      ov.classList.add('hidden');
      ok.replaceWith(ok.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      resolve(val);
    };
    document.getElementById('confirm-ok').addEventListener('click', () => cleanup(true));
    document.getElementById('confirm-cancel').addEventListener('click', () => cleanup(false));
  });
}

/* ─────────────────────────────────────────────────────────────
   DATA STORE
───────────────────────────────────────────────────────────── */
const DataStore = (() => {
  const STORAGE_KEY = 'familytree_v2';

  let state = {
    persons: {},      // { [id]: PersonObject }
    relations: [],    // [{ id, personA, personB, type }]
    meta: { title: 'Gia đình tôi' }
  };

  // Undo/redo stacks
  let undoStack = [];
  let redoStack = [];

  /** Save snapshot for undo */
  function snapshot() {
    undoStack.push(deepClone(state));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    UI.updateUndoRedo();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(deepClone(state));
    state = undoStack.pop();
    persist();
    UI.updateUndoRedo();
    App.render();
    toast('Đã hoàn tác', 'info');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(deepClone(state));
    state = redoStack.pop();
    persist();
    UI.updateUndoRedo();
    App.render();
    toast('Đã làm lại', 'info');
  }

  /** Persist to localStorage */
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch(e) { console.warn('localStorage full', e); }
  }

  /** Load from localStorage */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { persons:{}, relations:[], meta:{title:'Gia đình tôi'}, ...parsed };
      }
    } catch(e) { console.warn('Could not load state', e); }
  }

  /* ── Person CRUD ── */
  function addPerson(data) {
    snapshot();
    const id = uid();
    state.persons[id] = { id, ...data };
    persist();
    return id;
  }

  function updatePerson(id, data) {
    if (!state.persons[id]) return;
    snapshot();
    state.persons[id] = { ...state.persons[id], ...data };
    persist();
  }

  function deletePerson(id) {
    if (!state.persons[id]) return;
    snapshot();
    delete state.persons[id];
    // Remove all relations involving this person
    state.relations = state.relations.filter(r => r.personA !== id && r.personB !== id);
    persist();
  }

  function getPerson(id) { return state.persons[id] || null; }
  function getAllPersons() { return Object.values(state.persons); }

  /* ── Relations ── */
  function addRelation(personA, personB, type) {
    // Prevent duplicates
    const exists = state.relations.some(
      r => r.type === type &&
        ((r.personA === personA && r.personB === personB) ||
         (r.personA === personB && r.personB === personA))
    );
    if (exists) { toast('Quan hệ này đã tồn tại', 'warning'); return false; }
    if (personA === personB) { toast('Không thể kết nối một người với chính họ', 'error'); return false; }
    snapshot();
    state.relations.push({ id: uid(), personA, personB, type });
    persist();
    return true;
  }

  function removeRelation(id) {
    snapshot();
    state.relations = state.relations.filter(r => r.id !== id);
    persist();
  }

  function getRelationsOf(personId) {
    return state.relations.filter(r => r.personA === personId || r.personB === personId);
  }

  function getAllRelations() { return state.relations; }

  /* ── Import / Export ── */
  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.persons || !parsed.relations) throw new Error('Invalid format');
      snapshot();
      state = { persons:{}, relations:[], meta:{title:'Gia đình tôi'}, ...parsed };
      persist();
      return true;
    } catch(e) {
      toast('File JSON không hợp lệ: ' + e.message, 'error');
      return false;
    }
  }

  /* ── Computed ── */
  /**
   * Compute generation (depth) for each person.
   * Root = persons with no parent relation = gen 0.
   * Returns Map<personId, generation>
   */
  function computeGenerations() {
    const persons = getAllPersons();
    const genMap = new Map();

    // Build children list from relations
    const childOf = {}; // personId → [parentId]
    for (const r of state.relations) {
      if (r.type === 'parent') {
        // personA is parent of personB
        if (!childOf[r.personB]) childOf[r.personB] = [];
        childOf[r.personB].push(r.personA);
      }
    }

    const roots = persons.filter(p => !childOf[p.id] || childOf[p.id].length === 0);
    const queue = roots.map(p => ({ id: p.id, gen: 0 }));
    const visited = new Set();

    while (queue.length) {
      const { id, gen } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      genMap.set(id, gen);
      // Find children
      for (const r of state.relations) {
        if (r.type === 'parent' && r.personA === id && !visited.has(r.personB)) {
          queue.push({ id: r.personB, gen: gen + 1 });
        }
      }
    }
    // Fallback: unvisited persons
    persons.forEach(p => { if (!genMap.has(p.id)) genMap.set(p.id, 0); });
    return genMap;
  }

  return {
    load, persist,
    addPerson, updatePerson, deletePerson, getPerson, getAllPersons,
    addRelation, removeRelation, getRelationsOf, getAllRelations,
    exportJSON, importJSON,
    computeGenerations,
    undo, redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
})();

/* ─────────────────────────────────────────────────────────────
   TREE RENDERER
   Calculates x/y positions then renders SVG edges + DOM nodes
───────────────────────────────────────────────────────────── */
const TreeRenderer = (() => {
  const NODE_W = 140, NODE_H = 130; // matches CSS
  const GAP_X = 50, GAP_Y = 70;
  let layout = 'vertical';   // 'vertical' | 'horizontal'
  let scale = 1;
  let panX = 0, panY = 0;
  let positions = {}; // { [id]: {x, y} }
  let selectedId = null;

  /** Set layout direction */
  function setLayout(l) { layout = l; }

  /**
   * Layered Sugiyama-ish layout.
   * Groups persons by generation, places them in rows/columns.
   */
  function calculateLayout(persons, relations) {
    positions = {};
    if (!persons.length) return positions;

    const genMap = DataStore.computeGenerations();
    const byGen = {};
    let maxGen = 0;

    for (const p of persons) {
      const g = genMap.get(p.id) ?? 0;
      if (!byGen[g]) byGen[g] = [];
      byGen[g].push(p.id);
      maxGen = Math.max(maxGen, g);
    }

    for (let g = 0; g <= maxGen; g++) {
      const ids = byGen[g] || [];
      ids.forEach((id, i) => {
        const total = ids.length;
        const cx = (total - 1) / 2;
        if (layout === 'vertical') {
          positions[id] = {
            x: (i - cx) * (NODE_W + GAP_X),
            y: g * (NODE_H + GAP_Y)
          };
        } else {
          positions[id] = {
            x: g * (NODE_W + GAP_X),
            y: (i - cx) * (NODE_H + GAP_Y)
          };
        }
      });
    }
    return positions;
  }

  /** Render SVG edges */
  function renderEdges(relations, positions) {
    const svg = document.getElementById('tree-svg');
    svg.innerHTML = '';

    for (const r of relations) {
      const a = positions[r.personA];
      const b = positions[r.personB];
      if (!a || !b) continue;

      const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2;
      const bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', `tree-edge ${r.type}`);

      let d;
      if (layout === 'vertical') {
        const midY = (ay + by) / 2;
        d = `M${ax},${ay} C${ax},${midY} ${bx},${midY} ${bx},${by}`;
      } else {
        const midX = (ax + bx) / 2;
        d = `M${ax},${ay} C${midX},${ay} ${midX},${by} ${bx},${by}`;
      }
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
  }

  /** Render DOM nodes */
  function renderNodes(persons, positions, filter) {
    const container = document.getElementById('tree-nodes');
    const existing = {};
    container.querySelectorAll('.tree-node').forEach(el => {
      existing[el.dataset.id] = el;
    });
    const rendered = new Set();

    for (const p of persons) {
      if (filter && !filter(p)) continue;
      const pos = positions[p.id];
      if (!pos) continue;
      rendered.add(p.id);

      let el = existing[p.id];
      if (!el) {
        el = createNodeEl(p);
        container.appendChild(el);
      } else {
        updateNodeEl(el, p);
      }
      el.style.left = pos.x + 'px';
      el.style.top  = pos.y + 'px';
      el.classList.toggle('selected', p.id === selectedId);
    }

    // Remove stale nodes
    container.querySelectorAll('.tree-node').forEach(el => {
      if (!rendered.has(el.dataset.id)) el.remove();
    });
  }

  function createNodeEl(p) {
    const el = document.createElement('div');
    el.className = `tree-node ${p.gender || 'other'}`;
    if (p.deathYear) el.classList.add('deceased');
    el.dataset.id = p.id;
    el.innerHTML = nodeHTML(p);
    el.addEventListener('click', e => {
      e.stopPropagation();
      UI.openDetailPanel(p.id);
      selectNode(p.id);
    });
    return el;
  }

  function updateNodeEl(el, p) {
    el.className = `tree-node ${p.gender || 'other'}`;
    if (p.deathYear) el.classList.add('deceased');
    el.innerHTML = nodeHTML(p);
  }

  function nodeHTML(p) {
    const photoEl = p.photo
      ? `<img class="node-photo" src="${escHtml(p.photo)}" alt="${escHtml(p.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="node-photo-placeholder" style="display:none"><i class="fas fa-user"></i></div>`
      : `<div class="node-photo-placeholder"><i class="fas fa-user"></i></div>`;
    const years = p.birthYear
      ? (p.deathYear ? `${p.birthYear} – ${p.deathYear}` : `Sinh ${p.birthYear}`)
      : '';
    const gIcons = { male:'fa-mars', female:'fa-venus', other:'fa-genderless' };
    return `
      ${photoEl}
      <div class="node-info">
        <div class="node-name">${escHtml(p.name || 'Chưa đặt tên')}</div>
        ${years ? `<div class="node-years">${years}</div>` : ''}
      </div>
      <div class="node-gender-badge ${p.gender||'other'}">
        <i class="fas ${gIcons[p.gender]||'fa-genderless'}"></i>
      </div>`;
  }

  function selectNode(id) {
    selectedId = id;
    document.querySelectorAll('.tree-node').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
  }

  /** Fit tree into viewport */
  function fitToView(containerEl) {
    const nodes = document.querySelectorAll('.tree-node');
    if (!nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const x = parseFloat(n.style.left), y = parseFloat(n.style.top);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + NODE_W); maxY = Math.max(maxY, y + NODE_H);
    });
    const cw = containerEl.clientWidth, ch = containerEl.clientHeight;
    const tw = maxX - minX + NODE_W, th = maxY - minY + NODE_H;
    const newScale = Math.min(1, Math.min(cw / (tw + 80), ch / (th + 80)));
    scale = Math.max(.15, newScale);
    panX = (cw - tw * scale) / 2 - minX * scale;
    panY = (cw - th * scale) / 4 - minY * scale;
    applyTransform();
  }

  function applyTransform() {
    const canvas = document.getElementById('tree-canvas');
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    const badge = document.querySelector('.zoom-badge');
    if (badge) {
      badge.textContent = Math.round(scale * 100) + '%';
      badge.classList.add('visible');
      clearTimeout(badge._t);
      badge._t = setTimeout(() => badge.classList.remove('visible'), 1500);
    }
  }

  function zoom(delta) {
    scale = Math.min(3, Math.max(.15, scale + delta));
    applyTransform();
  }

  function setPan(x, y) { panX = x; panY = y; applyTransform(); }
  function getState() { return { scale, panX, panY }; }

  /* ── Pan/drag on canvas ── */
  function initDrag(containerEl) {
    let dragging = false, sx, sy, spx, spy;
    containerEl.addEventListener('mousedown', e => {
      if (e.target.closest('.tree-node')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; spx = panX; spy = panY;
      containerEl.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panX = spx + e.clientX - sx;
      panY = spy + e.clientY - sy;
      applyTransform();
    });
    window.addEventListener('mouseup', () => { dragging = false; containerEl.style.cursor = ''; });

    // Touch
    let tp = null;
    containerEl.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        tp = e.touches[0];
        spx = panX; spy = panY;
      }
    }, {passive:true});
    containerEl.addEventListener('touchmove', e => {
      if (!tp || e.touches.length !== 1) return;
      panX = spx + e.touches[0].clientX - tp.clientX;
      panY = spy + e.touches[0].clientY - tp.clientY;
      applyTransform();
    }, {passive:true});
    containerEl.addEventListener('touchend', () => { tp = null; });

    // Wheel zoom
    containerEl.addEventListener('wheel', e => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? .08 : -.08);
    }, {passive:false});
  }

  /* ── SVG sizing ── */
  function resizeSVG() {
    const nodes = document.querySelectorAll('.tree-node');
    if (!nodes.length) return;
    let maxX = 0, maxY = 0;
    nodes.forEach(n => {
      maxX = Math.max(maxX, parseFloat(n.style.left) + NODE_W + 100);
      maxY = Math.max(maxY, parseFloat(n.style.top) + NODE_H + 100);
    });
    const svg = document.getElementById('tree-svg');
    svg.setAttribute('width', maxX);
    svg.setAttribute('height', maxY);
  }

  return {
    setLayout,
    calculateLayout,
    renderEdges,
    renderNodes,
    fitToView,
    zoom,
    applyTransform,
    initDrag,
    selectNode,
    getState,
    setPan,
    resizeSVG,
    get scale() { return scale; }
  };
})();

/* ─────────────────────────────────────────────────────────────
   UI  –  modals, panels, sidebar
───────────────────────────────────────────────────────────── */
const UI = (() => {
  let editingId = null;
  let customFieldCount = 0;

  /* ── Person Modal ── */
  function openPersonModal(id = null) {
    editingId = id;
    customFieldCount = 0;
    const modal = document.getElementById('person-overlay');
    const title = document.getElementById('modal-title');
    title.innerHTML = id
      ? '<i class="fas fa-pen"></i> Sửa thông tin'
      : '<i class="fas fa-user-plus"></i> Thêm thành viên';

    clearPersonForm();

    if (id) {
      const p = DataStore.getPerson(id);
      if (p) fillPersonForm(p);
    }
    modal.classList.remove('hidden');
  }

  function closePersonModal() {
    document.getElementById('person-overlay').classList.add('hidden');
    editingId = null;
  }

  function clearPersonForm() {
    ['name','gender','birth','death','phone','address','note','photo'].forEach(f => {
      const el = document.getElementById('field-' + f);
      if (el) { el.tagName === 'SELECT' ? (el.value = 'male') : (el.value = ''); }
    });
    document.getElementById('avatar-img').src = '';
    document.getElementById('avatar-img').classList.add('hidden');
    document.getElementById('avatar-placeholder').classList.remove('hidden');
    document.getElementById('custom-fields-list').innerHTML = '';
    customFieldCount = 0;
  }

  function fillPersonForm(p) {
    const set = (id, val) => { const el = document.getElementById('field-'+id); if (el && val !== undefined && val !== null) el.value = val; };
    set('name', p.name);
    set('gender', p.gender);
    set('birth', p.birthYear);
    set('death', p.deathYear);
    set('phone', p.phone);
    set('address', p.address);
    set('note', p.note);
    set('photo', p.photo);
    updateAvatarPreview(p.photo);
    if (p.customFields) {
      p.customFields.forEach(cf => addCustomFieldRow(cf.key, cf.value));
    }
  }

  function getPersonFormData() {
    const get = id => document.getElementById('field-'+id)?.value?.trim() || '';
    const customFields = [];
    document.querySelectorAll('.custom-field-row').forEach(row => {
      const key   = row.querySelector('.cf-key')?.value?.trim();
      const value = row.querySelector('.cf-val')?.value?.trim();
      if (key) customFields.push({ key, value });
    });
    return {
      name:    get('name'),
      gender:  get('gender'),
      birthYear: get('birth') ? parseInt(get('birth')) : null,
      deathYear: get('death') ? parseInt(get('death')) : null,
      phone:   get('phone'),
      address: get('address'),
      note:    get('note'),
      photo:   get('photo'),
      customFields,
    };
  }

  function savePersonForm() {
    const data = getPersonFormData();
    if (!data.name) { toast('Vui lòng nhập họ tên', 'error'); return; }
    if (editingId) {
      DataStore.updatePerson(editingId, data);
      toast('Đã cập nhật thông tin', 'success');
    } else {
      const newId = DataStore.addPerson(data);
      toast('Đã thêm thành viên mới', 'success');
    }
    closePersonModal();
    App.render();
  }

  function addCustomFieldRow(key = '', value = '') {
    customFieldCount++;
    const row = document.createElement('div');
    row.className = 'custom-field-row';
    row.innerHTML = `
      <input type="text" class="input cf-key" placeholder="Tên trường" value="${escHtml(key)}" />
      <input type="text" class="input cf-val" placeholder="Giá trị" value="${escHtml(value)}" />
      <button class="btn-icon" title="Xóa trường"><i class="fas fa-trash-can"></i></button>`;
    row.querySelector('.btn-icon').addEventListener('click', () => row.remove());
    document.getElementById('custom-fields-list').appendChild(row);
  }

  function updateAvatarPreview(url) {
    const img = document.getElementById('avatar-img');
    const ph  = document.getElementById('avatar-placeholder');
    if (url) {
      img.src = url;
      img.classList.remove('hidden');
      ph.classList.add('hidden');
      img.onerror = () => { img.classList.add('hidden'); ph.classList.remove('hidden'); };
    } else {
      img.classList.add('hidden');
      ph.classList.remove('hidden');
    }
  }

  /* ── Relation Modal ── */
  function openRelationModal() {
    const ov = document.getElementById('relation-overlay');
    const selA = document.getElementById('rel-person-a');
    const selB = document.getElementById('rel-person-b');
    const persons = DataStore.getAllPersons().sort((a,b) => (a.name||'').localeCompare(b.name||''));
    const opts = persons.map(p => `<option value="${p.id}">${escHtml(p.name||'Chưa đặt tên')}</option>`).join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (persons.length > 1) selB.value = persons[1].id;
    updateRelPreview();
    ov.classList.remove('hidden');
  }

  function updateRelPreview() {
    const pv = document.getElementById('rel-preview');
    const idA = document.getElementById('rel-person-a')?.value;
    const idB = document.getElementById('rel-person-b')?.value;
    const type = document.getElementById('rel-type')?.value;
    if (!idA || !idB || idA === idB) { pv.classList.add('hidden'); return; }
    const a = DataStore.getPerson(idA), b = DataStore.getPerson(idB);
    if (!a || !b) return;
    const labels = { parent:'là cha/mẹ của', child:'là con của', spouse:'là vợ/chồng của', sibling:'là anh/chị/em của' };
    pv.textContent = `${a.name} ${labels[type]||''} ${b.name}`;
    pv.classList.remove('hidden');
  }

  function saveRelation() {
    const idA = document.getElementById('rel-person-a').value;
    const idB = document.getElementById('rel-person-b').value;
    const type = document.getElementById('rel-type').value;
    if (!idA || !idB) return;
    // Normalize: 'child' means A is child of B → store as parent(B→A)
    let pA = idA, pB = idB, t = type;
    if (type === 'child') { pA = idB; pB = idA; t = 'parent'; }
    const ok = DataStore.addRelation(pA, pB, t);
    if (ok) {
      toast('Đã thêm quan hệ', 'success');
      document.getElementById('relation-overlay').classList.add('hidden');
      App.render();
    }
  }

  /* ── Detail Panel ── */
  function openDetailPanel(id) {
    const p = DataStore.getPerson(id);
    if (!p) return;
    const panel = document.getElementById('detail-panel');
    document.getElementById('detail-content').innerHTML = buildDetailHTML(p);
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('open'));

    document.getElementById('detail-edit').onclick = () => { closeDetailPanel(); openPersonModal(id); };
    document.getElementById('detail-delete').onclick = async () => {
      const ok = await confirm('Xóa thành viên', `Bạn có chắc muốn xóa "${p.name || 'thành viên này'}"?`);
      if (ok) {
        DataStore.deletePerson(id);
        closeDetailPanel();
        App.render();
        toast('Đã xóa thành viên', 'success');
      }
    };

    // Relation chips click
    panel.querySelectorAll('.rel-chip[data-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        TreeRenderer.selectNode(chip.dataset.id);
        openDetailPanel(chip.dataset.id);
      });
    });
  }

  function closeDetailPanel() {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('open');
    setTimeout(() => panel.classList.add('hidden'), 300);
    TreeRenderer.selectNode(null);
  }

  function buildDetailHTML(p) {
    const gLabel = { male:'Nam', female:'Nữ', other:'Khác' };
    const gIcon  = { male:'fa-mars', female:'fa-venus', other:'fa-genderless' };
    const photoEl = p.photo
      ? `<img src="${escHtml(p.photo)}" alt="${escHtml(p.name)}" onerror="this.parentElement.innerHTML='<div class=detail-avatar-placeholder><i class=fas fa-user></i></div>'" />`
      : `<div class="detail-avatar-placeholder"><i class="fas fa-user"></i></div>`;
    const years = p.birthYear
      ? (p.deathYear ? `${p.birthYear} – ${p.deathYear}` : `Sinh ${p.birthYear}`)
      : '';

    const fields = [];
    if (years)     fields.push({ icon:'fa-calendar', label:'Năm sinh/mất', val: years });
    if (p.phone)   fields.push({ icon:'fa-phone',    label:'Điện thoại', val: p.phone });
    if (p.address) fields.push({ icon:'fa-location-dot', label:'Địa chỉ', val: p.address });
    if (p.note)    fields.push({ icon:'fa-note-sticky', label:'Ghi chú', val: p.note });
    if (p.customFields) {
      p.customFields.forEach(cf => fields.push({ icon:'fa-tag', label: cf.key, val: cf.value }));
    }

    const relations = DataStore.getRelationsOf(p.id);
    const relChips = relations.map(r => {
      const otherId = r.personA === p.id ? r.personB : r.personA;
      const other = DataStore.getPerson(otherId);
      if (!other) return '';
      const rLabels = { parent: r.personA === p.id ? 'Con' : 'Cha/Mẹ', spouse:'Vợ/Chồng', sibling:'Anh/Chị/Em' };
      return `<span class="rel-chip" data-id="${otherId}">
        <i class="fas fa-user"></i> ${escHtml(other.name||'?')}
        <small style="color:var(--text-muted)">${rLabels[r.type]||r.type}</small>
      </span>`;
    }).join('');

    return `
      <div class="detail-avatar-wrap">${photoEl}</div>
      <div class="detail-name-row">
        <div class="detail-name">${escHtml(p.name||'Chưa đặt tên')}</div>
        <div class="detail-sub">
          <span class="detail-badge ${p.gender||'other'}">
            <i class="fas ${gIcon[p.gender]||'fa-genderless'}"></i> ${gLabel[p.gender]||'Khác'}
          </span>
          ${p.deathYear ? '<span class="detail-badge deceased"><i class="fas fa-cross"></i> Đã mất</span>' : ''}
        </div>
      </div>
      <div class="detail-fields">
        ${fields.map(f=>`
          <div class="detail-field">
            <div class="detail-field-icon"><i class="fas ${f.icon}"></i></div>
            <div class="detail-field-body">
              <div class="detail-field-label">${escHtml(f.label)}</div>
              <div class="detail-field-value">${escHtml(String(f.val))}</div>
            </div>
          </div>`).join('')}
      </div>
      ${relations.length ? `
      <div class="detail-relations">
        <div class="detail-relations-title">Quan hệ gia đình</div>
        ${relChips}
      </div>` : ''}`;
  }

  /* ── Sidebar member list ── */
  function renderSidebar() {
    const list   = document.getElementById('member-list');
    const search = document.getElementById('search-input').value.toLowerCase();
    const gFilter= document.getElementById('filter-gender').value;
    const gGen   = document.getElementById('filter-gen').value;
    const genMap = DataStore.computeGenerations();

    // Populate generation filter
    const genSel = document.getElementById('filter-gen');
    const maxGen = Math.max(0, ...Array.from(genMap.values()));
    const currentGens = Array.from(genSel.options).map(o => o.value).filter(v => v);
    for (let g = 0; g <= maxGen; g++) {
      if (!currentGens.includes(String(g))) {
        const opt = new Option(`Thế hệ ${g+1}`, g);
        genSel.appendChild(opt);
      }
    }

    let persons = DataStore.getAllPersons();
    if (search)   persons = persons.filter(p => (p.name||'').toLowerCase().includes(search));
    if (gFilter)  persons = persons.filter(p => p.gender === gFilter);
    if (gGen !== '') persons = persons.filter(p => String(genMap.get(p.id)) === gGen);

    persons.sort((a,b) => (a.name||'').localeCompare(b.name||''));

    document.getElementById('member-count').textContent = `${persons.length} thành viên`;

    list.innerHTML = persons.map(p => {
      const initials = (p.name||'?').split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
      const avatarHTML = p.photo
        ? `<div class="member-avatar"><img src="${escHtml(p.photo)}" alt="" loading="lazy" onerror="this.outerHTML='${initials}'" /></div>`
        : `<div class="member-avatar">${initials}</div>`;
      const years = p.birthYear ? (p.deathYear ? `${p.birthYear}–${p.deathYear}` : `b. ${p.birthYear}`) : '';
      return `<div class="member-card" data-id="${p.id}">
        ${avatarHTML}
        <div class="member-info">
          <div class="member-name">${escHtml(p.name||'Chưa đặt tên')}</div>
          <div class="member-meta">${years || (p.gender === 'male' ? 'Nam' : p.gender === 'female' ? 'Nữ' : '')}</div>
        </div>
        <div class="member-actions">
          <button class="btn-icon btn-sm edit-btn" data-id="${p.id}" title="Sửa"><i class="fas fa-pen"></i></button>
          <button class="btn-icon btn-sm del-btn" data-id="${p.id}" title="Xóa"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.member-card').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.edit-btn') || e.target.closest('.del-btn')) return;
        const id = card.dataset.id;
        UI.openDetailPanel(id);
        TreeRenderer.selectNode(id);
        scrollToNode(id);
      });
    });
    list.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openPersonModal(btn.dataset.id); });
    });
    list.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const p = DataStore.getPerson(btn.dataset.id);
        const ok = await confirm('Xóa thành viên', `Xóa "${p?.name||'thành viên này'}"?`);
        if (ok) { DataStore.deletePerson(btn.dataset.id); App.render(); toast('Đã xóa', 'success'); }
      });
    });
  }

  /* ── Timeline ── */
  function openTimeline() {
    const ov = document.getElementById('timeline-overlay');
    const content = document.getElementById('timeline-content');
    const persons = DataStore.getAllPersons();
    const events = [];
    persons.forEach(p => {
      if (p.birthYear) events.push({ year: p.birthYear, text: `${p.name} sinh ra`, type:'birth', p });
      if (p.deathYear) events.push({ year: p.deathYear, text: `${p.name} qua đời`, type:'death', p });
    });
    events.sort((a,b) => a.year - b.year);
    if (!events.length) {
      content.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Chưa có sự kiện nào</p>';
    } else {
      content.innerHTML = `<div class="timeline-list">${events.map(ev => `
        <div class="timeline-item">
          <div class="timeline-dot ${ev.type}"></div>
          <div class="timeline-year">${ev.year}</div>
          <div class="timeline-text">${escHtml(ev.text)}</div>
        </div>`).join('')}</div>`;
    }
    ov.classList.remove('hidden');
  }

  /* ── Stats ── */
  function openStats() {
    const ov = document.getElementById('stats-overlay');
    const content = document.getElementById('stats-content');
    const persons = DataStore.getAllPersons();
    const total  = persons.length;
    const males  = persons.filter(p => p.gender === 'male').length;
    const females= persons.filter(p => p.gender === 'female').length;
    const others = total - males - females;
    const genMap = DataStore.computeGenerations();
    const maxGen = total ? Math.max(...Array.from(genMap.values())) + 1 : 0;
    const mPct = total ? Math.round(males/total*100) : 0;
    const fPct = total ? Math.round(females/total*100) : 0;
    const oPct = 100 - mPct - fPct;
    content.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-card-num">${total}</div>
          <div class="stat-card-label">Tổng thành viên</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num">${maxGen}</div>
          <div class="stat-card-label">Số thế hệ</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num" style="color:var(--color-male)">${males}</div>
          <div class="stat-card-label">Nam</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-num" style="color:var(--color-female)">${females}</div>
          <div class="stat-card-label">Nữ</div>
        </div>
      </div>
      <div style="margin-top:16px">
        <div class="detail-field-label" style="margin-bottom:6px">Tỉ lệ giới tính</div>
        <div class="stats-bar-chart">
          <div class="stats-bar-male"   style="width:${mPct}%"></div>
          <div class="stats-bar-female" style="width:${fPct}%"></div>
          <div class="stats-bar-other"  style="width:${oPct}%"></div>
        </div>
        <div style="display:flex;gap:12px;margin-top:6px;font-size:.75rem;color:var(--text-muted)">
          <span><span style="color:var(--color-male)">■</span> Nam ${mPct}%</span>
          <span><span style="color:var(--color-female)">■</span> Nữ ${fPct}%</span>
          ${others ? `<span><span style="color:var(--color-warning)">■</span> Khác ${oPct}%</span>` : ''}
        </div>
      </div>
      <div style="margin-top:14px;font-size:.82rem;color:var(--text-secondary)">
        <strong>Quan hệ:</strong> ${DataStore.getAllRelations().length} kết nối
      </div>`;
    ov.classList.remove('hidden');
  }

  /* ── Stats bar (bottom) ── */
  function updateStatsBar() {
    const persons = DataStore.getAllPersons();
    const total  = persons.length;
    const males  = persons.filter(p => p.gender === 'male').length;
    const females= persons.filter(p => p.gender === 'female').length;
    const genMap = DataStore.computeGenerations();
    const maxGen = total ? Math.max(...Array.from(genMap.values())) + 1 : 0;
    document.getElementById('stat-total').textContent  = total;
    document.getElementById('stat-male').textContent   = males;
    document.getElementById('stat-female').textContent = females;
    document.getElementById('stat-gen').textContent    = maxGen;
  }

  /* ── Undo/redo buttons ── */
  function updateUndoRedo() {
    document.getElementById('btn-undo').disabled = !DataStore.canUndo();
    document.getElementById('btn-redo').disabled = !DataStore.canRedo();
  }

  function scrollToNode(id) {
    const node = document.querySelector(`.tree-node[data-id="${id}"]`);
    if (!node) return;
    const cont = document.getElementById('tree-container');
    const x = parseFloat(node.style.left), y = parseFloat(node.style.top);
    TreeRenderer.setPan(
      cont.clientWidth / 2 - x * TreeRenderer.scale - 70,
      cont.clientHeight / 2 - y * TreeRenderer.scale - 65
    );
  }

  return {
    openPersonModal, closePersonModal, savePersonForm,
    addCustomFieldRow, updateAvatarPreview,
    openRelationModal, saveRelation, updateRelPreview,
    openDetailPanel, closeDetailPanel,
    renderSidebar, openTimeline, openStats,
    updateStatsBar, updateUndoRedo,
    scrollToNode,
  };
})();

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ─────────────────────────────────────────────────────────────
   APP  –  bootstrap & main render loop
───────────────────────────────────────────────────────────── */
const App = (() => {
  let currentLayout = 'vertical';
  let initialized = false;

  function render() {
    const persons = DataStore.getAllPersons();
    const relations = DataStore.getAllRelations();
    const isEmpty = persons.length === 0;

    document.getElementById('empty-state').style.display = isEmpty ? 'flex' : 'none';
    document.getElementById('tree-canvas').style.display = isEmpty ? 'none' : '';

    if (!isEmpty) {
      const positions = TreeRenderer.calculateLayout(persons, relations);
      TreeRenderer.renderNodes(persons, positions);
      TreeRenderer.renderEdges(relations, positions);
      TreeRenderer.resizeSVG();
    }

    UI.renderSidebar();
    UI.updateStatsBar();
  }

  function init() {
    DataStore.load(); 
    // loadSampleDataIfEmpty();

    // Init tree interaction
    TreeRenderer.initDrag(document.getElementById('tree-container'));
    // Add zoom badge to container
    const badge = document.createElement('div');
    badge.className = 'zoom-badge';
    badge.textContent = '100%';
    document.getElementById('tree-container').appendChild(badge);

    render();

    // Fit after first render
    setTimeout(() => TreeRenderer.fitToView(document.getElementById('tree-container')), 100);

    bindEvents();
    initialized = true;
  }

  function bindEvents() {
    /* ── Person modal ── */
    document.getElementById('btn-add-person').addEventListener('click', () => UI.openPersonModal());
    document.getElementById('empty-add-btn').addEventListener('click', () => UI.openPersonModal());
    document.getElementById('modal-close').addEventListener('click', () => UI.closePersonModal());
    document.getElementById('person-cancel').addEventListener('click', () => UI.closePersonModal());
    document.getElementById('person-save').addEventListener('click', () => UI.savePersonForm());

    // Avatar URL live preview
    document.getElementById('field-photo').addEventListener('input', e => UI.updateAvatarPreview(e.target.value.trim()));

    // Avatar file upload → base64
    document.getElementById('field-photo-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('field-photo').value = ev.target.result;
        UI.updateAvatarPreview(ev.target.result);
      };
      reader.readAsDataURL(file);
    });

    // Custom field
    document.getElementById('add-custom-field').addEventListener('click', () => UI.addCustomFieldRow());

    /* ── Relation modal ── */
    document.getElementById('btn-add-relation').addEventListener('click', () => {
      if (!DataStore.getAllPersons().length) { toast('Hãy thêm thành viên trước', 'warning'); return; }
      UI.openRelationModal();
    });
    document.getElementById('relation-close').addEventListener('click', () => document.getElementById('relation-overlay').classList.add('hidden'));
    document.getElementById('relation-cancel').addEventListener('click', () => document.getElementById('relation-overlay').classList.add('hidden'));
    document.getElementById('relation-save').addEventListener('click', () => UI.saveRelation());
    ['rel-person-a','rel-person-b','rel-type'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => UI.updateRelPreview());
    });

    /* ── Detail panel ── */
    document.getElementById('detail-close').addEventListener('click', () => UI.closeDetailPanel());

    /* ── Search & filter ── */
    document.getElementById('search-input').addEventListener('input', e => {
      document.getElementById('clear-search').classList.toggle('hidden', !e.target.value);
      UI.renderSidebar();
    });
    document.getElementById('clear-search').addEventListener('click', () => {
      document.getElementById('search-input').value = '';
      document.getElementById('clear-search').classList.add('hidden');
      UI.renderSidebar();
    });
    document.getElementById('filter-gender').addEventListener('change', () => UI.renderSidebar());
    document.getElementById('filter-gen').addEventListener('change', () => UI.renderSidebar());

    /* ── Zoom ── */
    document.getElementById('btn-zoom-in').addEventListener('click', () => TreeRenderer.zoom(.15));
    document.getElementById('btn-zoom-out').addEventListener('click', () => TreeRenderer.zoom(-.15));
    document.getElementById('btn-center').addEventListener('click', () => {
      TreeRenderer.fitToView(document.getElementById('tree-container'));
    });

    /* ── Layout toggle ── */
    document.querySelectorAll('#layout-group .btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#layout-group .btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLayout = btn.dataset.layout;
        TreeRenderer.setLayout(currentLayout);
        render();
        setTimeout(() => TreeRenderer.fitToView(document.getElementById('tree-container')), 80);
      });
    });

    /* ── Import / Export ── */
    document.getElementById('btn-export').addEventListener('click', () => {
      const json = DataStore.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'family-tree.json'; a.click();
      URL.revokeObjectURL(url);
      toast('Đã xuất file JSON', 'success');
    });
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const ok = DataStore.importJSON(ev.target.result);
        if (ok) { render(); setTimeout(() => TreeRenderer.fitToView(document.getElementById('tree-container')), 100); toast('Import thành công', 'success'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    /* ── Export PNG ── */
    document.getElementById('btn-export-png').addEventListener('click', exportPNG);

    /* ── Timeline & Stats ── */
    document.getElementById('btn-timeline').addEventListener('click', () => UI.openTimeline());
    document.getElementById('timeline-close').addEventListener('click', () => document.getElementById('timeline-overlay').classList.add('hidden'));
    document.getElementById('btn-stats').addEventListener('click', () => UI.openStats());
    document.getElementById('stats-close').addEventListener('click', () => document.getElementById('stats-overlay').classList.add('hidden'));

    /* ── Dark mode ── */
    document.getElementById('btn-dark-mode').addEventListener('click', () => {
      const html = document.documentElement;
      const isDark = html.dataset.theme === 'dark';
      html.dataset.theme = isDark ? 'light' : 'dark';
      localStorage.setItem('ft_theme', html.dataset.theme);
      const icon = document.querySelector('#btn-dark-mode i');
      icon.className = isDark ? 'fas fa-moon' : 'fas fa-sun';
    });
    // Restore theme
    const savedTheme = localStorage.getItem('ft_theme');
    if (savedTheme) {
      document.documentElement.dataset.theme = savedTheme;
      document.querySelector('#btn-dark-mode i').className = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    /* ── Undo/redo ── */
    document.getElementById('btn-undo').addEventListener('click', () => DataStore.undo());
    document.getElementById('btn-redo').addEventListener('click', () => DataStore.redo());
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); DataStore.undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); DataStore.redo(); }
      if (e.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
        UI.closeDetailPanel();
      }
    });

    /* ── Sidebar collapse ── */
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
    });

    /* ── Mobile sidebar ── */
    document.getElementById('mobile-sidebar-btn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
    document.getElementById('tree-container').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('mobile-open');
    });

    /* ── Close overlays on backdrop click ── */
    ['person-overlay','relation-overlay','timeline-overlay','stats-overlay'].forEach(id => {
      document.getElementById(id).addEventListener('click', e => {
        if (e.target.id === id) document.getElementById(id).classList.add('hidden');
      });
    });
  }

  /* ── Export PNG ── */
  function exportPNG() {
    toast('Đang xuất PNG...', 'info', 2000);
    const canvas = document.getElementById('tree-canvas');
    // Temporarily reset transform for capture
    const prev = canvas.style.transform;
    canvas.style.transform = 'none';
    html2canvas(document.getElementById('tree-container'), {
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim() || '#f5f0e8',
      scale: 2,
      useCORS: true,
      logging: false,
    }).then(c => {
      canvas.style.transform = prev;
      const a = document.createElement('a');
      a.download = 'family-tree.png';
      a.href = c.toDataURL('image/png');
      a.click();
      toast('Đã xuất PNG', 'success');
    }).catch(() => {
      canvas.style.transform = prev;
      toast('Lỗi khi xuất PNG', 'error');
    });
  }

  /* ── Sample data ── */
  function loadSampleDataIfEmpty() {
    if (DataStore.getAllPersons().length > 0) return;
    const sample = getSampleData();
    DataStore.importJSON(JSON.stringify(sample));
  }

  function getSampleData() {
    // IDs are stable strings for demo data
    return {
      "meta": { "title": "Gia đình Nguyễn" },
      "persons": {
        "demo_01": {
          "id":"demo_01","name":"Nguyễn Văn Bình","gender":"male","birthYear":1945,"deathYear":2010,
          "photo":"https://i.pravatar.cc/150?img=51","phone":"","address":"Hà Nội","note":"Tổ phụ của gia đình","customFields":[]
        },
        "demo_02": {
          "id":"demo_02","name":"Lê Thị Hoa","gender":"female","birthYear":1950,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=47","phone":"0901 234 567","address":"Hà Nội","note":"","customFields":[]
        },
        "demo_03": {
          "id":"demo_03","name":"Nguyễn Văn Nam","gender":"male","birthYear":1972,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=52","phone":"0912 345 678","address":"TP.HCM","note":"Kỹ sư phần mềm","customFields":[{"key":"Nghề nghiệp","value":"Kỹ sư phần mềm"}]
        },
        "demo_04": {
          "id":"demo_04","name":"Trần Thị Mai","gender":"female","birthYear":1975,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=44","phone":"0923 456 789","address":"TP.HCM","note":"","customFields":[]
        },
        "demo_05": {
          "id":"demo_05","name":"Nguyễn Thị Lan","gender":"female","birthYear":1975,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=48","phone":"0934 567 890","address":"Đà Nẵng","note":"","customFields":[]
        },
        "demo_06": {
          "id":"demo_06","name":"Phạm Văn Dũng","gender":"male","birthYear":1970,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=53","phone":"0945 678 901","address":"Đà Nẵng","note":"","customFields":[]
        },
        "demo_07": {
          "id":"demo_07","name":"Nguyễn Văn An","gender":"male","birthYear":2000,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=55","phone":"0956 789 012","address":"TP.HCM","note":"Sinh viên đại học","customFields":[]
        },
        "demo_08": {
          "id":"demo_08","name":"Nguyễn Thị Bích","gender":"female","birthYear":2003,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=45","phone":"","address":"TP.HCM","note":"Học sinh","customFields":[]
        },
        "demo_09": {
          "id":"demo_09","name":"Phạm Văn Minh","gender":"male","birthYear":1998,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=56","phone":"0967 890 123","address":"Đà Nẵng","note":"","customFields":[]
        },
        "demo_10": {
          "id":"demo_10","name":"Phạm Thị Linh","gender":"female","birthYear":2005,"deathYear":null,
          "photo":"https://i.pravatar.cc/150?img=46","phone":"","address":"Đà Nẵng","note":"","customFields":[]
        }
      },
      "relations": [
        {"id":"r01","personA":"demo_01","personB":"demo_02","type":"spouse"},
        {"id":"r02","personA":"demo_01","personB":"demo_03","type":"parent"},
        {"id":"r03","personA":"demo_01","personB":"demo_05","type":"parent"},
        {"id":"r04","personA":"demo_03","personB":"demo_04","type":"spouse"},
        {"id":"r05","personA":"demo_05","personB":"demo_06","type":"spouse"},
        {"id":"r06","personA":"demo_03","personB":"demo_07","type":"parent"},
        {"id":"r07","personA":"demo_03","personB":"demo_08","type":"parent"},
        {"id":"r08","personA":"demo_05","personB":"demo_09","type":"parent"},
        {"id":"r09","personA":"demo_05","personB":"demo_10","type":"parent"},
        {"id":"r10","personA":"demo_03","personB":"demo_05","type":"sibling"}
      ]
    };
  }

  return { init, render };
})();

/* ─────────────────────────────────────────────────────────────
   BOOT
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => App.init());

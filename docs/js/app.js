/* 味之書 — main app */
'use strict';

const { SUPABASE_URL, SUPABASE_KEY, BUCKET } = window.APP_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- state ----------
const S = {
  session: null,
  recipes: [],        // list cache
  tags: [],
  categories: [],
  units: [],
  library: [],        // ingredients_library joined with category name
  filter: '全部',     // 全部 | ⭐最愛 | tag name
  search: '',
  detail: null,       // current recipe full record
  servings: 0,
  edit: null,         // edit form state
};

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, ms);
}

function isAdmin() { return !!S.session; }

function friendlyError(e) {
  console.error(e);
  const m = (e && (e.message || e.error_description)) || '';
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(m)) {
    return '無法連接資料庫 😥 可能是網絡問題，或 Supabase 免費專案閒置後暫停了 — 請到 Supabase 控制台按「Restore」再重試。';
  }
  return '出錯了：' + m;
}

// ---------- routing ----------
function nav(hash) { location.hash = hash; }

window.addEventListener('hashchange', route);

async function route() {
  const h = location.hash || '#/';
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.navitem').forEach(n => n.classList.remove('active'));
  window.scrollTo(0, 0);

  if (h.startsWith('#/recipe/')) {
    $('#view-detail').classList.add('active');
    await renderDetail(h.split('/')[2]);
  } else if (h.startsWith('#/edit')) {
    if (!isAdmin()) { toast('請先在「我的」登入'); nav('#/settings'); return; }
    $('#view-edit').classList.add('active');
    await renderEdit(h.split('/')[2] || null);
  } else if (h.startsWith('#/settings')) {
    $('[data-nav="settings"]').classList.add('active');
    $('#view-settings').classList.add('active');
    renderSettings();
  } else if (h.startsWith('#/fav')) {
    S.filter = '⭐最愛';
    $('[data-nav="fav"]').classList.add('active');
    $('#view-list').classList.add('active');
    renderList();
  } else {
    $('[data-nav="list"]').classList.add('active');
    $('#view-list').classList.add('active');
    renderList();
  }
}

// bottom nav
$$('.navitem').forEach(n => n.onclick = () => {
  const t = n.dataset.nav;
  if (t === 'settings') nav('#/settings');
  else if (t === 'fav') nav('#/fav');
  else if (t === 'search') { S.filter = '全部'; nav('#/'); setTimeout(() => $('#searchInput').focus(), 80); }
  else { S.filter = '全部'; S.search = ''; $('#searchInput').value = ''; nav('#/'); renderList(); }
});
$('#navAdd').onclick = () => nav('#/edit');

// ---------- data loading ----------
async function loadAll() {
  const [r, t, c, u, l] = await Promise.all([
    sb.from('recipes').select('*, recipe_tags(tags(id,name)), recipe_ingredients(name)').order('created_at', { ascending: false }),
    sb.from('tags').select('*').order('name'),
    sb.from('categories').select('*').order('sort_order'),
    sb.from('units').select('*').order('sort_order'),
    sb.from('ingredients_library').select('*, categories(name)').order('name'),
  ]);
  for (const q of [r, t, c, u, l]) if (q.error) throw q.error;
  S.recipes = r.data.map(x => ({ ...x, tagNames: x.recipe_tags.map(rt => rt.tags?.name).filter(Boolean) }));
  S.tags = t.data; S.categories = c.data; S.units = u.data; S.library = l.data;
  $('#unitlist').innerHTML = S.units.map(u2 => `<option>${esc(u2.name)}</option>`).join('');
}

// ---------- list ----------
function renderList() {
  const grid = $('#grid');
  // tag chips
  const chips = ['全部', '⭐最愛', ...S.tags.map(t => t.name)];
  $('#tagRow').innerHTML = chips.map(c =>
    `<div class="chip${S.filter === c ? ' active' : ''}" data-tag="${esc(c)}">${esc(c)}</div>`).join('');
  $$('#tagRow .chip').forEach(ch => ch.onclick = () => { S.filter = ch.dataset.tag; renderList(); });

  const q = S.search.trim().toLowerCase();
  let list = S.recipes;
  if (S.filter === '⭐最愛') list = list.filter(r => r.is_favourite);
  else if (S.filter !== '全部') list = list.filter(r => r.tagNames.includes(S.filter));
  if (q) list = list.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.tagNames.some(t => t.toLowerCase().includes(q)) ||
    (r.recipe_ingredients || []).some(i => (i.name || '').toLowerCase().includes(q)));

  $('#listEmpty').hidden = list.length > 0;
  grid.innerHTML = list.map(r => `
    <div class="recipe-card" data-id="${r.id}">
      ${r.cover_photo_url ? `<img class="thumb" src="${esc(r.cover_photo_url)}" loading="lazy">` : `<div class="thumb noimg">🍲</div>`}
      ${r.is_favourite ? '<div class="fav-heart">❤️</div>' : ''}
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        <div class="card-tags">${r.tagNames.map(t => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div>
        <div class="card-meta">${r.cook_time ? `<span>⏱ ${esc(r.cook_time)}</span>` : ''}${r.base_servings ? `<span>👤 ${r.base_servings}人</span>` : ''}</div>
      </div>
    </div>`).join('');
  $$('.recipe-card', grid).forEach(c => c.onclick = () => nav('#/recipe/' + c.dataset.id));
}

$('#searchInput').addEventListener('input', e => { S.search = e.target.value; renderList(); });

// ---------- detail ----------
async function renderDetail(id) {
  const v = $('#view-detail');
  v.innerHTML = '<div class="loading">載入中…</div>';
  const { data: r, error } = await sb.from('recipes')
    .select('*, recipe_tags(tags(id,name)), recipe_ingredients(*, ingredients_library(categories(name))), recipe_steps(*), recipe_references(*)')
    .eq('id', id).single();
  if (error) { v.innerHTML = `<div class="err-box">${esc(friendlyError(error))}</div>`; return; }

  r.tagNames = r.recipe_tags.map(rt => rt.tags?.name).filter(Boolean);
  r.recipe_ingredients.sort((a, b) => a.sort_order - b.sort_order);
  r.recipe_steps.sort((a, b) => a.sort_order - b.sort_order);
  r.recipe_references.sort((a, b) => a.sort_order - b.sort_order);
  S.detail = r;
  S.servings = r.base_servings || 2;

  v.innerHTML = `
    <button class="back" onclick="history.length>1?history.back():nav('#/')">← 返回</button>
    <div class="hero">
      ${r.cover_photo_url ? `<img src="${esc(r.cover_photo_url)}">` : `<div class="noimg">🍲</div>`}
      <div class="hero-tags">${r.tagNames.map(t => `<span class="mini-tag">${esc(t)}</span>`).join('')}</div>
    </div>
    <h1 class="detail-title">${esc(r.title)}</h1>
    <div class="detail-sub">
      ${r.prep_time ? `<span>⏱ 準備 <b>${esc(r.prep_time)}</b></span>` : ''}
      ${r.cook_time ? `<span>🔥 烹煮 <b>${esc(r.cook_time)}</b></span>` : ''}
      ${r.base_servings ? `<span>👤 <b>${r.base_servings} 人份</b></span>` : ''}
    </div>
    ${isAdmin() ? `<div class="detail-actions">
      <button class="btn btn-outline" id="favBtn">${r.is_favourite ? '❤️ 已加入最愛' : '🤍 加入最愛'}</button>
      <button class="btn btn-clay" onclick="nav('#/edit/${r.id}')">✏️ 編輯</button>
      <button class="btn btn-danger" id="delBtn">🗑 刪除</button>
    </div>` : ''}
    ${r.recipe_ingredients.length ? `<div class="section">
      <h3>食材</h3>
      <div class="servings">
        <label>份量調整</label>
        <div class="stepper"><button id="servDown">−</button><span id="serv"></span><button id="servUp">＋</button></div>
      </div>
      <div id="ings"></div>
    </div>` : ''}
    ${r.recipe_steps.length ? `<div class="section"><h3>製作方法</h3>${r.recipe_steps.map((s, i) => `
      <div class="step"><div class="step-num">${i + 1}</div><div class="step-body">
        <div class="step-text">${esc(s.text)}</div>
        ${s.photo_url ? `<img class="step-photo" src="${esc(s.photo_url)}" loading="lazy">` : ''}
      </div></div>`).join('')}</div>` : ''}
    ${r.recipe_references.length ? `<div class="section"><h3>靈感來源</h3>${r.recipe_references.map(f => `
      <a class="ref-link" href="${esc(f.url)}" target="_blank" rel="noopener">🔗 ${esc(f.label || f.url)}</a>`).join('')}</div>` : ''}
    ${r.notes ? `<div class="section"><h3>心得 · 筆記</h3><div class="note-box">${esc(r.notes)}</div></div>` : ''}`;

  if (r.recipe_ingredients.length) {
    $('#servDown').onclick = () => { S.servings = Math.max(1, S.servings - 1); renderIngs(); };
    $('#servUp').onclick = () => { S.servings++; renderIngs(); };
    renderIngs();
  }
  if (isAdmin()) {
    $('#favBtn').onclick = async () => {
      const nv = !S.detail.is_favourite;
      const { error: e2 } = await sb.from('recipes').update({ is_favourite: nv }).eq('id', r.id);
      if (e2) return toast(friendlyError(e2));
      S.detail.is_favourite = nv;
      $('#favBtn').textContent = nv ? '❤️ 已加入最愛' : '🤍 加入最愛';
      const lr = S.recipes.find(x => x.id === r.id); if (lr) lr.is_favourite = nv;
    };
    $('#delBtn').onclick = async () => {
      if (!confirm(`確定要刪除「${r.title}」嗎？此動作無法復原。`)) return;
      const { error: e3 } = await sb.from('recipes').delete().eq('id', r.id);
      if (e3) return toast(friendlyError(e3));
      // best-effort photo cleanup
      const paths = [r.cover_photo_url, ...r.recipe_steps.map(s2 => s2.photo_url)]
        .filter(Boolean).map(urlToStoragePath).filter(Boolean);
      if (paths.length) sb.storage.from(BUCKET).remove(paths);
      toast('已刪除');
      await loadAll().catch(() => {});
      nav('#/');
    };
  }
}

function fmtAmt(n) {
  const v = Math.round(n * 100) / 100;
  return String(v);
}

function renderIngs() {
  const r = S.detail;
  const f = S.servings / (r.base_servings || S.servings || 1);
  $('#serv').textContent = S.servings + ' 人份';
  $('#ings').innerHTML = r.recipe_ingredients.map(i => {
    const cat = i.ingredients_library?.categories?.name;
    const amt = i.amount != null ? `${fmtAmt(i.amount * f)} ${esc(i.unit || '')}` : esc([i.amount_text, i.unit].filter(Boolean).join(' ') || '');
    return `<div class="ingredient"><div class="ing-left">
      <span class="ing-name">${esc(i.name)}${cat ? `<span class="ing-cat">${esc(cat)}</span>` : ''}</span>
      ${i.note ? `<span class="ing-note">${esc(i.note)}</span>` : ''}
    </div><div class="ing-amt">${amt}</div></div>`;
  }).join('');
}

function urlToStoragePath(url) {
  const m = String(url).match(new RegExp(`/object/public/${BUCKET}/(.+)$`));
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------- image compression ----------
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) { const k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('壓縮失敗')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取相片')); };
    img.src = url;
  });
}

async function uploadPhoto(blob, folder) {
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ---------- edit form ----------
async function renderEdit(id) {
  const v = $('#view-edit');
  v.innerHTML = '<div class="loading">載入中…</div>';

  let E = {
    id: id ? Number(id) : null, title: '', prep: '', cook: '', servings: '',
    coverUrl: null, coverBlob: null, tags: [], ings: [], steps: [], refs: [], notes: '',
  };
  if (id) {
    const { data: r, error } = await sb.from('recipes')
      .select('*, recipe_tags(tags(name)), recipe_ingredients(*), recipe_steps(*), recipe_references(*)')
      .eq('id', id).single();
    if (error) { v.innerHTML = `<div class="err-box">${esc(friendlyError(error))}</div>`; return; }
    E.title = r.title; E.prep = r.prep_time || ''; E.cook = r.cook_time || '';
    E.servings = r.base_servings || ''; E.coverUrl = r.cover_photo_url; E.notes = r.notes || '';
    E.tags = r.recipe_tags.map(rt => rt.tags?.name).filter(Boolean);
    E.ings = r.recipe_ingredients.sort((a, b) => a.sort_order - b.sort_order)
      .map(i => ({ name: i.name, amt: i.amount != null ? String(i.amount) : (i.amount_text || ''), unit: i.unit || '', note: i.note || '', libId: i.library_ingredient_id }));
    E.steps = r.recipe_steps.sort((a, b) => a.sort_order - b.sort_order)
      .map(s => ({ text: s.text, photoUrl: s.photo_url, photoBlob: null }));
    E.refs = r.recipe_references.sort((a, b) => a.sort_order - b.sort_order)
      .map(f => ({ url: f.url, label: f.label || '' }));
  }
  if (!E.ings.length) E.ings.push({ name: '', amt: '', unit: '', note: '', libId: null });
  if (!E.steps.length) E.steps.push({ text: '', photoUrl: null, photoBlob: null });
  S.edit = E;

  v.innerHTML = `
    <div class="formbar">
      <button class="cancel" id="edCancel">取消</button>
      <div class="title">${id ? '編輯食譜' : '新增食譜'}</div>
      <button class="save" id="edSave">儲存</button>
    </div>
    <div class="cover-upload${E.coverUrl ? ' filled' : ''}" id="coverUp">
      ${E.coverUrl ? `<img src="${esc(E.coverUrl)}"><div class="change">📷 更換封面相片</div>`
      : `<div class="cam">📷</div><span>加封面相片</span>`}
      <input type="file" accept="image/*" hidden id="coverFile">
    </div>
    <div class="field"><input class="txt title-input" id="edTitle" placeholder="食譜名稱（例如：柱侯炆牛腩）" value="${esc(E.title)}"></div>
    <div class="field"><div class="meta-row">
      <div class="mini-field"><label>準備時間</label><input id="edPrep" placeholder="20 分鐘" value="${esc(E.prep)}"></div>
      <div class="mini-field"><label>烹煮時間</label><input id="edCook" placeholder="2 小時" value="${esc(E.cook)}"></div>
      <div class="mini-field"><label>份量（人）</label><input id="edServ" type="number" min="1" placeholder="4" value="${esc(E.servings)}"></div>
    </div></div>
    <div class="field">
      <div class="field-label">標籤 <span class="opt">可加多個</span></div>
      <div class="tag-input-area" id="tagArea"></div>
      <div class="tag-suggest" id="tagSuggest"></div>
    </div>
    <div class="field">
      <div class="field-label">食材</div>
      <div id="ingList"></div>
      <button class="add-line-btn" id="addIng">＋ 加食材</button>
      <div class="hint">開始打字會顯示以前用過的食材（按分類排列），揀完會自動填單位；亦可新增從未用過的食材。每項食材可加註解（選填）。</div>
    </div>
    <div class="field">
      <div class="field-label">製作方法</div>
      <div id="stepList"></div>
      <button class="add-line-btn" id="addStep">＋ 加步驟</button>
    </div>
    <div class="field">
      <div class="field-label">靈感來源 <span class="opt">選填</span></div>
      <div id="refList"></div>
      <button class="add-line-btn" id="addRef">＋ 加連結</button>
    </div>
    <div class="field">
      <div class="field-label">心得 · 筆記 <span class="opt">選填</span></div>
      <textarea class="txt" rows="3" id="edNotes" placeholder="任何額外備註、心得或改良建議…">${esc(E.notes)}</textarea>
    </div>`;

  // cover
  function bindCover() {
    $('#coverUp').onclick = () => $('#coverFile').click();
    $('#coverFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        E.coverBlob = await compressImage(f, 1600);
        const u = URL.createObjectURL(E.coverBlob);
        $('#coverUp').classList.add('filled');
        $('#coverUp').innerHTML = `<img src="${u}"><div class="change">📷 更換封面相片</div><input type="file" accept="image/*" hidden id="coverFile">`;
        bindCover();
      } catch (err) { toast(friendlyError(err)); }
    };
  }
  bindCover();

  renderTags(); renderIngRows(); renderStepRows(); renderRefRows();

  $('#addIng').onclick = () => { E.ings.push({ name: '', amt: '', unit: '', note: '', libId: null }); renderIngRows(); };
  $('#addStep').onclick = () => { E.steps.push({ text: '', photoUrl: null, photoBlob: null }); renderStepRows(); };
  $('#addRef').onclick = () => { E.refs.push({ url: '', label: '' }); renderRefRows(); };
  $('#edCancel').onclick = () => { if (confirm('放棄目前的修改？')) history.back(); };
  $('#edSave').onclick = saveRecipe;

  // ----- tags -----
  function renderTags() {
    $('#tagArea').innerHTML = E.tags.map((t, i) =>
      `<span class="tag-pill">${esc(t)} <span class="x" data-i="${i}">✕</span></span>`).join('') +
      `<input class="tag-add-input" id="tagInput" placeholder="＋ 加標籤">`;
    $$('#tagArea .x').forEach(x => x.onclick = () => { E.tags.splice(+x.dataset.i, 1); renderTags(); });
    const inp = $('#tagInput');
    inp.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const nv = inp.value.trim().replace(/,$/, '');
        if (nv && !E.tags.includes(nv)) E.tags.push(nv);
        renderTags(); $('#tagInput').focus();
      }
    };
    inp.onblur = () => { const nv = inp.value.trim(); if (nv && !E.tags.includes(nv)) { E.tags.push(nv); renderTags(); } };
    const sugg = S.tags.map(t => t.name).filter(t => !E.tags.includes(t)).slice(0, 12);
    $('#tagSuggest').innerHTML = sugg.length ? '常用：' + sugg.map(t => `<span data-t="${esc(t)}">${esc(t)}</span>`).join('') : '';
    $$('#tagSuggest span').forEach(sp => sp.onclick = () => { E.tags.push(sp.dataset.t); renderTags(); });
  }

  // ----- ingredients -----
  function renderIngRows() {
    $('#ingList').innerHTML = E.ings.map((g, i) => `
      <div class="ing-row" data-i="${i}">
        <div class="col-name">
          <input class="ing-name" placeholder="食材名稱" value="${esc(g.name)}" autocomplete="off">
          <div class="autocomplete"></div>
        </div>
        <div class="col-amt"><input class="ing-amt-in" placeholder="份量" value="${esc(g.amt)}"></div>
        <div class="col-unit"><input class="ing-unit" placeholder="單位" value="${esc(g.unit)}" list="unitlist"></div>
        <button class="ing-del">✕</button>
        <div class="ing-note-input"><input class="ing-note-in" placeholder="註解（選填）例如：需要清遠雞 / 雞上腿肉" value="${esc(g.note)}"></div>
      </div>`).join('');
    $$('#ingList .ing-row').forEach(row => {
      const i = +row.dataset.i, g = E.ings[i];
      const nameIn = $('.ing-name', row), ac = $('.autocomplete', row);
      nameIn.oninput = () => { g.name = nameIn.value; g.libId = null; showAuto(); };
      nameIn.onblur = () => setTimeout(() => ac.classList.remove('show'), 180);
      $('.ing-amt-in', row).oninput = e => g.amt = e.target.value;
      $('.ing-unit', row).oninput = e => g.unit = e.target.value;
      $('.ing-note-in', row).oninput = e => g.note = e.target.value;
      $('.ing-del', row).onclick = () => { E.ings.splice(i, 1); if (!E.ings.length) E.ings.push({ name: '', amt: '', unit: '', note: '', libId: null }); renderIngRows(); };
      function showAuto() {
        const q = nameIn.value.trim();
        if (!q) { ac.classList.remove('show'); return; }
        const byCat = {};
        S.library.filter(x => x.name.includes(q)).forEach(x => {
          const cn = x.categories?.name || '其他';
          (byCat[cn] = byCat[cn] || []).push(x);
        });
        let html = '';
        for (const cn of Object.keys(byCat)) {
          html += `<div class="ac-cat">${esc(cn)}</div>` + byCat[cn].map(x =>
            `<div class="ac-item" data-id="${x.id}"><span>${esc(x.name)}</span>${x.default_unit ? `<span class="u">預設 ${esc(x.default_unit)}</span>` : ''}</div>`).join('');
        }
        const exact = S.library.some(x => x.name === q);
        if (!exact) html += `<div class="ac-new">＋ 新增「${esc(q)}」為新食材</div>`;
        ac.innerHTML = html; ac.classList.add('show');
        $$('.ac-item', ac).forEach(it => it.onmousedown = e => {
          e.preventDefault();
          const lib = S.library.find(x => x.id === +it.dataset.id);
          g.name = lib.name; g.libId = lib.id;
          if (lib.default_unit) { g.unit = lib.default_unit; $('.ing-unit', row).value = lib.default_unit; }
          nameIn.value = lib.name; ac.classList.remove('show');
          $('.ing-amt-in', row).focus();
        });
        const an = $('.ac-new', ac);
        if (an) an.onmousedown = e => { e.preventDefault(); g.name = q; g._isNew = true; ac.classList.remove('show'); $('.ing-amt-in', row).focus(); };
      }
    });
  }

  // ----- steps -----
  function renderStepRows() {
    $('#stepList').innerHTML = E.steps.map((s, i) => `
      <div class="step-edit" data-i="${i}">
        <div class="step-badge">${i + 1}</div>
        <div class="step-content">
          <textarea placeholder="描述這個步驟…">${esc(s.text)}</textarea>
          ${s.photoUrl || s.photoBlob ? `<div class="step-photo-preview"><img src="${s.photoBlob ? URL.createObjectURL(s.photoBlob) : esc(s.photoUrl)}"><button class="rm">✕</button></div>`
        : `<button class="step-photo-btn">📷 加相片（選填）</button><input type="file" accept="image/*" hidden class="step-file">`}
        </div>
        <div class="step-tools">
          <button class="mv-up" title="上移">▲</button>
          <button class="mv-dn" title="下移">▼</button>
          <button class="st-del" title="刪除">🗑</button>
        </div>
      </div>`).join('');
    $$('#stepList .step-edit').forEach(row => {
      const i = +row.dataset.i, s = E.steps[i];
      $('textarea', row).oninput = e => s.text = e.target.value;
      const pb = $('.step-photo-btn', row), pf = $('.step-file', row);
      if (pb) { pb.onclick = () => pf.click(); pf.onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try { s.photoBlob = await compressImage(f, 1200); s.photoUrl = null; renderStepRows(); }
        catch (err) { toast(friendlyError(err)); }
      }; }
      const rm = $('.rm', row);
      if (rm) rm.onclick = () => { s.photoBlob = null; s.photoUrl = null; renderStepRows(); };
      $('.st-del', row).onclick = () => { if (s.text && !confirm('刪除這個步驟？')) return; E.steps.splice(i, 1); if (!E.steps.length) E.steps.push({ text: '', photoUrl: null, photoBlob: null }); renderStepRows(); };
      $('.mv-up', row).onclick = () => { if (i > 0) { [E.steps[i - 1], E.steps[i]] = [E.steps[i], E.steps[i - 1]]; renderStepRows(); } };
      $('.mv-dn', row).onclick = () => { if (i < E.steps.length - 1) { [E.steps[i + 1], E.steps[i]] = [E.steps[i], E.steps[i + 1]]; renderStepRows(); } };
    });
  }

  // ----- refs -----
  function renderRefRows() {
    $('#refList').innerHTML = E.refs.map((f, i) => `
      <div class="ref-row" data-i="${i}">
        <input class="ref-url" placeholder="貼上網址或影片連結" value="${esc(f.url)}">
        <input class="ref-label" placeholder="說明（選填）" value="${esc(f.label)}" style="flex:.7">
        <button class="del">✕</button>
      </div>`).join('');
    $$('#refList .ref-row').forEach(row => {
      const i = +row.dataset.i, f = E.refs[i];
      $('.ref-url', row).oninput = e => f.url = e.target.value;
      $('.ref-label', row).oninput = e => f.label = e.target.value;
      $('.del', row).onclick = () => { E.refs.splice(i, 1); renderRefRows(); };
    });
  }

  // ----- save -----
  async function saveRecipe() {
    const title = $('#edTitle').value.trim();
    if (!title) { toast('請先輸入食譜名稱'); $('#edTitle').focus(); return; }
    const btn = $('#edSave'); btn.disabled = true; btn.textContent = '儲存中…';
    try {
      // 1. cover photo
      let coverUrl = E.coverUrl;
      if (E.coverBlob) coverUrl = await uploadPhoto(E.coverBlob, 'covers');

      // 2. recipe row
      const rec = {
        title, prep_time: $('#edPrep').value.trim() || null, cook_time: $('#edCook').value.trim() || null,
        base_servings: parseInt($('#edServ').value) || null, notes: $('#edNotes').value.trim() || null,
        cover_photo_url: coverUrl, updated_at: new Date().toISOString(),
      };
      let recipeId = E.id;
      if (recipeId) {
        const { error } = await sb.from('recipes').update(rec).eq('id', recipeId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('recipes').insert(rec).select('id').single();
        if (error) throw error;
        recipeId = data.id;
      }

      // 3. tags — upsert by name, replace links
      const tagIds = [];
      for (const tn of E.tags) {
        let t = S.tags.find(x => x.name === tn);
        if (!t) {
          const { data, error } = await sb.from('tags').upsert({ name: tn }, { onConflict: 'name' }).select().single();
          if (error) throw error; t = data; S.tags.push(t);
        }
        tagIds.push(t.id);
      }
      await sb.from('recipe_tags').delete().eq('recipe_id', recipeId);
      if (tagIds.length) {
        const { error } = await sb.from('recipe_tags').insert(tagIds.map(tid => ({ recipe_id: recipeId, tag_id: tid })));
        if (error) throw error;
      }

      // 4. ingredients — save new ones to library, replace rows
      const ings = E.ings.filter(g => g.name.trim());
      const otherCat = S.categories.find(c => c.name === '其他');
      for (const g of ings) {
        if (!g.libId) {
          const existing = S.library.find(x => x.name === g.name.trim());
          if (existing) g.libId = existing.id;
          else {
            const { data, error } = await sb.from('ingredients_library')
              .upsert({ name: g.name.trim(), default_unit: g.unit.trim() || null, category_id: otherCat?.id || null }, { onConflict: 'name' })
              .select('*, categories(name)').single();
            if (!error && data) { g.libId = data.id; S.library.push(data); }
          }
        }
      }
      await sb.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      if (ings.length) {
        const rows = ings.map((g, i) => {
          const num = g.amt.trim() !== '' && !isNaN(Number(g.amt)) ? Number(g.amt) : null;
          return {
            recipe_id: recipeId, library_ingredient_id: g.libId, name: g.name.trim(),
            amount: num, amount_text: num == null ? (g.amt.trim() || null) : null,
            unit: g.unit.trim() || null, note: g.note.trim() || null, sort_order: i,
          };
        });
        const { error } = await sb.from('recipe_ingredients').insert(rows);
        if (error) throw error;
      }

      // 5. steps — upload new photos, replace rows
      const steps = E.steps.filter(s => s.text.trim() || s.photoBlob || s.photoUrl);
      for (const s of steps) if (s.photoBlob) s.photoUrl = await uploadPhoto(s.photoBlob, 'steps');
      await sb.from('recipe_steps').delete().eq('recipe_id', recipeId);
      if (steps.length) {
        const { error } = await sb.from('recipe_steps').insert(steps.map((s, i) =>
          ({ recipe_id: recipeId, step_number: i + 1, text: s.text.trim(), photo_url: s.photoUrl, sort_order: i })));
        if (error) throw error;
      }

      // 6. references
      const refs = E.refs.filter(f => f.url.trim());
      await sb.from('recipe_references').delete().eq('recipe_id', recipeId);
      if (refs.length) {
        const { error } = await sb.from('recipe_references').insert(refs.map((f, i) =>
          ({ recipe_id: recipeId, url: f.url.trim(), label: f.label.trim() || null, sort_order: i })));
        if (error) throw error;
      }

      toast('已儲存 ✅');
      await loadAll().catch(() => {});
      nav('#/recipe/' + recipeId);
    } catch (err) {
      toast(friendlyError(err), 5000);
    } finally {
      btn.disabled = false; btn.textContent = '儲存';
    }
  }
}

// ---------- settings ----------
function renderSettings() {
  const v = $('#view-settings');
  const admin = isAdmin();
  v.innerHTML = `
    <div class="settings-title">我的</div>
    <div class="section">
      <h3>管理員</h3>
      ${admin ? `
        <div class="admin-badge">✓ 已登入 · ${esc(S.session.user.email)}</div>
        <p class="hint" style="margin-bottom:14px">此裝置會保持登入，可以新增、編輯及刪除食譜。</p>
        <button class="btn btn-outline" id="logoutBtn">登出</button>`
      : `
        <p class="hint" style="margin-bottom:14px">登入後可以新增、編輯及刪除食譜。未登入亦可瀏覽所有食譜。</p>
        <div class="login-form">
          <input class="txt" id="loginEmail" type="email" placeholder="電郵地址" autocomplete="username">
          <input class="txt" id="loginPw" type="password" placeholder="密碼" autocomplete="current-password">
          <div class="login-err" id="loginErr"></div>
          <button class="btn btn-clay" id="loginBtn">登入</button>
        </div>`}
    </div>
    ${admin ? `
    <div class="section">
      <h3>食材分類</h3>
      <div id="catList"></div>
      <button class="add-line-btn" id="addCat">＋ 加分類</button>
    </div>
    <div class="section">
      <h3>單位</h3>
      <div id="unitList"></div>
      <button class="add-line-btn" id="addUnit">＋ 加單位</button>
    </div>` : ''}
    <div class="section">
      <h3>關於</h3>
      <p class="hint">味之書 · 我的食譜簿 — 為我們兩個人而做 ❤️<br>將此頁「加至主畫面」即可像 App 一樣使用，先前看過的食譜離線亦可閱讀。</p>
    </div>`;

  if (!admin) {
    $('#loginBtn').onclick = async () => {
      const email = $('#loginEmail').value.trim(), pw = $('#loginPw').value;
      $('#loginErr').textContent = '';
      $('#loginBtn').disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      $('#loginBtn').disabled = false;
      if (error) {
        $('#loginErr').textContent = /Invalid login/i.test(error.message) ? '電郵或密碼不正確' : friendlyError(error);
        return;
      }
      S.session = data.session;
      updateAdminUI(); renderSettings(); toast('登入成功 👩‍🍳');
    };
    $('#loginPw').onkeydown = e => { if (e.key === 'Enter') $('#loginBtn').click(); };
  } else {
    $('#logoutBtn').onclick = async () => {
      await sb.auth.signOut();
      S.session = null; updateAdminUI(); renderSettings(); toast('已登出');
    };
    renderPresets('categories', '#catList', '#addCat');
    renderPresets('units', '#unitList', '#addUnit');
  }

  function renderPresets(table, listSel, addSel) {
    const arr = table === 'categories' ? S.categories : S.units;
    $(listSel).innerHTML = arr.map((x, i) => `
      <div class="preset-item" data-id="${x.id}">
        <span class="nm">${esc(x.name)}</span>
        <button class="p-up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="p-dn" ${i === arr.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="p-rn">✏️</button>
        <button class="p-del">✕</button>
      </div>`).join('');
    $$(listSel + ' .preset-item').forEach(row => {
      const id = +row.dataset.id;
      const idx = arr.findIndex(x => x.id === id);
      $('.p-rn', row).onclick = async () => {
        const nv = prompt('新名稱：', arr[idx].name);
        if (!nv || nv.trim() === arr[idx].name) return;
        const { error } = await sb.from(table).update({ name: nv.trim() }).eq('id', id);
        if (error) return toast(friendlyError(error));
        arr[idx].name = nv.trim(); renderSettings();
      };
      $('.p-del', row).onclick = async () => {
        if (!confirm(`刪除「${arr[idx].name}」？`)) return;
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) return toast('無法刪除（可能有食材正在使用）');
        arr.splice(idx, 1); renderSettings();
      };
      const swap = async (j) => {
        const a = arr[idx], b = arr[j];
        const { error: e1 } = await sb.from(table).update({ sort_order: b.sort_order }).eq('id', a.id);
        const { error: e2 } = await sb.from(table).update({ sort_order: a.sort_order }).eq('id', b.id);
        if (e1 || e2) return toast(friendlyError(e1 || e2));
        [a.sort_order, b.sort_order] = [b.sort_order, a.sort_order];
        arr.sort((x, y) => x.sort_order - y.sort_order);
        renderSettings();
      };
      $('.p-up', row).onclick = () => swap(idx - 1);
      $('.p-dn', row).onclick = () => swap(idx + 1);
    });
    $(addSel).onclick = async () => {
      const nv = prompt(table === 'categories' ? '新分類名稱：' : '新單位名稱：');
      if (!nv || !nv.trim()) return;
      const maxSort = Math.max(0, ...arr.map(x => x.sort_order));
      const { data, error } = await sb.from(table).insert({ name: nv.trim(), sort_order: maxSort + 1 }).select().single();
      if (error) return toast(friendlyError(error));
      arr.push(data); renderSettings();
      if (table === 'units') $('#unitlist').innerHTML = S.units.map(u => `<option>${esc(u.name)}</option>`).join('');
    };
  }
}

function updateAdminUI() {
  $('#navAdd').hidden = !isAdmin();
}

// ---------- offline banner ----------
function updateOnline() { $('#offlineBanner').hidden = navigator.onLine; }
window.addEventListener('online', () => { updateOnline(); loadAll().then(route).catch(() => {}); });
window.addEventListener('offline', updateOnline);

// ---------- boot ----------
(async function boot() {
  updateOnline();
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((_e, sess) => { S.session = sess; updateAdminUI(); });
  updateAdminUI();
  try {
    await loadAll();
  } catch (e) {
    $('#grid').innerHTML = '';
    $('#view-list').insertAdjacentHTML('beforeend', `<div class="err-box">${esc(friendlyError(e))}</div>`);
  }
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

window.nav = nav;

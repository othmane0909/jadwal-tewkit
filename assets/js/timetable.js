'use strict';

(function () {

/* ── Constants ──────────────────────────────────────── */
var DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
var C = { FAC:0, DEPT:1, DAY:2, SESSION:3, ROOM:4, COURSE:5, SPEC:6, LEVEL:7, GROUP:8, TYPE:9, TEACHER:10, TIME:11, SEM:12 };
var STORAGE_KEY = 'ut_last_search';

/* ── State ──────────────────────────────────────────── */
var allRows         = [];
var sectionToGroup  = {};
var currentMatrix   = null;
var currentInfo     = null;
var currentSessions = [];
var currentTimesMap = {};

/* ── Helpers ────────────────────────────────────────── */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function $(id) { return document.getElementById(id); }

function showStatus(type, msg) {
  var el = $('ut-status-bar');
  if (!el) return;
  el.className = 'ut-status-bar ut-status-' + type;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function fillSelect(id, options, placeholder) {
  var el = $(id);
  if (!el) return;
  el.innerHTML = '<option value="">' + (placeholder || '— اختر —') + '</option>' +
    options.map(function(o){ return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('');
  el.disabled = false;
}

function resetSelect(id, placeholder) {
  var el = $(id);
  if (!el) return;
  el.innerHTML = '<option value="">' + (placeholder || '— اختر —') + '</option>';
  el.disabled = true;
  el.value = '';
}

function clearSchedule() {
  currentMatrix = null; currentInfo = null; currentSessions = []; currentTimesMap = {};
  var sc = $('ut-schedule-container');
  if (sc) { sc.style.display = 'none'; sc.innerHTML = ''; }
  var ab = $('ut-action-buttons');
  if (ab) ab.style.display = 'none';
}

function unique(arr) {
  return arr.filter(function(v,i,a){ return v && a.indexOf(v) === i; }).sort();
}

/* ── Full-bleed width ───────────────────────────────── */
function applyFullWidth() {
  var wrapper = document.querySelector('.ut-wrapper');
  if (!wrapper) return;
  var el = wrapper.parentElement;
  while (el && el.tagName !== 'BODY') {
    el.style.maxWidth = 'none';
    el.style.overflow = 'visible';
    el.style.overflowX = 'visible';
    el = el.parentElement;
  }
  var vw = document.documentElement.clientWidth;
  var rect = wrapper.getBoundingClientRect();
  var scrollX = window.pageXOffset || 0;
  wrapper.style.width = vw + 'px';
  wrapper.style.minHeight = window.innerHeight + 'px';
  wrapper.style.marginLeft = '-' + (rect.left + scrollX) + 'px';
  wrapper.style.marginRight = '0';
}

/* ── Section → Group mapping ────────────────────────── */
var G = { FAC:1, DEPT:2, LEVEL:3, SPEC:4, GROUP:5, SECTION:6 };

function buildSectionMap(groups) {
  sectionToGroup = {};
  groups.forEach(function(g) {
    if (!g[G.SECTION] || !g[G.GROUP]) return;
    var key = [g[G.FAC], g[G.DEPT], g[G.LEVEL], g[G.SPEC], String(g[G.SECTION])].join('|');
    sectionToGroup[key] = String(g[G.GROUP]);
  });
}

function findParentGroup(fac, dept, level, spec, group) {
  var key = [fac, dept, level, spec, group].join('|');
  return sectionToGroup[key] || null;
}

/* ── Security: التحقق من رابط Apps Script ───────────── */
function isValidAppsScriptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    var u = new URL(url);
    return u.protocol === 'https:' &&
           u.hostname === 'script.google.com' &&
           u.pathname.indexOf('/macros/') === 0;
  } catch(e) { return false; }
}

/* ── Data Fetching ──────────────────────────────────── */
function normaliseRows(rows) {
  return rows.map(function(row){
    var r = row.slice();
    while (r.length < 13) r.push('');
    return r.map(function(v){ return v == null ? '' : String(v); });
  });
}

function fetchSheetData() {
  var cfg = UT_CONFIG || {};

  if (cfg.ajaxUrl && cfg.nonce) {
    return fetch(cfg.ajaxUrl + '?action=ut_get_data&nonce=' + encodeURIComponent(cfg.nonce))
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (!data.success) throw new Error(data.data || 'خطأ من الخادم');
        buildSectionMap(data.data.groups || []);
        return normaliseRows(data.data.rows || []);
      });
  }

  if (cfg.appsScriptUrl) {
    if (!isValidAppsScriptUrl(cfg.appsScriptUrl)) {
      return Promise.reject(new Error('رابط Apps Script غير صالح — افتح config.js وضع رابطاً يبدأ بـ https://script.google.com/macros/'));
    }
    return fetch(cfg.appsScriptUrl)
      .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data){
        if (!Array.isArray(data.rows)) throw new Error('البيانات المُستلمة غير صالحة');
        buildSectionMap(data.groups || []);
        return normaliseRows(data.rows);
      });
  }

  return Promise.reject(new Error('لم يتم ضبط مصدر البيانات — افتح config.js'));
}

function isPageReload() {
  try {
    var entries = performance.getEntriesByType('navigation');
    if (entries.length > 0) return entries[0].type === 'reload';
    return performance.navigation && performance.navigation.type === 1;
  } catch(e) { return false; }
}

function cleanURL() {
  try {
    var url = new URL(window.location.href);
    ['ut_sem','ut_fac','ut_dept','ut_level','ut_spec','ut_group'].forEach(function(p){ url.searchParams.delete(p); });
    window.history.replaceState({}, '', url.toString());
  } catch(e) {}
}

function loadData() {
  showStatus('loading', '⏳ جاري تحميل بيانات الجداول...');
  fetchSheetData()
    .then(function(rows){
      allRows = rows.filter(function(r){
        return r[C.DAY] && r[C.SESSION] && !isNaN(Number(r[C.SESSION])) && Number(r[C.SESSION]) > 0;
      });
      if (allRows.length === 0) {
        showStatus('warning', '⚠️ لا توجد بيانات — تأكد من نشر الجداول أولاً');
        return;
      }
      showStatus('', '');
      populateSemesters();
      if (isPageReload()) {
        cleanURL();
      } else {
        restoreFromURL() || restoreLastSearch();
      }
    })
    .catch(function(e){ showStatus('error', '❌ ' + e.message); });
}

/* ── Cascading Dropdowns ────────────────────────────── */
function populateSemesters() {
  var sems = unique(allRows.map(function(r){ return r[C.SEM]; }));
  fillSelect('ut-sel-sem', sems, '— اختر السداسي —');
  if (sems.length === 1) {
    $('ut-sel-sem').value = sems[0];
    onSemChange();
  }
}

function onSemChange() {
  var sem = $('ut-sel-sem') ? $('ut-sel-sem').value : '';
  if (!sem) {
    ['ut-sel-faculty','ut-sel-dept','ut-sel-level','ut-sel-spec','ut-sel-group'].forEach(resetSelect);
    clearSchedule(); return;
  }
  var semRows = allRows.filter(function(r){ return r[C.SEM] === sem; });
  fillSelect('ut-sel-faculty', unique(semRows.map(function(r){ return r[C.FAC]; })), '— اختر الكلية —');
  ['ut-sel-dept','ut-sel-level','ut-sel-spec','ut-sel-group'].forEach(resetSelect);
  clearSchedule();
  var facs = unique(semRows.map(function(r){ return r[C.FAC]; }));
  if (facs.length === 1) { $('ut-sel-faculty').value = facs[0]; onFacultyChange(); }
}

function onFacultyChange() {
  var sem = $('ut-sel-sem').value, fac = $('ut-sel-faculty').value;
  if (!fac) { ['ut-sel-dept','ut-sel-level','ut-sel-spec','ut-sel-group'].forEach(resetSelect); clearSchedule(); return; }
  var base = allRows.filter(function(r){ return r[C.SEM]===sem && r[C.FAC]===fac; });
  fillSelect('ut-sel-dept', unique(base.map(function(r){ return r[C.DEPT]; })), '— اختر القسم —');
  ['ut-sel-level','ut-sel-spec','ut-sel-group'].forEach(resetSelect);
  clearSchedule();
  var depts = unique(base.map(function(r){ return r[C.DEPT]; }));
  if (depts.length === 1) { $('ut-sel-dept').value = depts[0]; onDeptChange(); }
}

function onDeptChange() {
  var sem=$('ut-sel-sem').value, fac=$('ut-sel-faculty').value, dept=$('ut-sel-dept').value;
  if (!dept) { ['ut-sel-level','ut-sel-spec','ut-sel-group'].forEach(resetSelect); clearSchedule(); return; }
  var base = allRows.filter(function(r){ return r[C.SEM]===sem && r[C.FAC]===fac && r[C.DEPT]===dept; });
  fillSelect('ut-sel-level', unique(base.map(function(r){ return r[C.LEVEL]; })), '— اختر المستوى —');
  ['ut-sel-spec','ut-sel-group'].forEach(resetSelect);
  clearSchedule();
  var lvls = unique(base.map(function(r){ return r[C.LEVEL]; }));
  if (lvls.length === 1) { $('ut-sel-level').value = lvls[0]; onLevelChange(); }
}

function onLevelChange() {
  var sem=$('ut-sel-sem').value, fac=$('ut-sel-faculty').value, dept=$('ut-sel-dept').value, level=$('ut-sel-level').value;
  if (!level) { ['ut-sel-spec','ut-sel-group'].forEach(resetSelect); clearSchedule(); return; }
  var base = allRows.filter(function(r){ return r[C.SEM]===sem && r[C.FAC]===fac && r[C.DEPT]===dept && r[C.LEVEL]===level; });
  fillSelect('ut-sel-spec', unique(base.map(function(r){ return r[C.SPEC]; })), '— اختر التخصص —');
  resetSelect('ut-sel-group');
  clearSchedule();
  var specs = unique(base.map(function(r){ return r[C.SPEC]; }));
  if (specs.length === 1) { $('ut-sel-spec').value = specs[0]; onSpecChange(); }
}

function onSpecChange() {
  var sem=$('ut-sel-sem').value, fac=$('ut-sel-faculty').value, dept=$('ut-sel-dept').value,
      level=$('ut-sel-level').value, spec=$('ut-sel-spec').value;
  if (!spec) { resetSelect('ut-sel-group'); clearSchedule(); return; }
  var base = allRows.filter(function(r){
    return r[C.SEM]===sem && r[C.FAC]===fac && r[C.DEPT]===dept && r[C.LEVEL]===level && r[C.SPEC]===spec;
  });
  var tdGroups = unique(base.filter(function(r){ return r[C.TYPE]!=='C'; }).map(function(r){ return r[C.GROUP]; }));
  fillSelect('ut-sel-group', tdGroups.length > 0 ? tdGroups : unique(base.map(function(r){ return r[C.GROUP]; })), '— اختر الفوج —');
  clearSchedule();
}

/* ── Quick Search ───────────────────────────────────── */
function onQuickSearch(query) {
  var box = $('ut-quick-results');
  if (!box) return;
  query = query.trim();
  if (query.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

  var lq = query.toLowerCase();
  var seen = {}, results = [];

  allRows.forEach(function(r) {
    var key = [r[C.SEM], r[C.FAC], r[C.DEPT], r[C.LEVEL], r[C.SPEC], r[C.GROUP]].join('|');
    if (seen[key]) return;
    var haystack = (r[C.SEM]+r[C.FAC]+r[C.DEPT]+r[C.LEVEL]+r[C.SPEC]+r[C.GROUP]+r[C.COURSE]).toLowerCase();
    if (haystack.indexOf(lq) !== -1) {
      seen[key] = true;
      results.push({ sem:r[C.SEM], fac:r[C.FAC], dept:r[C.DEPT], level:r[C.LEVEL], spec:r[C.SPEC], group:r[C.GROUP] });
    }
  });

  if (results.length === 0) {
    box.innerHTML = '<div class="ut-qr-empty">لا توجد نتائج</div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = results.slice(0, 10).map(function(res) {
    return '<div class="ut-qr-item"' +
      ' data-sem="'   + esc(res.sem)   + '"' +
      ' data-fac="'   + esc(res.fac)   + '"' +
      ' data-dept="'  + esc(res.dept)  + '"' +
      ' data-level="' + esc(res.level) + '"' +
      ' data-spec="'  + esc(res.spec)  + '"' +
      ' data-group="' + esc(res.group) + '">' +
      '<span class="ut-qr-group">' + esc(res.group) + '</span>' +
      '<span class="ut-qr-path">' + esc(res.sem) + ' · ' + esc(res.level) + ' · ' + esc(res.spec) + ' · ' + esc(res.dept) + '</span>' +
      '</div>';
  }).join('');
  box.style.display = 'block';
}

function selectQuickResult(el) {
  var sems = unique(allRows.map(function(r){ return r[C.SEM]; }));
  fillSelect('ut-sel-sem', sems, '— اختر السداسي —');
  $('ut-sel-sem').value   = el.dataset.sem;   onSemChange();
  $('ut-sel-faculty').value = el.dataset.fac; onFacultyChange();
  $('ut-sel-dept').value  = el.dataset.dept;  onDeptChange();
  $('ut-sel-level').value = el.dataset.level; onLevelChange();
  $('ut-sel-spec').value  = el.dataset.spec;  onSpecChange();
  $('ut-sel-group').value = el.dataset.group;

  $('ut-quick-results').style.display = 'none';
  $('ut-quick-search').value = '';
  doSearch();
}

/* ── Search ─────────────────────────────────────────── */
function doSearch() {
  var sem=$('ut-sel-sem').value,     fac=$('ut-sel-faculty').value,
      dept=$('ut-sel-dept').value,   level=$('ut-sel-level').value,
      spec=$('ut-sel-spec').value,   group=$('ut-sel-group').value;

  if (!sem||!fac||!dept||!level||!spec||!group) { showStatus('warning','⚠️ يرجى اختيار جميع الحقول'); return; }

  var parentGroup = findParentGroup(fac, dept, level, spec, group);

  var rows = allRows.filter(function(r){
    if (r[C.SEM]!==sem || r[C.FAC]!==fac || r[C.DEPT]!==dept || r[C.LEVEL]!==level || r[C.SPEC]!==spec) return false;
    if (r[C.TYPE]==='C') return true;
    if (r[C.GROUP]===group) return true;
    if (parentGroup && r[C.GROUP]===parentGroup) return true;
    return false;
  });

  if (rows.length === 0) { showStatus('warning','⚠️ لا توجد حصص لهذا الفوج'); clearSchedule(); return; }

  var timesMap = {};
  rows.forEach(function(r){
    var s = Number(r[C.SESSION]);
    var t = (r[C.TIME] || '').trim();
    if (s && t && !timesMap[s]) timesMap[s] = t;
  });

  var sessionNums = {};
  rows.forEach(function(r){ var s=Number(r[C.SESSION]); if(s) sessionNums[s]=true; });
  var sessions = Object.keys(sessionNums).map(Number).sort(function(a,b){ return a-b; });

  var matrix = {};
  rows.forEach(function(r){
    var day=r[C.DAY], session=Number(r[C.SESSION]);
    if (!day||!session||isNaN(session)) return;
    if (!matrix[day]) matrix[day] = {};
    if (!matrix[day][session] || r[C.TYPE]!=='C')
      matrix[day][session] = { course:r[C.COURSE]||'', type:r[C.TYPE]||'', teacher:r[C.TEACHER]||'', room:r[C.ROOM]||'', group:r[C.GROUP]||'' };
  });

  var total = DAYS.reduce(function(n,d){
    return n + sessions.filter(function(s){ return matrix[d]&&matrix[d][s]; }).length;
  }, 0);

  currentMatrix   = matrix;
  currentInfo     = { sem:sem, fac:fac, dept:dept, level:level, spec:spec, group:group };
  currentSessions = sessions;
  currentTimesMap = timesMap;

  renderSchedule(matrix, currentInfo, total, sessions, timesMap);
  showStatus('success','✅ ' + total + ' حصة / أسبوع');

  saveLastSearch();
  updateURL();

  var sc = $('ut-schedule-container');
  if (sc) sc.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ── localStorage ───────────────────────────────────── */
function saveLastSearch() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sem:   $('ut-sel-sem').value,
      fac:   $('ut-sel-faculty').value,
      dept:  $('ut-sel-dept').value,
      level: $('ut-sel-level').value,
      spec:  $('ut-sel-spec').value,
      group: $('ut-sel-group').value
    }));
  } catch(e) {}
}

function restoreLastSearch() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || !saved.sem || !saved.fac) return false;
    applySelections(saved);
    return true;
  } catch(e) { return false; }
}

function applySelections(s) {
  var sems = unique(allRows.map(function(r){ return r[C.SEM]; }));
  fillSelect('ut-sel-sem', sems, '— اختر السداسي —');
  var semEl = $('ut-sel-sem');
  if (!semEl) return;
  semEl.value = s.sem;              onSemChange();
  $('ut-sel-faculty').value = s.fac;  onFacultyChange();
  $('ut-sel-dept').value    = s.dept; onDeptChange();
  $('ut-sel-level').value   = s.level; onLevelChange();
  $('ut-sel-spec').value    = s.spec;  onSpecChange();
  $('ut-sel-group').value   = s.group;
  if (s.sem && s.fac && s.dept && s.level && s.spec && s.group) doSearch();
}

/* ── URL Share ──────────────────────────────────────── */
function updateURL() {
  try {
    var url = new URL(window.location.href);
    url.searchParams.set('ut_sem',   $('ut-sel-sem').value);
    url.searchParams.set('ut_fac',   $('ut-sel-faculty').value);
    url.searchParams.set('ut_dept',  $('ut-sel-dept').value);
    url.searchParams.set('ut_level', $('ut-sel-level').value);
    url.searchParams.set('ut_spec',  $('ut-sel-spec').value);
    url.searchParams.set('ut_group', $('ut-sel-group').value);
    window.history.replaceState({}, '', url.toString());
  } catch(e) {}
}

function restoreFromURL() {
  try {
    var p = new URLSearchParams(window.location.search);
    var MAX = 100;
    var s = {
      sem:   (p.get('ut_sem')   || '').slice(0, MAX),
      fac:   (p.get('ut_fac')   || '').slice(0, MAX),
      dept:  (p.get('ut_dept')  || '').slice(0, MAX),
      level: (p.get('ut_level') || '').slice(0, MAX),
      spec:  (p.get('ut_spec')  || '').slice(0, MAX),
      group: (p.get('ut_group') || '').slice(0, MAX)
    };
    if (!s.sem || !s.fac || !s.group) return false;
    applySelections(s);
    return true;
  } catch(e) { return false; }
}

function doShare() {
  try {
    navigator.clipboard.writeText(window.location.href).then(function() {
      var toast = $('ut-share-toast');
      if (!toast) return;
      toast.style.display = 'block';
      toast.classList.add('ut-toast-show');
      setTimeout(function(){
        toast.classList.remove('ut-toast-show');
        setTimeout(function(){ toast.style.display='none'; }, 400);
      }, 2500);
    });
  } catch(e) {}
}

/* ── Render Schedule ────────────────────────────────── */
function renderSchedule(matrix, info, totalSessions, sessions, timesMap) {
  var headerCols = sessions.map(function(s){
    var time = timesMap[s] || '';
    return '<th class="ut-sess-hd">' +
      '<div class="ut-sess-num">H' + s + '</div>' +
      (time ? '<div class="ut-sess-time">' + esc(time) + '</div>' : '') +
      '</th>';
  }).join('');

  var tableRows = DAYS.map(function(day){
    var cells = sessions.map(function(s){
      var cell = matrix[day] && matrix[day][s];
      if (!cell) return '<td class="ut-cell-empty"></td>';
      var badge = cell.type==='C' ? 'ut-badge-C' : cell.type==='TD' ? 'ut-badge-TD' : 'ut-badge-X';
      return '<td class="ut-cell-filled"><div class="ut-cell-inner">' +
        '<div class="ut-cell-course">' + esc(cell.course||'—') + '</div>' +
        (cell.type    ? '<span class="ut-cell-badge ' + badge + '">' + esc(cell.type) + '</span>' : '') +
        (cell.teacher ? '<div class="ut-cell-teacher">' + esc(cell.teacher) + '</div>' : '') +
        (cell.room    ? '<div class="ut-cell-room">🏛 ' + esc(cell.room) + '</div>' : '') +
        '</div></td>';
    }).join('');
    return '<tr><td class="ut-day-cell">' + esc(day) + '</td>' + cells + '</tr>';
  }).join('');

  var cfg = UT_CONFIG || {};
  var infoItems = [];
  if (cfg.universityName) infoItems.push('🏫 ' + esc(cfg.universityName));
  if (cfg.year)           infoItems.push('📅 ' + esc(cfg.year));
  if (info.sem)           infoItems.push('السداسي: ' + esc(info.sem));
  var infoBar = infoItems.length
    ? '<div class="ut-sch-info-bar">' + infoItems.join(' &nbsp;|&nbsp; ') + '</div>'
    : '';

  var logoTag = cfg.logoUrl
    ? '<img src="' + esc(cfg.logoUrl) + '" class="ut-sch-logo" alt="شعار الجامعة" onerror="this.style.display=\'none\'">'
    : '';

  var sc = $('ut-schedule-container');
  sc.innerHTML =
    '<div class="ut-schedule-wrapper">' +
      '<div class="ut-sch-header-bar">' +
        logoTag +
        '<div style="flex:1">' +
          '<div class="ut-sch-label">👥 جدول التوقيت الأسبوعي للأفواج</div>' +
          '<div class="ut-sch-entity">' + esc(info.level) + ' &nbsp;•&nbsp; ' + esc(info.spec) + ' &nbsp;•&nbsp; ' + esc(info.group) + '</div>' +
          '<div class="ut-sch-meta">' + esc(info.fac) + ' — ' + esc(info.dept) + '</div>' +
        '</div>' +
        '<div class="ut-sch-sessions">' + totalSessions + ' حصة / أسبوع</div>' +
      '</div>' +
      infoBar +
      '<div class="ut-grid-scroll">' +
        '<table class="ut-schedule-table">' +
          '<colgroup><col style="width:80px">' + sessions.map(function(){ return '<col>'; }).join('') + '</colgroup>' +
          '<thead><tr><th class="ut-day-hd">اليوم</th>' + headerCols + '</tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  sc.style.display = 'block';
  $('ut-action-buttons').style.display = 'flex';
}

/* ── Logo loader (مشترك بين الطباعة و PDF) ─────────── */
function tryImgCanvas(url, cb) {
  var img = new Image();
  img.onload = function() {
    try {
      var c = document.createElement('canvas');
      c.width  = img.naturalWidth  || 64;
      c.height = img.naturalHeight || 64;
      c.getContext('2d').drawImage(img, 0, 0);
      cb(c.toDataURL());
    } catch(e) { cb(''); }
  };
  img.onerror = function() { cb(''); };
  img.src = url;
}

function loadLogo(url, cb) {
  fetch(url)
    .then(function(r) { return r.ok ? r.blob() : Promise.reject(); })
    .then(function(blob) {
      var fr = new FileReader();
      fr.onload  = function(e) { cb(e.target.result); };
      fr.onerror = function()  { tryImgCanvas(url, cb); };
      fr.readAsDataURL(blob);
    })
    .catch(function() { tryImgCanvas(url, cb); });
}

function getLogoUrl() {
  var cfg = UT_CONFIG || {};
  if (!cfg.logoUrl) return '';
  try { return new URL(cfg.logoUrl, window.location.href).href; } catch(e) { return ''; }
}

/* ── Print / PDF ────────────────────────────────────── */
function doPrint() {
  if (!currentMatrix || !currentInfo) return;

  function openWindow(logoDataUrl) {
    var w = window.open('', '_blank');
    if (!w || w.closed) {
      showStatus('error', '❌ المتصفح حجب النافذة — اسمح بالنوافذ المنبثقة لهذا الموقع');
      return;
    }
    w.document.write(buildPrintHTML(currentMatrix, currentInfo, currentSessions, currentTimesMap, logoDataUrl));
    w.document.close();
    w.focus();
    setTimeout(function(){ w.print(); }, 800);
  }

  var absLogoUrl = getLogoUrl();
  if (absLogoUrl) {
    loadLogo(absLogoUrl, function(logoDataUrl) { openWindow(logoDataUrl); });
  } else {
    openWindow('');
  }
}

function doPDF() {
  if (!currentMatrix || !currentInfo) return;
  showStatus('loading', '⏳ جاري إنشاء ملف PDF...');

  function renderPDF(logoDataUrl) {
    var numSessions = currentSessions.length || 6;
    var iframeW = Math.max(1090, 65 + numSessions * 158 + 30);
    var iframeH = Math.round(iframeW * 210 / 297); // نسبة A4 landscape

    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:' + iframeW + 'px;height:' + iframeH + 'px;border:none;visibility:hidden';
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(buildPrintHTML(currentMatrix, currentInfo, currentSessions, currentTimesMap, logoDataUrl));
    iframe.contentDocument.close();

    setTimeout(function() {
      html2canvas(iframe.contentDocument.body, {
        scale: 2,
        useCORS: false,
        allowTaint: false,
        backgroundColor: '#ffffff',
        windowWidth: iframeW,
        windowHeight: iframeH,
        logging: false
      }).then(function(canvas) {
        document.body.removeChild(iframe);
        var jsPDF  = window.jspdf.jsPDF;
        var pdf    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        var margin = 5;
        var pageW  = pdf.internal.pageSize.getWidth()  - margin * 2;
        var pageH  = pdf.internal.pageSize.getHeight() - margin * 2;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, pageW, pageH);
        var filename = [currentInfo.sem, currentInfo.level, currentInfo.spec, currentInfo.group]
                         .filter(Boolean).join('-') + '.pdf';
        pdf.save(filename);
        showStatus('success', '✅ تم تحميل الجدول بصيغة PDF');
      }).catch(function(err) {
        document.body.removeChild(iframe);
        showStatus('error', '❌ فشل إنشاء الملف: ' + (err && err.message ? err.message : 'حاول مرة أخرى'));
      });
    }, 1200);
  }

  var absLogoUrl = getLogoUrl();
  if (absLogoUrl) {
    loadLogo(absLogoUrl, function(logoDataUrl) { renderPDF(logoDataUrl); });
  } else {
    renderPDF('');
  }
}

function buildPrintHTML(matrix, info, sessions, timesMap, logoOverride) {
  var cfg = UT_CONFIG || {};

  // logoOverride === undefined  → طباعة: رابط مطلق، المتصفح يحمّله
  // logoOverride === ''         → PDF بدون شعار (fetch فشل)
  // logoOverride === 'data:...' → PDF مع شعار base64
  var logoSrc;
  if (logoOverride === undefined) {
    logoSrc = cfg.logoUrl || '';
    if (logoSrc) {
      try { logoSrc = new URL(logoSrc, window.location.href).href; } catch(e) {}
    }
  } else {
    logoSrc = logoOverride;
  }

  var STYLE = [
    '@page{size:A4 landscape;margin:8mm 10mm}','*{margin:0;padding:0;box-sizing:border-box}',
    'body{font-family:"Segoe UI",Tahoma,"Arial Unicode MS",Arial,sans-serif;direction:rtl;color:#000;background:#fff;font-size:11px}',
    '.gov{text-align:center;margin-bottom:4px}','.gl1{font-size:11px;font-weight:700}','.gl2{font-size:10px;color:#333}',
    '.logo-row{display:flex;align-items:center;padding:4px 0 6px;border-bottom:3px double #000;margin-bottom:5px}',
    '.uc{flex:1;text-align:center;padding:0 8px}','.un{font-size:13px;font-weight:800;margin-bottom:3px}',
    '.us{font-size:10px;color:#222;line-height:1.7}',
    '.tb{text-align:center;margin:4px 0 2px;font-size:11px;font-weight:700;text-decoration:underline}',
    '.ib{text-align:center;font-size:9.5px;color:#333;margin-bottom:4px}',
    '.eb{text-align:center;border:2px solid #000;padding:4px 16px;margin:3px 0 5px;font-size:15px;font-weight:800;background:#f0f0f0}',
    'table{width:100%;border-collapse:collapse;table-layout:fixed}',
    'th.d{background:#1a2744;color:#fff;border:1px solid #000;width:58px;padding:5px 2px;font-size:9.5px;font-weight:700;text-align:center}',
    'th.h{background:#2c3e6e;color:#fff;border:1px solid #000;padding:4px 2px;font-size:8px;font-weight:700;text-align:center;line-height:1.6}',
    'td{border:1px solid #555;vertical-align:middle;text-align:center;padding:3px 4px;height:75px;background:#fff}',
    'td.e{background:#f8f8f8}','.cn{font-size:9.5px;font-weight:700;line-height:1.2;margin-bottom:1px}',
    '.cb{display:inline-block;font-size:7.5px;font-weight:700;padding:0 5px;border-radius:2px;border:1px solid;margin-bottom:1px}',
    '.bC{background:#d6eaf8;color:#154360;border-color:#154360}','.bTD{background:#d5f5e3;color:#145a32;border-color:#145a32}',
    '.ct{font-size:8px;color:#111;display:block;line-height:1.3}','.cr{font-size:7.5px;color:#555}',
    '.ft{margin-top:5px;text-align:center;font-size:8px;color:#555;border-top:1px solid #999;padding-top:3px}'
  ].join('');

  var autoScale = '<script>(function(){function fit(){var b=document.body;var pw=1084,ph=748;var sw=b.scrollWidth,sh=b.scrollHeight;if(sw>1&&sh>1&&(sw>pw||sh>ph)){var sc=Math.min(pw/sw,ph/sh);b.style.zoom=sc;}}if(document.readyState==="loading"){window.addEventListener("DOMContentLoaded",fit);}else{fit();}})();<\/script>';

  var date = new Date().toLocaleDateString('ar-DZ');

  var hCols = sessions.map(function(s){
    var time = timesMap[s] || '';
    return '<th class="h"><div style="font-size:9px;font-weight:800">H' + s + '</div>' + (time ? '<div>' + esc(time) + '</div>' : '') + '</th>';
  }).join('');

  var bodyRows = DAYS.map(function(day){
    var cells = sessions.map(function(s){
      var cell = matrix[day] && matrix[day][s];
      if (!cell || (!cell.course && !cell.teacher)) return '<td class="e"></td>';
      var bc = cell.type==='C' ? ' bC' : cell.type==='TD' ? ' bTD' : '';
      return '<td>' +
        '<div class="cn">' + esc(cell.course||'—') + '</div>' +
        (cell.type    ? '<span class="cb' + bc + '">' + esc(cell.type) + '</span>' : '') +
        (cell.teacher ? '<span class="ct">' + esc(cell.teacher) + '</span>' : '') +
        (cell.room    ? '<div class="cr">' + esc(cell.room) + '</div>' : '') +
        '</td>';
    }).join('');
    return '<tr><th class="d">' + esc(day) + '</th>' + cells + '</tr>';
  }).join('');

  var logoImg = logoSrc
    ? '<img src="' + esc(logoSrc) + '" style="width:64px;height:64px;object-fit:contain;border-radius:50%" onerror="this.style.visibility=\'hidden\'">'
    : '<div style="width:64px;height:64px"></div>';

  var univHtml = cfg.universityName ? '<div class="un">' + esc(cfg.universityName) + '</div>' : '';
  var facHtml  = info.fac  ? '<div class="us">' + esc(info.fac)  + '</div>' : '';
  var deptHtml = info.dept ? '<div class="us">' + esc(info.dept) + '</div>' : '';

  var yearSemParts = [];
  if (cfg.year) yearSemParts.push('السنة الجامعية: ' + esc(cfg.year));
  if (info.sem) yearSemParts.push('السداسي: ' + esc(info.sem));
  var yearSemHtml = yearSemParts.length ? '<div class="ib">' + yearSemParts.join(' &nbsp;|&nbsp; ') + '</div>' : '';

  return '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><style>' + STYLE + '</style>' + autoScale + '</head><body>' +
    '<div class="gov"><div class="gl1">الجمهورية الجزائرية الديمقراطية الشعبية</div><div class="gl2">وزارة التعليم العالي والبحث العلمي</div></div>' +
    '<div class="logo-row">' +
      '<div style="width:64px;height:64px;flex-shrink:0;display:flex;align-items:center;justify-content:center">' + logoImg + '</div>' +
      '<div class="uc">' + univHtml + facHtml + deptHtml + '</div>' +
      '<div style="width:64px;height:64px;flex-shrink:0;display:flex;align-items:center;justify-content:center">' + logoImg + '</div>' +
    '</div>' +
    '<div class="tb">جدول التوقيت الأسبوعي للأفواج</div>' + yearSemHtml +
    '<div class="eb">' + esc(info.level) + ' &nbsp;•&nbsp; ' + esc(info.spec) + ' &nbsp;•&nbsp; ' + esc(info.group) + '</div>' +
    '<table><thead><tr><th class="d">اليوم</th>' + hCols + '</tr></thead><tbody>' + bodyRows + '</tbody></table>' +
    '<div class="ft">تم استخراج هذا الجدول بتاريخ: ' + date + '</div>' +
    '</body></html>';
}

/* ── Init ───────────────────────────────────────────── */
function init() {
  if (!$('ut-sel-sem')) return;

  $('ut-sel-sem').addEventListener('change',     onSemChange);
  $('ut-sel-faculty').addEventListener('change', onFacultyChange);
  $('ut-sel-dept').addEventListener('change',    onDeptChange);
  $('ut-sel-level').addEventListener('change',   onLevelChange);
  $('ut-sel-spec').addEventListener('change',    onSpecChange);
  $('ut-btn-search').addEventListener('click',   doSearch);
  $('ut-btn-print').addEventListener('click',    doPrint);
  $('ut-btn-pdf').addEventListener('click',      doPDF);
  $('ut-btn-share').addEventListener('click',    doShare);

  var qs = $('ut-quick-search');
  if (qs) {
    qs.addEventListener('input', function(){ onQuickSearch(this.value); });
    qs.addEventListener('keydown', function(e){ if (e.key==='Escape') { $('ut-quick-results').style.display='none'; } });
    document.addEventListener('click', function(e){
      var box = $('ut-quick-results');
      if (!box) return;
      var item = e.target.closest('.ut-qr-item');
      if (item) { selectQuickResult(item); return; }
      if (!e.target.closest('#ut-quick-search')) box.style.display = 'none';
    });
  }

  applyFullWidth();
  window.addEventListener('resize', applyFullWidth);
  loadData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();

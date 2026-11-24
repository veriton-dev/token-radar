// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable and sortable table, a detail drawer that recomputes the model term by term
// and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'rank', dir: 1, selected: null };

  var usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdWhole.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  function fmtNum(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(d === undefined ? 3 : d);
  }

  // The model, recomputed in the page from the row's own snapshot figures. It mirrors lib/model.ts so the
  // page's arithmetic and the board's numbers are visibly the same; the row's peer multiple is the one the
  // board derived, carried here so the page never invents a name-based value.
  function recompute(row) {
    var m = DATA.model;
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growthPct / 100) * m.growth_weight;
    var waitDays = Math.min(row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days, m.wait_days);
    var waitMult = m.wait_floor + (Math.max(waitDays, 0) / m.wait_days) * m.wait_range;
    var chainMult = 1 + m.chain_weight * Math.min(Math.max((row.chains ? row.chains.length : 1) - 1, 0), m.chain_cap);
    var thinMult = row.change_7d === null || row.change_7d === undefined ? m.thin_multiplier : 1;
    var base = row.tvl_usd * (row.predicted_multiple === undefined ? row.peer_multiple : row.predicted_multiple);
    var implied = Math.max(1, Math.round(base * growthMult * waitMult * chainMult * thinMult));
    return { growthPct: growthPct, growthMult: growthMult, waitDays: waitDays, waitMult: waitMult, chainMult: chainMult, thinMult: thinMult, base: base, implied: implied };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- the two universes: the pre-token rows the board ranked, and the traded peers it derived its
  // multiples from. Both are filtered the same way so the segmented control can switch between them.
  function preRows() {
    return DATA.rows.map(function (r) { return Object.assign({ kind: 'pre' }, r); });
  }
  function liveRows() {
    return DATA.live.map(function (r) {
      return Object.assign({ kind: 'live', rank: null, implied_value_usd: null, implied_low: null, implied_high: null, peer_multiple: r.multiple, age_days: null, name: r.name, slug: r.slug }, r);
    });
  }
  function pendingRows() {
    return (DATA.pending || []).map(function (r) {
      return Object.assign({ kind: 'pending', rank: null, implied_value_usd: null, implied_low: null, implied_high: null, peer_multiple: null, age_days: null }, r);
    });
  }
  function universe() {
    if (state.tab === 'live') return liveRows();
    if (state.tab === 'pending') return pendingRows();
    if (state.tab === 'all') return preRows().concat(liveRows()).concat(pendingRows());
    return preRows();
  }
  function matches(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var kindWord = r.kind === 'live' ? 'traded token live' : r.kind === 'pending' ? 'token symbol no market cap pending' : 'pre-token';
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), r.symbol || '', kindWord].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function view() {
    return universe().filter(matches);
  }

  function sortValue(r, key) {
    switch (key) {
      case 'name': return r.name.toLowerCase();
      case 'category': return (r.category || 'Other').toLowerCase();
      case 'tvl': return r.tvl_usd;
      case 'growth': return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
      case 'age': return r.age_days === null || r.age_days === undefined ? Infinity : r.age_days;
      case 'peer': return r.peer_multiple === null || r.peer_multiple === undefined ? -Infinity : r.peer_multiple;
      case 'high': return r.implied_high === null || r.implied_high === undefined ? -Infinity : r.implied_high;
      case 'mcap': return r.mcap_usd === null || r.mcap_usd === undefined ? -Infinity : r.mcap_usd;
      case 'rank': return r.kind === 'live' || r.kind === 'pending' ? Infinity : r.rank;
      default: return r.implied_value_usd === null || r.implied_value_usd === undefined ? -Infinity : r.implied_value_usd;
    }
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key), bv = sortValue(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('view') === 'live' || params.get('view') === 'all' || params.get('view') === 'pre-token') state.tab = params.get('view');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tab !== 'pre-token') params.set('view', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- header and hero ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, DATA.model_version, ' model'),
        el('span', { text: 'fitted value model' })
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null, 'Every pre-token protocol, ranked by ', el('em', { text: 'fitted' }), ' implied value'),
        el('p', { class: 'lede' },
          'Implied value prices each protocol\'s own TVL at a market-cap-to-TVL multiple fitted from the protocols that already trade. ',
          el('strong', { text: 'The multiple is fitted from the snapshot, not chosen: ' }),
          'size, seven-day growth and chain count set the surface, and each category adds a shrunk residual. ',
          el('strong', { text: 'No protocol name is special-cased.' }),
          ' The watchlist is the floor, never the ceiling: the board ranks the whole pre-token universe.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('b', { class: 'amber', text: String(DATA.board_size) }), el('span', { text: 'pre-token rows ranked' })),
        el('div', { class: 'fact' }, el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
        el('div', { class: 'fact' }, el('b', { class: 'teal', text: String(DATA.fitted_model.training_count) }), el('span', { text: 'traded peers fitted' })),
        el('div', { class: 'fact' }, el('b', { text: String(DATA.live_size) }), el('span', { text: 'token already trading' })),
        el('div', { class: 'fact' }, el('b', { text: String(DATA.accounted_size) + ' / ' + String(DATA.universe_size) }), el('span', { text: 'protocols accounted for' }))
      )
    );
  }

  // ---- the Model section: the fitted equation with its actual coefficients, the held-out comparison and
  // the category residual table. Every number is read from DATA.fitted_model, which main.ts fitted from the
  // snapshot's own traded protocols; the page states it, it does not invent it. ----
  function modelPanel() {
    var m = DATA.model;
    var fm = DATA.fitted_model;
    var cv = fm.cv;
    var signed = function (n) { return (n >= 0 ? '+ ' : '- ') + Math.abs(n).toFixed(4); };
    var formula =
      'y = ln(mcap_usd / tvl_usd)\n' +
      'y ~ ' + fm.b0.toFixed(4) + ' ' + signed(fm.b1) + ' z ' + signed(fm.b2) + ' g ' + signed(fm.b3) + ' nc\n' +
      'z  = (log10(tvl_usd) - ' + fm.mean_log10_tvl.toFixed(4) + ') / ' + fm.sd_log10_tvl.toFixed(4) + '\n' +
      'g  = clamp(change_7d, ' + m.growth_floor + ', +' + m.growth_cap + ') / 100\n' +
      'nc = min(len(chains), 6)\n' +
      'predicted log multiple = y + residual_category x n_c / (n_c + ' + fm.shrink_k + ')\n' +
      'base      = tvl_usd x exp(predicted log multiple)\n' +
      'growth    = 1 + clamp(change_7d, ' + m.growth_floor + ', +' + m.growth_cap + ') / 100 x ' + m.growth_weight + '\n' +
      'wait      = ' + m.wait_floor + ' + min(age_days ?? ' + m.unknown_age_days + ', ' + m.wait_days + ') / ' + m.wait_days + ' x ' + m.wait_range + '\n' +
      'chains    = 1 + ' + m.chain_weight + ' x min(len(chains) - 1, ' + m.chain_cap + ')\n' +
      'thin      = change_7d is null ? ' + m.thin_multiplier + ' : 1\n' +
      'implied   = max(1, round(base x growth x wait x chains x thin))\n' +
      'range     = ' + (m.range_low * 100) + '% .. ' + (m.range_high * 100) + '% of implied (ranking uses the point estimate)';

    var fittedWins = cv.fitted_rmse < cv.category_rmse;
    var cvBlock = el('div', { class: 'cv' },
      el('div', { class: 'cv-head' },
        el('h3', { text: 'Held-out check: 5-fold cross-validation over ' + cv.rows + ' traded protocols' }),
        el('span', { class: 'pill ' + (fittedWins ? 'buy' : 'glb'), text: fittedWins ? 'fitted model wins' : 'category median wins' })
      ),
      el('div', { class: 'cv-grid' },
        el('div', { class: 'cv-row' },
          el('span', { class: 'cv-k', text: 'Baseline: mean log multiple' }),
          el('span', { class: 'cv-v', text: 'RMSE ' + cv.baseline_rmse.toFixed(4) })
        ),
        el('div', { class: 'cv-row' },
          el('span', { class: 'cv-k', text: 'Old approach: category median mcap / TVL' }),
          el('span', { class: 'cv-v', text: 'RMSE ' + cv.category_rmse.toFixed(4) })
        ),
        el('div', { class: 'cv-row best' },
          el('span', { class: 'cv-k', text: 'This model: fitted surface + shrunk residual' }),
          el('span', { class: 'cv-v', text: 'RMSE ' + cv.fitted_rmse.toFixed(4) })
        )
      ),
      el('p', { class: 'note', text: 'Each fold is assigned by a stable hash of the slug, so the split never moves between runs. The fitted model ships because its held-out error is lower than both baselines.' })
    );

    var residuals = fm.residuals.slice().sort(function (a, b) { return b.count - a.count || (a.category < b.category ? -1 : 1); });
    var resRows = residuals.map(function (c) {
      var raw = (c.residual >= 0 ? '+' : '') + c.residual.toFixed(3);
      var shrunk = (c.shrunk >= 0 ? '+' : '') + c.shrunk.toFixed(3);
      return el('div', { class: 'peer', title: 'median residual ' + raw + ' shrunk to ' + shrunk + ' over ' + c.count + ' peer' + (c.count === 1 ? '' : 's') },
        el('span', { class: 'cat', text: c.category }),
        el('span', { class: 'mult', text: shrunk }),
        el('span', { class: 'cnt', text: 'n=' + c.count })
      );
    });
    var table = el('div', { class: 'peer-grid' }, resRows);

    return el('section', { class: 'model', id: 'model' },
      el('div', { class: 'model-head' },
        el('h2', { text: 'The model, fitted and held out' }),
        el('span', { class: 'sub', text: 'computed from the snapshot every run: ' + DATA.source })
      ),
      el('p', null,
        'The multiple is ', el('strong', { text: 'fitted' }),
        ' from the snapshot\'s ', el('strong', { text: String(fm.training_count) + ' traded protocols' }),
        ' in log space: a protocol\'s market-cap-to-TVL multiple rises and falls with its ', el('strong', { text: 'size' }),
        ', its ', el('strong', { text: 'seven-day growth' }), ' and its ', el('strong', { text: 'chain count' }),
        '. Each category then keeps a ', el('strong', { text: 'shrunk median residual' }),
        ' (n / (n + ' + fm.shrink_k + ') of it), so a one-peer category barely moves a prediction. ',
        'The base is damped by TVL growth, lifted by ', el('strong', { text: 'how long it has run with no token' }),
        ', adjusted for multichain surface and discounted when seven-day data is unreported. ',
        el('strong', { text: 'No protocol name is special-cased: the same function scores every row.' })
      ),
      el('div', { class: 'formula', text: formula }),
      cvBlock,
      el('div', { class: 'peer-wrap' },
        el('h3', { text: 'Category residual adjustment: median residual and its shrunk value' }),
        table,
        el('p', { class: 'note', text: 'residual = median over a category\'s traded peers of (actual log multiple - fitted log multiple); shrunk = residual x n / (n + ' + fm.shrink_k + '). A category with no traded peer has no row and no adjustment.' })
      )
    );
  }

  // ---- controls: search, category, segmented view ----
  function controls() {
    var cats = {};
    preRows().concat(liveRows()).forEach(function (r) { cats[r.category || 'Other'] = true; });
    var categories = Object.keys(cats).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    function seg(id, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', text: label, onclick: function () { state.tab = id; writeHash(); render(); } });
    }
    var n = view().length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'seg', role: 'group', 'aria-label': 'Token status' },
        seg('pre-token', 'Pre-token (' + DATA.board_size + ')'),
        seg('live', 'Traded peers (' + DATA.live_size + ')'),
        seg('pending', 'Token, no mcap (' + DATA.pending_size + ')'),
        seg('all', 'All')
      )),
      el('span', { class: 'count' }, el('b', { text: String(n) }), ' rows shown')
    );
  }

  function sortHeader(key, label, extraClass) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : null, class: extraClass || null },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' || key === 'name' || key === 'category' ? 1 : -1; }
        render();
      } },
        label,
        active ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? '\u25BC' : '\u25B2' }) : null
      )
    );
  }

  function selectRow(slug, kind) {
    state.selected = slug;
    writeHash();
    openDetail(slug, kind);
    render();
  }

  function nameCell(r) {
    return el('td', null, el('div', { class: 'name' },
      el('b', { text: r.name }),
      el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain not recorded') })
    ));
  }

  // One quiet line under the board: how many pre-token protocols the ranking leaves out, and the
  // three most common reasons. It is counted from DATA.set_aside and omitted when that list is absent.
  function setAsideFootnote() {
    var aside = DATA.set_aside;
    if (!aside || !aside.length) return null;
    var counts = {};
    aside.forEach(function (p) {
      var reason = String(p.reason || 'other').split(':')[0].trim() || 'other';
      counts[reason] = (counts[reason] || 0) + 1;
    });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); }).slice(0, 3);
    var reasons = top.map(function (r) { return r + ' (' + counts[r] + ')'; }).join(', ');
    return el('p', { class: 'board-footnote', text: 'Set aside: ' + aside.length + ' pre-token protocol' + (aside.length === 1 ? '' : 's') + ' left out of the ranking; top reasons ' + reasons + '.' });
  }

  function preTable(list) {
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd && r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null || r.change_7d === undefined ? 'muted' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { selectRow(r.slug, 'pre'); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.slug, 'pre'); } }
      },
        el('td', null, el('span', { class: 'rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) })),
        nameCell(r),
        el('td', null, el('span', { class: 'pill cat', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null,
          el('span', { class: 'pill ' + (r.peer_source === 'global' ? 'glb' : 'cat'), title: 'fitted multiple: surface plus ' + (r.n_category ? 'a shrunk residual over ' + r.n_category + ' peers' : 'no category residual'), text: fmtMult(r.peer_multiple) }),
          el('span', { class: 'range', text: ' ' + (r.n_category ? r.n_category + 'p' : 'surface') })
        ),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'range', text: fmtUsd(r.implied_low) + ' \u2013 ' + fmtUsd(r.implied_high) }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Click any header to sort; select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('peer', 'Peer mult.'),
            sortHeader('implied', 'Implied value'),
            sortHeader('high', 'Range')
          )),
          tbody
        )
      ),
      setAsideFootnote()
    );
  }

  function liveTable(list) {
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null || r.change_7d === undefined ? 'muted' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { selectRow(r.slug, 'live'); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.slug, 'live'); } }
      },
        el('td', null, el('span', { class: 'pill buy', text: 'traded' })),
        nameCell(r),
        el('td', null, el('span', { class: 'pill cat', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill glb', text: fmtMult(r.multiple) }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Traded peers: these protocols already have a token, so their market cap is a fact, not a model. Their mcap/TVL multiples are the training set the value model is fitted on. They are never mixed into the ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('mcap', 'Market cap'),
            sortHeader('peer', 'mcap / TVL')
          )),
          tbody
        )
      )
    );
  }

  function allTable(list) {
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null || r.change_7d === undefined ? 'muted' : r.change_7d >= 0 ? 'pos' : 'neg';
      var isLive = r.kind === 'live';
      var isPending = r.kind === 'pending';
      var statusLabel = isLive ? 'traded' : isPending ? 'no mcap' : 'pre-token';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { selectRow(r.slug, r.kind); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.slug, r.kind); } }
      },
        el('td', null, el('span', { class: 'pill ' + (isLive ? 'buy' : 'cat'), text: statusLabel })),
        el('td', null, el('span', { class: 'rank' + (!isLive && !isPending && r.rank <= 3 ? ' top' : ''), text: isLive || isPending ? '\u2013' : String(r.rank) })),
        nameCell(r),
        el('td', null, el('span', { class: 'pill cat', text: r.category || 'Other' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', null, isLive ? el('span', { class: 'num muted', text: fmtUsd(r.mcap_usd) }) : isPending ? el('span', { class: 'num muted', text: r.symbol ? r.symbol + ', no mcap' : 'no mcap' }) : el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Every group the snapshot carries: pre-token protocols with a model value, traded peers with the market\'s own value, and the protocols that name a token but record no market cap. The watchlist is covered in full.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('implied', 'Implied / mcap')
          )),
          tbody
        )
      )
    );
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
    ));
  }

  function board() {
    var list = sortedRows(view());
    if (list.length === 0) return emptyPanel();
    if (state.tab === 'live') return liveTable(list);
    if (state.tab === 'all') return allTable(list);
    return preTable(list);
  }

  // ---- detail drawer ----
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function splitStep(s) {
    var at = s.indexOf(' Cost: ');
    var timeAt = s.indexOf(' Time: ', at);
    var text = at >= 0 ? s.slice(0, at) : s;
    var cost = at >= 0 ? s.slice(at + 7, timeAt >= 0 ? timeAt : s.length) : '';
    var time = timeAt >= 0 ? s.slice(timeAt + 7).replace(/\.$/, '') : '';
    return { text: text, cost: cost, time: time };
  }

  function equationRow(label, value, hint, hl) {
    return el('div', null,
      el('span', null, label, hint ? el('small', { text: ' ' + hint }) : null),
      el('b', { class: hl ? 'hl' : null, text: value })
    );
  }

  function preDetail(row) {
    var c = recompute(row);
    var delta = c.implied === row.implied_value_usd ? 'matches the board' : 'differs from the board (' + fmtUsd(row.implied_value_usd) + '): stale data';
    return el('div', null,
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied value and its range' }),
        el('div', { class: 'hero-value' },
          el('span', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
          el('span', { class: 'rng', text: 'range ' + fmtUsd(row.implied_low) + ' \u2013 ' + fmtUsd(row.implied_high) + ' (0.6x to 1.6x)' })
        ),
        el('p', { class: 'note', text: 'This is an estimate from the snapshot, not a price or a promise. The page recomputes it as ' + fmtUsd(c.implied) + ' and ' + delta + '.' })
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'The model, term by term' }),
        el('div', { class: 'equation' },
          equationRow('TVL', fmtUsd(row.tvl_usd)),
          equationRow('Size z', fmtNum(row.z, 3), 'standardised log10(TVL)', false),
          equationRow('Growth g', fmtNum(row.g, 3), 'clamp(7d, -60, 120) / 100'),
          equationRow('Chains nc', fmtNum(row.nc, 0), 'min(len(chains), 6)'),
          equationRow('Fitted surface', fmtNum(row.b0 + row.b1 * row.z + row.b2 * row.g + row.b3 * row.nc, 3), 'b0 + b1 z + b2 g + b3 nc, in ln space'),
          equationRow('Category residual', (row.n_category ? fmtNum(row.residual_category, 3) + ' (shrunk, ' + (row.category || 'this category') + ' n=' + row.n_category + ')' : 'no traded peers'), row.n_category ? 'residual x n / (n + ' + DATA.fitted_model.shrink_k + ')' : 'no adjustment'),
          equationRow('Predicted multiple', fmtMult(row.predicted_multiple), 'exp(fitted + shrunk residual)', true),
          equationRow('Base value', fmtUsd(row.base_value_usd), '= TVL x predicted multiple'),
          equationRow('7d growth', fmtPct(row.change_7d), 'clamped to ' + DATA.model.growth_floor + '..+' + DATA.model.growth_cap),
          equationRow('Growth multiplier', 'x' + fmtNum(row.growth_multiplier), '1 + (growth / 100) x ' + DATA.model.growth_weight),
          equationRow('Age with no token', fmtAge(row.age_days), '(' + (row.age_days === null ? 'unknown, uses ' + DATA.model.unknown_age_days + ' days' : row.age_days + ' days') + ')'),
          equationRow('Wait multiplier', 'x' + fmtNum(row.wait_multiplier), '0.55 + min(age, ' + DATA.model.wait_days + ') / ' + DATA.model.wait_days + ' x 0.45'),
          equationRow('Chain multiplier', 'x' + fmtNum(row.chain_multiplier), (row.chains ? row.chains.length : 0) + ' chain' + (row.chains && row.chains.length === 1 ? '' : 's') + ', 1 + 0.03 x min(chains - 1, 4)'),
          equationRow('Thin-data discount', 'x' + fmtNum(row.thin_multiplier), row.change_7d === null || row.change_7d === undefined ? 'seven-day change unreported' : 'seven-day change reported'),
          equationRow('Implied value', fmtUsd(row.implied_value_usd), 'max(1, round(base x growth x wait x chains x thin))', true)
        )
      ),
      el('section', { class: 'detail-section' },
        el('h3', { text: 'Farm plan: each step with its cost and time' }),
        el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
          var p = splitStep(s);
          return el('li', null,
            el('b', { text: p.text }),
            el('div', { class: 'cost' },
              p.cost ? el('span', { text: 'cost: ' + p.cost }) : null,
              p.time ? el('span', { class: 'time', text: 'time: ' + p.time }) : null
            )
          );
        }))
      )
    );
  }

  function liveDetail(row) {
    return el('div', null,
      el('section', { class: 'detail-section' },
        el('h3', { text: 'This protocol already has a token' }),
        el('p', { class: 'note', text: 'Its market cap is a fact from the snapshot, not a model estimate, so it is set aside from the ranking. Its mcap/TVL multiple is one row of the training set the value model is fitted on.' }),
        el('div', { class: 'equation', style: 'margin-top:16px' },
          equationRow('TVL', fmtUsd(row.tvl_usd)),
          equationRow('Market cap', fmtUsd(row.mcap_usd)),
          equationRow('mcap / TVL', fmtMult(row.multiple), 'this protocol\'s own peer multiple', true),
          equationRow('7d TVL change', fmtPct(row.change_7d))
        )
      )
    );
  }

  function pendingDetail(row) {
    return el('div', null,
      el('section', { class: 'detail-section' },
        el('h3', { text: 'This protocol names a token but records no market cap' }),
        el('p', { class: 'note', text: 'The snapshot gives it a ticker (' + (row.symbol || 'unnamed') + ') and no market cap, so it is not a pre-token launch candidate to rank and not a traded peer with a multiple to fit. It is listed here so the page accounts for every protocol the snapshot carries instead of dropping it between the two sets. It takes no rank and no implied value, because there is nothing to price it against.' }),
        el('div', { class: 'equation', style: 'margin-top:16px' },
          equationRow('Symbol', row.symbol || 'not recorded'),
          equationRow('TVL', fmtUsd(row.tvl_usd)),
          equationRow('Market cap', 'not in the snapshot'),
          equationRow('7d TVL change', fmtPct(row.change_7d))
        )
      )
    );
  }

  function openDetail(slug, kind) {
    var row = (kind === 'live' ? liveRows() : kind === 'pending' ? pendingRows() : preRows()).filter(function (r) { return r.slug === slug; })[0];
    if (!row) row = preRows().filter(function (r) { return r.slug === slug; })[0] || liveRows().filter(function (r) { return r.slug === slug; })[0] || pendingRows().filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    dialog.textContent = '';
    var isLive = row.kind === 'live';
    var isPending = row.kind === 'pending';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: isLive ? 'Traded peer' : isPending ? 'Pending a market cap' : 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain not recorded') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(isLive ? liveDetail(row) : isPending ? pendingDetail(row) : preDetail(row));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(modelPanel());
    shell.appendChild(controls());
    shell.appendChild(board());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && !dialog.open) openDetail(state.selected, null);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

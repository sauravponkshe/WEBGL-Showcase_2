const WCEG = (function(){
  const SVGNS = 'http://www.w3.org/2000/svg';
  function st(el){
    const w = el.ownerDocument.defaultView;
    return w.__wcegScroll || (w.__wcegScroll = {});
  }
  const CSS = [
    '.wce-group-content{position:absolute;left:0;top:0;right:0;bottom:0}',
    '.wce-shape-fill,.wce-shape-content{position:absolute;left:0;top:0;right:0;bottom:0}',
    '.wce-shape-fill{pointer-events:none}',
    '.wce-shape-fill svg{position:absolute;left:0;top:0;display:block}',
    '.wce-overlay-shape{position:fixed;z-index:4;pointer-events:none}',
    '.wce-shape-content .wce-overlay-thumb,.wce-shape-content .wce-overlay-action-btn,.wce-shape-content .wce-overlay-group,',
    '.wce-shape-content .wce-overlay-section-slider,.wce-shape-content .wce-overlay-linked,',
    '.wce-group-content .wce-overlay-linked{pointer-events:auto}',
    '.wce-group-content>.wce-overlay-thumb,.wce-group-content>.wce-overlay-text,.wce-group-content>.wce-overlay-shape,',
    '.wce-group-content>.wce-overlay-section-slider,.wce-group-content>.wce-overlay-action-btn,',
    '.wce-shape-content>.wce-overlay-thumb,.wce-shape-content>.wce-overlay-text,.wce-shape-content>.wce-overlay-shape,',
    '.wce-shape-content>.wce-overlay-section-slider,.wce-shape-content>.wce-overlay-action-btn{position:absolute}',
    '.wce-group-content>.wce-overlay-group,.wce-shape-content>.wce-overlay-group{position:absolute}',
    '.wce-overlay-group{max-width:calc(100vw / var(--wce-s, 1))}',
    '.wce-group-scroller{position:absolute;z-index:8;box-sizing:border-box;touch-action:none;cursor:pointer}',
    '.wce-group-scroller-thumb{position:absolute;left:0;right:0;top:0;box-sizing:border-box;cursor:grab}'
  ].join('\n');
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function localScale(el){
    try{
      const r = el.getBoundingClientRect();
      const k = el.offsetHeight ? r.height / el.offsetHeight : (el.offsetWidth ? r.width / el.offsetWidth : 1);
      return k > 0.01 ? k : 1;
    }catch(e){ return 1; }
  }
  function num(v, dflt){ return (v!==undefined && v!==null && v!=='' && !isNaN(v)) ? +v : dflt; }
  function rgba(hex, a){
    const h = String(hex||'#808080').replace('#','');
    let r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
    if(isNaN(r)) r = 128;
    if(isNaN(g)) g = 128;
    if(isNaN(b)) b = 128;
    return 'rgba('+r+','+g+','+b+','+a+')';
  }
  function isHoriz(dir){ return dir==='horizontal' || dir==='reverse-horizontal'; }
  function groupInnerHTML(g){
    return '<div class="wce-group-header">'+
             '<span class="wce-group-arrow"></span>'+
             '<span class="wce-group-hdrshape"></span>'+
             '<span class="wce-group-label"></span>'+
           '</div>'+
      '<div class="wce-group-body"><div class="wce-group-content"></div></div>';
  }
  function groupHost(el){
    return el.querySelector('.wce-group-content') || el.querySelector('.wce-group-body');
  }
  function groupHeaderHost(el){
    return el.querySelector('.wce-group-header-content');
  }
  function ensureHeaderChildren(g, overlays){
    if(g._hdrInit) return;
    g._hdrInit = true;
    for(let i = overlays.length - 1; i >= 0; i--){
      const o = overlays[i];
      if(o.groupId === g.id && (o.headerRole === 'title' || o.headerRole === 'arrow')) overlays.splice(i, 1);
    }
  }
  function headerArrowOrient(dir, collapsed){
    if(dir === 'horizontal') return collapsed ? 'v' : 'h';
    if(dir === 'reverse-horizontal') return collapsed ? 'v' : 'rh';
    if(dir === 'reverse-vertical') return collapsed ? 'h' : 'rv';
    return collapsed ? 'h' : 'v';
  }
  function headerTextAlign(align, dir){
    if(align==='center') return 'center';
    if(isHoriz(dir)) return align==='end' ? 'end' : 'start';
    return align==='end' ? 'right' : 'left';
  }
  function groupExtras(el, g){
    el.__wcegG = g;
    el.style.background = 'none';
    el.style.border = 'none';
    const arrow = el.querySelector('.wce-group-arrow');
    const label = el.querySelector('.wce-group-label');
    const hdrShape = el.querySelector('.wce-group-hdrshape');
    const _noTrigger = (g.expandTrigger === 'none');
    const showArrow = g.showArrow !== false && !_noTrigger;
    const hasShape = !!(g.headerShape && g.headerShape !== 'none');
    const _hdrEl = el.querySelector('.wce-group-header');
    if(_hdrEl){
      if(_noTrigger){ _hdrEl.style.cursor = 'default'; _hdrEl.dataset.wceNoTrig = '1'; }
      else if(_hdrEl.dataset.wceNoTrig){ _hdrEl.style.cursor = ''; delete _hdrEl.dataset.wceNoTrig; }
    }
    if(arrow){
      arrow.style.color = g.arrowColor || '';
      arrow.style.fontSize = num(g.arrowSize, 9)+'px';
      arrow.style.display = (showArrow && !hasShape) ? '' : 'none';
    }
    if(hdrShape){
      hdrShape.style.display = (showArrow && hasShape) ? 'inline-block' : 'none';
      if(showArrow && hasShape){
        const sz = clamp(num(g.headerShapeSize, num(g.arrowSize, 9)), 4, 40);
        const color = g.headerShapeColor || g.arrowColor || '#c8a96e';
        hdrShape.style.borderWidth = Math.round(sz*0.65)+'px 0 '+Math.round(sz*0.65)+'px '+sz+'px';
        hdrShape.style.borderColor = 'transparent transparent transparent '+color;
      }
    }
    if(label){
      label.textContent = g.label || 'Group';
      label.style.display = (g.showTitle === false) ? 'none' : '';
      label.style.flex = '1 1 auto';
      label.style.minWidth = '0';
      label.style.color = g.titleColor || '';
      label.style.fontSize = num(g.titleFontSize, 13)+'px';
      label.style.fontFamily = g.titleFont ? ("'"+g.titleFont+"',sans-serif") : '';
      label.style.textAlign = headerTextAlign(g.headerAlign, g.direction||'vertical');
    }
    layoutScroller(el, g);
  }
  function scrollOn(g){ return !!(g && g.scrollEnabled); }
  function scrollLenOf(g){ return num(g.scrollLength, 600); }
  function metrics(el, g){
    const content = el.querySelector('.wce-group-content');
    const viewH = content ? content.clientHeight : 0;
    const total = Math.max(scrollLenOf(g), viewH);
    return {viewH: viewH, total: total, max: Math.max(0, total - viewH)};
  }
  function yMaxPct(g, viewH){
    if(!scrollOn(g) || !viewH) return 96;
    return Math.max(96, (Math.max(scrollLenOf(g), viewH) / viewH) * 100 - 4);
  }
  function layoutScroller(el, g){
    const body = el.querySelector('.wce-group-body');
    const content = el.querySelector('.wce-group-content');
    if(!body || !content) return;
    let bar = body.querySelector(':scope > .wce-group-scroller');
    if(!scrollOn(g)){
      if(bar) bar.remove();
      content.style.left = '0'; content.style.right = '0'; content.style.transform = '';
      body.style.touchAction = '';
      delete st(el)[g.id];
      return;
    }
    const doc = el.ownerDocument;
    const side = g.scrollSide==='left' ? 'left' : 'right';
    const thick = clamp(num(g.scrollWidth, 10), 2, 60);
    const gut = thick + 6;
    content.style.left = side==='left' ? gut+'px' : '0';
    content.style.right = side==='right' ? gut+'px' : '0';
    body.style.touchAction = 'none';
    let thumb;
    if(!bar){
      bar = doc.createElement('div'); bar.className = 'wce-group-scroller';
      thumb = doc.createElement('div'); thumb.className = 'wce-group-scroller-thumb';
      bar.appendChild(thumb); body.appendChild(bar);
      wireScroller(el, bar, thumb);
    } else {
      thumb = bar.querySelector('.wce-group-scroller-thumb');
    }
    const len = clamp(num(g.scrollTrackLength, 100), 10, 100);
    const bw = clamp(num(g.scrollBorderWidth, 0), 0, 8);
    const rad = clamp(num(g.scrollRadius, 4), 0, 30);
    bar.style.width = thick+'px';
    bar.style.top = ((100-len)/2)+'%';
    bar.style.height = len+'%';
    bar.style.left = side==='left' ? '3px' : 'auto';
    bar.style.right = side==='right' ? '3px' : 'auto';
    bar.style.background = rgba(g.scrollBg || '#000000', num(g.scrollBgOpacity, 40)/100);
    bar.style.border = bw>0 ? (bw+'px solid '+(g.scrollBorderColor || '#444444')) : 'none';
    bar.style.borderRadius = rad+'px';
    thumb.style.background = rgba(g.scrollThumbColor || '#c8a96e', num(g.scrollThumbOpacity, 100)/100);
    thumb.style.borderRadius = Math.max(0, rad - bw)+'px';
    updateScroller(el);
  }
  function updateScroller(el){
    const g = el.__wcegG;
    if(!g) return;
    const content = el.querySelector('.wce-group-content');
    if(!content) return;
    if(!scrollOn(g)){ content.style.transform = ''; return; }
    const m = metrics(el, g);
    if(m.viewH <= 0) return;
    const t = clamp(st(el)[g.id] || 0, 0, m.max);
    st(el)[g.id] = t;
    content.style.transform = t ? 'translateY('+(-t)+'px)' : '';
    const bar = el.querySelector('.wce-group-scroller');
    const thumb = bar && bar.querySelector('.wce-group-scroller-thumb');
    if(!bar || !thumb) return;
    const trackH = bar.clientHeight;
    const ratio = m.total > 0 ? Math.min(1, m.viewH / m.total) : 1;
    const thumbH = Math.max(Math.min(24, trackH), trackH * ratio);
    thumb.style.height = thumbH+'px';
    thumb.style.top = (m.max > 0 ? (trackH - thumbH) * (t / m.max) : 0)+'px';
  }
  function scheduleRefresh(el){
    if(!el.__wcegG) return;
    updateScroller(el);
    if(!scrollOn(el.__wcegG)) return;
    const w = el.ownerDocument.defaultView;
    if(!w) return;
    w.requestAnimationFrame(function(){ updateScroller(el); });
    w.setTimeout(function(){ updateScroller(el); }, 330);
  }
  function setScroll(el, top){
    const g = el.__wcegG;
    if(!scrollOn(g)) return;
    st(el)[g.id] = top;
    updateScroller(el);
  }
  function wireScroller(el, bar, thumb){
    const body = el.querySelector('.wce-group-body');
    thumb.addEventListener('pointerdown', function(ev){
      ev.stopPropagation(); ev.preventDefault();
      const g = el.__wcegG; if(!g) return;
      const m = metrics(el, g); if(m.max <= 0) return;
      const startY = ev.clientY, startTop = st(el)[g.id] || 0, k = localScale(bar);
      const span = Math.max(1, bar.clientHeight - thumb.offsetHeight);
      try{ thumb.setPointerCapture(ev.pointerId); }catch(e){}
      function move(e){ setScroll(el, startTop + ((e.clientY - startY) / k) * (m.max / span)); }
      function up(e){
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        try{ thumb.releasePointerCapture(e.pointerId); }catch(_){}
      }
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    });
    bar.addEventListener('pointerdown', function(ev){
      if(ev.target === thumb) return;
      ev.stopPropagation(); ev.preventDefault();
      const g = el.__wcegG; if(!g) return;
      const m = metrics(el, g); if(m.max <= 0) return;
      const r = bar.getBoundingClientRect();
      const span = bar.clientHeight - thumb.offsetHeight;
      const py = ((ev.clientY - r.top) / localScale(bar) - bar.clientTop) - thumb.offsetHeight / 2;
      setScroll(el, (span > 0 ? clamp(py / span, 0, 1) : 0) * m.max);
    });
    if(body.__wcegWired) return;
    body.__wcegWired = true;
    body.addEventListener('wheel', function(ev){
      const g = el.__wcegG; if(!scrollOn(g)) return;
      const m = metrics(el, g); if(m.max <= 0) return;
      ev.preventDefault(); ev.stopPropagation();
      setScroll(el, (st(el)[g.id] || 0) + (ev.deltaMode===1 ? ev.deltaY*16 : ev.deltaY));
    }, {passive:false});
    let ty = 0, t0 = 0, moved = false;
    body.addEventListener('touchstart', function(ev){
      const g = el.__wcegG; if(!scrollOn(g) || !ev.touches.length) return;
      ty = ev.touches[0].clientY; t0 = st(el)[g.id] || 0; moved = false;
    }, {passive:true});
    body.addEventListener('touchmove', function(ev){
      const g = el.__wcegG; if(!scrollOn(g) || !ev.touches.length) return;
      const dy = (ty - ev.touches[0].clientY) / localScale(body);
      if(Math.abs(dy) > 6) moved = true;
      if(moved){ ev.preventDefault(); setScroll(el, t0 + dy); }
    }, {passive:false});
    body.addEventListener('touchend', function(){
      if(!moved) return;
      moved = false;
      const swallow = function(e){ e.stopPropagation(); e.preventDefault(); };
      body.addEventListener('click', swallow, true);
      el.ownerDocument.defaultView.setTimeout(function(){ body.removeEventListener('click', swallow, true); }, 350);
    }, {passive:true});
  }
  const SHAPE_VERTS = {
    hexagon:  [[25,0],[75,0],[100,50],[75,100],[25,100],[0,50]],
    pentagon: [[50,0],[100,38],[82,100],[18,100],[0,38]],
    octagon:  [[30,0],[70,0],[100,30],[100,70],[70,100],[30,100],[0,70],[0,30]],
    diamond:  [[50,0],[100,50],[50,100],[0,50]]
  };
  SHAPE_VERTS.triangle = [[0,0],[100,50],[0,100]];
  SHAPE_VERTS.arrow = [[0,30],[58,30],[58,0],[100,50],[58,100],[58,70],[0,70]];
  function shapeVerts(shape, orient){
    const v = SHAPE_VERTS[shape];
    if(!v || (shape !== 'arrow' && shape !== 'triangle')) return v;
    const o = orient || (shape === 'triangle' ? 'rv' : 'h');
    if(o === 'h') return v;
    return v.map(function(p){ const x = p[0], y = p[1]; return o === 'rh' ? [100 - x, y] : (o === 'v' ? [y, x] : [y, 100 - x]); });
  }
  function polyPath(w, h, vp, radius){
    const pts = vp.map(function(p){ return [p[0]/100*w, p[1]/100*h]; });
    const n = pts.length;
    function dist(a,b){ return Math.hypot(a[0]-b[0], a[1]-b[1]); }
    function norm(v){ const l = Math.hypot(v[0], v[1]) || 1; return [v[0]/l, v[1]/l]; }
    let d = '';
    for(let i=0;i<n;i++){
      const prev = pts[(i-1+n)%n], curr = pts[i], next = pts[(i+1)%n];
      const v1 = norm([curr[0]-prev[0], curr[1]-prev[1]]), v2 = norm([next[0]-curr[0], next[1]-curr[1]]);
      const len1 = dist(prev,curr), len2 = dist(curr,next);
      const r = Math.max(0, Math.min(radius, len1/2, len2/2));
      const p1 = [curr[0]-v1[0]*r, curr[1]-v1[1]*r], p2 = [curr[0]+v2[0]*r, curr[1]+v2[1]*r];
      d += (i===0?'M ':'L ')+p1[0].toFixed(2)+' '+p1[1].toFixed(2)+' ';
      d += 'Q '+curr[0].toFixed(2)+' '+curr[1].toFixed(2)+' '+p2[0].toFixed(2)+' '+p2[1].toFixed(2)+' ';
    }
    return d + 'Z';
  }
  const _aspects = {}, _waiters = {};
  function aspectKey(u){ return u.length + ':' + u.slice(0, 40) + u.slice(-40); }
  function knownAspect(rec){ return rec.imageAspect > 0 ? rec.imageAspect : (_aspects[aspectKey(rec.image)] || 0); }
  function measureImage(url, doc, done){
    const key = aspectKey(url);
    if(_aspects[key]){ done(_aspects[key]); return; }
    if(_waiters[key]){ _waiters[key].push(done); return; }
    _waiters[key] = [done];
    const img = new (doc.defaultView.Image)();
    function fin(a){ _aspects[key] = a; const w = _waiters[key] || []; delete _waiters[key]; w.forEach(function(f){ try{ f(a); }catch(e){} }); }
    img.onload = function(){ fin(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1); };
    img.onerror = function(){ fin(1); };
    img.src = url;
  }
  function imgGeom(rec, W, H){
    const a = knownAspect(rec);
    if(!(a > 0) || !(W > 0) || !(H > 0)) return null;
    let iw = rec.imageFit === 'fit' ? Math.min(W, H * a) : Math.max(W, H * a);
    iw *= clamp(num(rec.imageScale, 100), 5, 800) / 100;
    const ih = iw / a;
    const X = clamp(num(rec.imageX, 50), 0, 100), Y = clamp(num(rec.imageY, 50), 0, 100);
    return {iw: iw, ih: ih, left: (W - iw) * X / 100, top: (H - ih) * Y / 100, a: a};
  }
  function paintImage(host, rec, W, H, opacity){
    const doc = host.ownerDocument;
    let layer = host.querySelector(':scope > .wce-img-layer');
    if(!layer){ layer = doc.createElement('div'); layer.className = 'wce-img-layer'; host.insertBefore(layer, host.firstChild); }
    layer.style.position = 'absolute'; layer.style.left = '0px'; layer.style.top = '0px';
    layer.style.width = W + 'px'; layer.style.height = H + 'px';
    layer.style.pointerEvents = 'none'; layer.style.backgroundRepeat = 'no-repeat';
    layer.style.backgroundImage = 'url("' + String(rec.image).replace(/"/g, '%22') + '")';
    layer.style.opacity = (opacity != null && opacity < 1) ? String(opacity) : '';
    const g = imgGeom(rec, W, H);
    if(g){
      layer.style.backgroundSize = g.iw + 'px ' + g.ih + 'px';
      layer.style.backgroundPosition = g.left + 'px ' + g.top + 'px';
    } else {
      layer.style.backgroundSize = rec.imageFit === 'fit' ? 'contain' : 'cover';
      layer.style.backgroundPosition = num(rec.imageX, 50) + '% ' + num(rec.imageY, 50) + '%';
      measureImage(rec.image, doc, function(){ if(host.isConnected) paintImage(host, rec, W, H, opacity); });
    }
    return layer;
  }
  function thumbDims(o){
    const size = num(o.size, 46);
    const frame = true;
    return {w: frame && o.width > 0 ? o.width : size, h: frame && o.height > 0 ? o.height : size};
  }
  function thumbImageBox(o){
    const d = thumbDims(o), bw = (o.shape === 'none') ? 0 : (o.borderWidth != null ? o.borderWidth : 2);
    return {ox: bw, oy: bw, W: Math.max(1, d.w - 2 * bw), H: Math.max(1, d.h - 2 * bw)};
  }
  function shapeImageBox(s){
    const w = Math.max(1, num(s.width, 160)), h = Math.max(1, num(s.height, 120)), bw = clamp(num(s.borderWidth, 2), 0, 40);
    return {ox: bw, oy: bw, W: Math.max(1, w - 2 * bw), H: Math.max(1, h - 2 * bw)};
  }
  function shadowAlpha(dark){
    const d = (dark == null || isNaN(Number(dark))) ? 45 : Number(dark);
    return Math.max(0, Math.min(100, d)) / 100;
  }
  function shadowCss(on, strength, dark){
    const s = strength == null ? 12 : strength;
    if(!on || !(s > 0)) return 'none';
    return '0 ' + Math.round(s / 6) + 'px ' + s + 'px rgba(0,0,0,' + shadowAlpha(dark) + ')';
  }
  function shadowFilter(on, strength, dark){
    const s = strength == null ? 12 : strength;
    if(!on || !(s > 0)) return '';
    return 'drop-shadow(0 ' + Math.round(s / 6) + 'px ' + Math.round(s / 2) + 'px rgba(0,0,0,' + shadowAlpha(dark) + '))';
  }
  function borderRgba(color, opacity){
    const c = color || '#ffffff';
    return (opacity != null && opacity < 100) ? rgba(c, opacity / 100) : c;
  }
  function paintThumb(el, o){
    const doc = el.ownerDocument;
    el.removeAttribute('data-wce-poly'); el.style.removeProperty('--wce-shadow-filter');
    el.style.opacity = (o.opacity != null ? o.opacity : 100) / 100;
    el.style.transform = o.rotation ? 'rotate('+o.rotation+'deg)' : '';
    el.style.setProperty('--wce-thumb-shadow', shadowCss(o.shadow !== false, o.shadowStrength, o.shadowDarkness));
    const shape = o.shape || 'circle';
    const d = thumbDims(o), w = d.w, h = d.h;
    const bw = o.borderWidth != null ? o.borderWidth : 2;
    const borderColor = borderRgba(o.borderColor, o.borderOpacity);
    const radius = o.radius || 0;
    const hasImg = o.kind === 'image' && o.image;
    el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.overflow = 'hidden';
    if(shape === 'none'){
      el.style.clipPath = 'none'; el.style.borderRadius = '0px'; el.style.border = 'none';
      if(hasImg){ el.style.background = 'transparent'; paintImage(el, o, w, h); }
      else el.style.background = o.color || '#808080';
      return;
    }
    const vp = shapeVerts(shape, o.orient);
    if(vp){
      el.setAttribute('data-wce-poly', '1');
      el.style.clipPath = 'none'; el.style.borderRadius = '0px'; el.style.border = 'none'; el.style.background = 'transparent';
      el.style.setProperty('--wce-shadow-filter', shadowFilter(o.shadow !== false, o.shadowStrength, o.shadowDarkness));
      const outer = doc.createElement('div');
      outer.className = 'wce-poly-outer';
      outer.style.cssText = 'position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px;';
      outer.style.clipPath = 'path("' + polyPath(w, h, vp, radius) + '")';
      outer.style.background = bw > 0 ? borderColor : 'transparent';
      el.appendChild(outer);
      const iw = Math.max(1, w - 2 * bw), ih = Math.max(1, h - 2 * bw);
      const inner = doc.createElement('div');
      inner.style.cssText = 'position:absolute;left:' + bw + 'px;top:' + bw + 'px;width:' + iw + 'px;height:' + ih + 'px;';
      inner.style.clipPath = 'path("' + polyPath(iw, ih, vp, Math.max(0, radius - bw)) + '")';
      if(hasImg) paintImage(inner, o, iw, ih); else inner.style.background = o.color || '#808080';
      el.appendChild(inner);
    } else {
      el.style.clipPath = 'none';
      el.style.borderRadius = shape === 'circle' ? '50%' : radius + 'px';
      el.style.borderWidth = bw + 'px'; el.style.borderStyle = bw > 0 ? 'solid' : 'none'; el.style.borderColor = borderColor;
      if(hasImg){ el.style.background = 'transparent'; paintImage(el, o, Math.max(1, w - 2 * bw), Math.max(1, h - 2 * bw)); }
      else el.style.background = o.color || '#808080';
    }
  }
  function paintShape(el, s){
    const doc = el.ownerDocument;
    const w = Math.max(1, num(s.width, 160)), h = Math.max(1, num(s.height, 120));
    const shape = s.shape || 'square';
    const bw = clamp(num(s.borderWidth, 2), 0, 40);
    const bc = borderRgba(s.borderColor, s.borderOpacity);
    const fa = clamp(num(s.fillOpacity, 100), 0, 100) / 100;
    const radius = Math.max(0, num(s.radius, 12));
    const hasImg = s.kind === 'image' && !!s.image;
    el.style.width = w+'px'; el.style.height = h+'px';
    el.style.opacity = clamp(num(s.opacity, 100), 0, 100) / 100;
    el.style.transform = s.rotation ? 'rotate('+s.rotation+'deg)' : '';
    el.setAttribute('data-wce-sil', '1');
    el.style.setProperty('--wce-shadow-filter', shadowFilter(s.shadow === true, s.shadowStrength, s.shadowDarkness));
    while(el.firstChild) el.removeChild(el.firstChild);
    const fill = doc.createElement('div'); fill.className = 'wce-shape-fill';
    const content = doc.createElement('div'); content.className = 'wce-shape-content';
    const vp = shapeVerts(shape, s.orient);
    if(vp){
      const outer = polyPath(w, h, vp, radius);
      const svg = doc.createElementNS(SVGNS, 'svg');
      svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 '+w+' '+h);
      const path = doc.createElementNS(SVGNS, 'path');
      path.setAttribute('d', outer);
      path.setAttribute('fill', hasImg ? 'none' : rgba(s.color || '#1a1a1c', fa));
      if(bw > 0){
        path.setAttribute('stroke', bc);
        path.setAttribute('stroke-width', bw*2);
        path.setAttribute('stroke-linejoin', 'round');
      }
      svg.appendChild(path);
      svg.style.clipPath = 'path("'+outer+'")';
      fill.appendChild(svg);
      if(hasImg){
        const iw = Math.max(1, w - 2*bw), ih = Math.max(1, h - 2*bw);
        const inner = doc.createElement('div');
        inner.style.cssText = 'position:absolute;left:'+bw+'px;top:'+bw+'px;width:'+iw+'px;height:'+ih+'px;pointer-events:none';
        inner.style.clipPath = 'path("'+polyPath(iw, ih, vp, Math.max(0, radius - bw))+'")';
        paintImage(inner, s, iw, ih, fa);
        fill.appendChild(inner);
      }
      content.style.clipPath = 'path("'+outer+'")';
    } else {
      const rad = shape==='circle' ? '50%' : radius+'px';
      fill.style.borderRadius = rad;
      fill.style.background = hasImg ? 'transparent' : rgba(s.color || '#1a1a1c', fa);
      fill.style.border = bw > 0 ? (bw+'px solid '+bc) : 'none';
      content.style.borderRadius = rad;
      content.style.overflow = 'hidden';
      if(hasImg){ fill.style.overflow = 'hidden'; paintImage(fill, s, Math.max(1, w - 2*bw), Math.max(1, h - 2*bw), fa); }
    }
    el.appendChild(fill);
    el.appendChild(content);
  }
  function buildShape(doc, s){
    const el = doc.createElement('div');
    el.className = 'wce-overlay-shape';
    el.dataset.overlayId = s.id;
    paintShape(el, s);
    return el;
  }
  function shapeHost(el){ return el.querySelector(':scope > .wce-shape-content'); }
  const SNAP_KEYS = [
    'x','y','groupId','width','height','size','collapsed','direction','opacity',
    'shape','radius','borderWidth','borderColor','color','fillOpacity','borderOpacity','shadow','shadowStrength','shadowDarkness','tracking','orient',
    'fontFamily','fontSize',
    'tabBg','tabBgOpacity','tabBorderColor','tabBorderWidth','tabRadius',
    'shelfBg','shelfBgOpacity','shelfBorderColor','shelfBorderWidth','shelfRadius',
    'titleFont','titleFontSize','titleColor','headerAlign','arrowColor','arrowSize',
    'scrollEnabled','scrollSide','scrollLength','scrollTrackLength','scrollWidth',
    'scrollBg','scrollBgOpacity','scrollBorderColor','scrollBorderWidth','scrollRadius',
    'scrollThumbColor','scrollThumbOpacity',
    'trackColor','trackHeight','thumbColor','thumbSize','activeColor','showLabels',
    'hover','iconColor'
  ];
  function snapshotOf(o){
    const s = {};
    SNAP_KEYS.forEach(function(k){ if(o[k] !== undefined) s[k] = o[k]; });
    s.groupId = o.groupId || null;
    s.hidden = !!o.hidden;
    return s;
  }
  return {
    css: CSS, rgba: rgba, isHoriz: isHoriz, clamp: clamp,
    SNAP_KEYS: SNAP_KEYS, snapshotOf: snapshotOf,
    groupInnerHTML: groupInnerHTML, groupHost: groupHost, groupHeaderHost: groupHeaderHost, groupExtras: groupExtras,
    ensureHeaderChildren: ensureHeaderChildren, headerArrowOrient: headerArrowOrient,
    headerTextAlign: headerTextAlign,
    updateScroller: updateScroller, scheduleRefresh: scheduleRefresh, setScroll: setScroll,
    yMaxPct: yMaxPct, scrollOn: scrollOn,
    paintShape: paintShape, buildShape: buildShape, shapeHost: shapeHost,
    paintThumb: paintThumb, paintImage: paintImage, imgGeom: imgGeom, measureImage: measureImage,
    knownAspect: knownAspect, thumbDims: thumbDims, thumbImageBox: thumbImageBox, shapeImageBox: shapeImageBox
  };
})();
const WCEUIS = (function(){
  const STAGE_ID = 'wce-ui-stage', CANVAS_ID = 'wce-ui-canvas';
  const DEFAULTS = {
    enabled: true, min: 0.6, max: 2.5,
    ref:         { desktop: [1920, 1080], mobileV: [390, 844], mobileH: [844, 390] },
    heightSlack: { desktop: 0 },
    fit:         { mobileV: 'w', mobileH: 'h' },
    literal:     { desktop: [false, false], mobileV: [false, true], mobileH: [true, false] },
    safe:        { mobileV: [390, 660], mobileH: [693, 390] },
    bleed: {
      desktop: { x: [{at: 1728, label: '16:10'}, {at: 1440, label: '4:3'}], y: [{at: 950, label: 'browser'}] },
      mobileV: { x: [], y: [{at: 780, label: '18:9'}, {at: 693, label: '16:9'}, {at: 660, label: 'browser bars'}] },
      mobileH: { x: [{at: 780, label: '18:9'}, {at: 693, label: '16:9'}], y: [] }
    },
    narrowBelow: 768
  };
  const MERGE = ['ref', 'heightSlack', 'fit', 'literal', 'safe', 'bleed'];
  function clampN(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function cfgFor(win){
    try{
      const o = win.WCE_THEME && win.WCE_THEME.uiScale;
      if(o && typeof o === 'object'){
        const c = Object.assign({}, DEFAULTS, o);
        MERGE.forEach(function(k){ c[k] = Object.assign({}, DEFAULTS[k], o[k] || {}); });
        return c;
      }
    }catch(e){}
    return DEFAULTS;
  }
  function urlParam(win){
    try{ return new win.URLSearchParams(win.location.search).get('wce_uiscale'); }catch(e){ return null; }
  }
  function inDesigner(win){
    if(win.__wceDesigner) return true;
    try{ return win.parent !== win && !!win.parent.document.getElementById('wce-preview-frame'); }catch(e){ return false; }
  }
  function viewportSize(win){
    const vv = win.visualViewport;
    return vv ? {w: vv.width, h: vv.height} : {w: win.innerWidth || 1, h: win.innerHeight || 1};
  }
  function viewOf(win){
    if(win.__wceUiView) return win.__wceUiView;
    try{ if(typeof win._wceDetectDeviceView === 'function') return win._wceDetectDeviceView(); }catch(e){}
    return 'desktop';
  }
  function compute(win){
    const p = urlParam(win);
    if(p === 'off' || inDesigner(win)) return 1;
    const c = cfgFor(win);
    if(c.enabled === false) return 1;
    if(p !== null && p !== '' && isFinite(parseFloat(p))) return clampN(parseFloat(p), 0.25, 4);
    const v = viewOf(win);
    const ref = c.ref[v] || c.ref.desktop;
    const vp = viewportSize(win), vw = vp.w, vh = vp.h;
    const fit = c.fit[v];
    let s;
    if(fit === 'w')      s = vw / ref[0];
    else if(fit === 'h') s = vh / ref[1];
    else {
      const slack = clampN(+c.heightSlack[v] || 0, 0, 0.5);
      s = Math.min(vw / ref[0], vh / (ref[1] * (1 - slack)));
    }
    s = clampN(s, +c.min || 0.25, +c.max || 4);
    s = Math.round(s * 1000) / 1000;
    return Math.abs(s - 1) < 0.005 ? 1 : s;
  }
  function apply(win){
    win = win || window;
    const d = win.document;
    if(!d || !d.documentElement) return 1;
    const s = compute(win), prev = win.__wceUiScale;
    const vp = viewportSize(win), vw = vp.w, vh = vp.h;
    const c = cfgFor(win), v = viewOf(win);
    win.__wceUiScale = s;
    d.documentElement.style.setProperty('--wce-s', String(s));
    const st = d.getElementById(STAGE_ID);
    if(st){
      st.style.width = (vw / s) + 'px';
      st.style.height = (vh / s) + 'px';
      st.style.transform = (s === 1) ? 'none' : 'scale(' + s + ')';
    }
    const cv = d.getElementById(CANVAS_ID);
    if(cv){
      const ref = c.ref[v] || c.ref.desktop, lit = c.literal[v] || [false, false];
      cv.style.width  = lit[0] ? ref[0] + 'px' : (vw / s) + 'px';
      cv.style.height = lit[1] ? ref[1] + 'px' : (vh / s) + 'px';
    }
    d.documentElement.classList.toggle('wce-narrow', (vw / s) < (c.narrowBelow || 768));
    if(prev !== s){
      try{ win.dispatchEvent(new win.CustomEvent('wce-uiscale', {detail: {scale: s}})); }catch(e){}
    }
    return s;
  }
  function init(win){
    win = win || window;
    apply(win);
    if(win.__wceUiScaleWired) return;
    win.__wceUiScaleWired = true;
    const again = function(){ apply(win); };
    win.addEventListener('resize', again);
    win.addEventListener('orientationchange', again);
    if(win.visualViewport){
      win.visualViewport.addEventListener('resize', again);
      win.visualViewport.addEventListener('scroll', again);
    }
  }
  function chromeDefaultPos(win, el, view){
    const c = cfgFor(win), v = view || viewOf(win);
    const ref = c.ref[v] || c.ref.desktop, lit = c.literal[v] || [false, false], safe = c.safe[v];
    const m = 14, h = el.offsetHeight || 30;
    const bottom = (lit[1] && safe) ? safe[1] : ref[1];
    return { x: m / ref[0] * 100, y: (bottom - m - h) / ref[1] * 100 };
  }
  function applyStacking(doc, overlays){
    const w = doc.defaultView;
    const byId = {};
    doc.querySelectorAll('[data-overlay-id]').forEach(function(e){ (byId[e.getAttribute('data-overlay-id')] = byId[e.getAttribute('data-overlay-id')] || []).push(e); });
    (overlays || []).forEach(function(o){
      if(!o) return;
      (byId[String(o.id)] || []).forEach(function(el){
        if(typeof o.z === 'number') el.style.zIndex = String(o.z);
        if(o.hidden){ el.style.setProperty('display', 'none', 'important'); el.dataset.wceHid = '1'; }
        else if(el.dataset.wceHid){ el.style.removeProperty('display'); delete el.dataset.wceHid; }
      });
    });
  }
  function resolveProfile(p, profiles, view){
    if(!p) return p;
    const chain = [];
    let cur = p, guard = 0;
    while(cur && guard++ < 12){
      chain.unshift(cur);
      const pid = cur.parentId;
      cur = pid ? (profiles || []).find(function(x){ return x.id === pid; }) : null;
    }
    const eff = Object.assign({}, p);
    eff.__src = p;
    const merged = {colors: {}, thumbnails: {}, textOverrides: {}, groupOverrides: {}}, ov = {};
    let stamp = null, any = false;
    chain.forEach(function(x){
      Object.keys(merged).forEach(function(k){
        const src = x[k] || {};
        Object.keys(src).forEach(function(id){
          const a = merged[k][id], b = src[id];
          merged[k][id] = (a && b && typeof a === 'object' && typeof b === 'object') ? Object.assign({}, a, b) : b;
        });
      });
      if(x.panelBg !== undefined) eff.panelBg = x.panelBg;
      if(x.panelOpacity !== undefined) eff.panelOpacity = x.panelOpacity;
      const s = (x.snapshots && x.snapshots[view]) || x.snapshot;
      if(s && s.overlays){
        any = true; stamp = s.capturedAt || stamp;
        Object.keys(s.overlays).forEach(function(id){ ov[id] = Object.assign({}, ov[id] || {}, s.overlays[id]); });
      }
    });
    eff.colors = merged.colors; eff.thumbnails = merged.thumbnails; eff.textOverrides = merged.textOverrides; eff.groupOverrides = merged.groupOverrides;
    eff.snapshot = any ? {capturedAt: stamp, overlays: ov} : null;
    return eff;
  }
  const ICON_PATHS = {
    present:   '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    snapshot:  '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    sound_on:  '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    sound_off: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
    close:     '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    eye:       '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    eye_off:   '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
  };
  function iconSvg(kind, px){
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATHS[kind] || '') + '</svg>';
  }
  function hexRgba(hex, a){
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if(!m) return hex;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function applyIconStyle(el, o, kind){
    const size = o.size || 40, shape = o.shape || 'circle';
    el.classList.add('wce-icon-btn');
    el.innerHTML = iconSvg(kind, Math.round(size * 0.5));
    el.style.width = size + 'px'; el.style.height = size + 'px'; el.style.padding = '0'; el.style.justifyContent = 'center'; el.style.gap = '0';
    el.style.borderRadius = shape === 'circle' ? '50%' : (shape === 'square' || shape === 'none' ? '0' : (o.radius != null ? o.radius : 10) + 'px');
    if(o.color) el.style.background = hexRgba(o.color, (o.fillOpacity != null ? o.fillOpacity : 100) / 100);
    if(o.borderWidth != null) el.style.borderWidth = o.borderWidth + 'px';
    if(o.borderColor) el.style.borderColor = o.borderColor;
    if(o.iconColor) el.style.color = o.iconColor;
    if(o.opacity != null) el.style.opacity = String(o.opacity / 100);
  }
  function applyHover(doc, overlays){
    const w = doc.defaultView;
    const byId = {};
    doc.querySelectorAll('[data-overlay-id]').forEach(function(e){ (byId[e.getAttribute('data-overlay-id')] = byId[e.getAttribute('data-overlay-id')] || []).push(e); });
    (overlays || []).forEach(function(o){
      if(!o) return;
      (byId[String(o.id)] || []).forEach(function(el){
        ['scale', 'lift', 'opacity', 'fill', 'border', 'ring-w', 'glow', 'glow-r', 'speed'].forEach(function(k){ el.style.removeProperty('--wce-hv-' + k); });
        const h = o.hover;
        if(h && typeof h === 'object') el.setAttribute('data-wce-hv', '1'); else el.removeAttribute('data-wce-hv');
        if(o.type === 'text'){
          el.setAttribute('data-wce-sil', '1');
          const ori = o.orient || 'h';
          el.style.writingMode = (ori === 'v' || ori === 'rv') ? 'vertical-rl' : '';
          el.style.rotate = (ori === 'rh' || ori === 'rv') ? '180deg' : '';
          el.style.letterSpacing = o.tracking ? o.tracking + 'px' : '';
          {
            const _ss = o.shadowStrength == null ? 12 : o.shadowStrength, _dk = (o.shadowDarkness == null || isNaN(Number(o.shadowDarkness))) ? 45 : Math.max(0, Math.min(100, Number(o.shadowDarkness)));
            el.style.textShadow = (o.shadow === true && _ss > 0) ? '0 ' + Math.round(_ss / 6) + 'px ' + Math.round(_ss / 2) + 'px rgba(0,0,0,' + Math.min(1, _dk / 100 * 0.6 / 0.45) + ')' : '';
          }
          if(o.opacity != null) el.style.opacity = String(o.opacity / 100);
        }
        if(h && Object.keys(h).length){ el.style.pointerEvents = 'auto'; el.dataset.wceHvPe = '1'; }
        else if(el.dataset.wceHvPe){ el.style.removeProperty('pointer-events'); delete el.dataset.wceHvPe; }
        if(!h) return;
        if(h.scale != null) el.style.setProperty('--wce-hv-scale', String(h.scale / 100));
        if(h.lift) el.style.setProperty('--wce-hv-lift', (-Math.abs(h.lift)) + 'px');
        if(h.opacity != null) el.style.setProperty('--wce-hv-opacity', String(h.opacity / 100));
        if(h.fill) el.style.setProperty('--wce-hv-fill', h.fill);
        if(h.border){ el.style.setProperty('--wce-hv-border', h.border === 'auto' ? 'var(--wce-thumb-active-color, var(--accent))' : h.border); el.style.setProperty('--wce-hv-ring-w', '2px'); }
        if(h.glow){ el.style.setProperty('--wce-hv-glow', h.glow); el.style.setProperty('--wce-hv-glow-r', (h.glowSize != null ? h.glowSize : 14) + 'px'); }
        if(h.speed != null) el.style.setProperty('--wce-hv-speed', h.speed + 'ms');
      });
    });
  }
  return {
    STAGE_ID: STAGE_ID, CANVAS_ID: CANVAS_ID, REF: DEFAULTS.ref, DEFAULTS: DEFAULTS,
    compute: compute, viewOf: viewOf, chromeDefaultPos: chromeDefaultPos, applyStacking: applyStacking, applyHover: applyHover, applyIconStyle: applyIconStyle, iconSvg: iconSvg, resolveProfile: resolveProfile, apply: apply, init: init,
    bleed:   function(view, win){ return (cfgFor(win || window).bleed[view]) || {x: [], y: []}; },
    safe:    function(view, win){ return cfgFor(win || window).safe[view] || null; },
    literal: function(view, win){ return cfgFor(win || window).literal[view] || [false, false]; },
    refSize: function(win){ win = win || window; const c = cfgFor(win); return c.ref[viewOf(win)] || c.ref.desktop; },
    scale: function(win){ return (win || window).__wceUiScale || 1; },
    stage: function(doc){ doc = doc || document; return doc.getElementById(STAGE_ID) || doc.body; }
  };
})();
try{ if(typeof window !== 'undefined' && document.getElementById(WCEUIS.STAGE_ID)) WCEUIS.init(window); }catch(e){}
(function(){
  try{
    const s=document.createElement('style'); s.id='wceg-css'; s.textContent=WCEG.css;
    (document.head||document.documentElement).appendChild(s);
  }catch(e){}
})();
function _animLabel(def,idx){
  const total=(def.states||2)-1;
  const nm=(def.state_names&&def.state_names[idx])?def.state_names[idx]:'';
  return (nm?nm+' ':'')+'['+idx+'/'+total+']';
}
function buildHDRISwitcher(){
  const items=CFG.hdris||[];
  const sec=document.getElementById('shdri');
  if(!sec) return;
  if(items.length<2){ sec.innerHTML=''; return; }
  const overlaySet=_wceOverlaySet();
  const shown=items;
  sec.innerHTML='<div class="st">Environment</div>';
  const g=mk('div','pg');
  shown.forEach(item=>{
    const b=mk('button','pb2'); b.textContent=item.name; b.dataset.hf=item.file; b.dataset.name=item.name; b.dataset.uid=item.uid||'';
    if(item.name===_hdriActiveName || (!_hdriActiveName && item.default)) b.classList.add('active');
    b.onclick=()=>{
      _loadHDRIItem(item);
      qsa('.pb2[data-hf]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    };
    g.appendChild(b);
  });
  sec.appendChild(g);
}
function buildFilterSwitcher(){
  const items=(CFG.post_process&&CFG.post_process.filters)||[];
  const shown=items;
  const sec2=document.getElementById('sfilters');
  if(!sec2) return;
  if(!shown.length){ sec2.innerHTML=''; return; }
  sec2.innerHTML='<div class="st">Filters</div>';
  const g2=mk('div','pg');
  shown.forEach(item=>{
    const b=mk('button','pb2'); b.textContent=item.name; b.dataset.pf=item.filter_type; b.dataset.pfn=item.name;
    if(window._wceActivePPFilterName!==undefined ? window._wceActivePPFilterName===item.name : window._wceActivePPFilter===item.filter_type) b.classList.add('active');
    b.onclick=()=>{
      if(typeof _wceApplyPPFilter==='function') _wceApplyPPFilter(item.filter_type, item.intensity, item);
      window._wceActivePPFilter=item.filter_type;
      qsa('.pb2[data-pf]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    };
    g2.appendChild(b);
  });
  sec2.appendChild(g2);
}
const SELECTABLE_SELECTOR = '.vc,.gb,.pb2,.anim-btn,.cam-btn,.tt-btn,.cin-btn,.tnb,.tb,h1,#vl,.st,#atb,#ar-btn,#force-refresh-btn,#st,.sr-label,.hotspot-lbl,.empty-note';
function _wceHexToRgba(hex, alpha){
  const h=(hex||'#808080').replace('#','');
  let r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  if(isNaN(r)) r=128; if(isNaN(g)) g=128; if(isNaN(b)) b=128;
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}
function _wceApplyColors(colors, panelBg, panelOpacity){
  if(colors) Object.entries(colors).forEach(([k,v])=>{
    if(v) document.documentElement.style.setProperty('--'+k, v);
  });
  const bg = panelBg || '#000000';
  const op = (panelOpacity!=null?panelOpacity:100)/100;
  document.documentElement.style.setProperty('--panel-bg', _wceHexToRgba(bg, op));
}
function applyGlobalPalette(){
  const theme = window.WCE_THEME || {};
  Object.keys(theme.colors||{}).forEach(k=>{ document.documentElement.style.removeProperty('--'+k); });
  document.documentElement.style.removeProperty('--panel-bg');
  window._wceActiveProfile = null;
  window._wceLive = null;
  if(typeof buildThumbnailOverlays==='function') buildThumbnailOverlays();
}
function _wceBuildLive(p){
  const snap = p && p.snapshot && p.snapshot.overlays;
  if(!p || p.mode!=='canvas' || !snap) return null;
  const live = {};
  (window.WCE_OVERLAYS||[]).forEach(o=>{
    const s = snap[o.id];
    if(!s) return;
    const c = Object.assign({}, o, JSON.parse(JSON.stringify(s)));
    if(o.imageScale !== undefined) c.imageScale = o.imageScale; else delete c.imageScale;
    if(o.type==='toggle'){
      Object.defineProperty(c, 'activeIndex', {get(){ return o.activeIndex; }, set(v){ o.activeIndex = v; }, enumerable:true, configurable:true});
    }
    live[o.id] = c;
  });
  return live;
}
function _wceEffectiveOverlays(){
  const base = (window.WCE_OVERLAYS||[]).filter(o=>o.type!=='ocean_state' || _wceOceanStatesOn());
  const live = window._wceLive;
  if(!live) return base;
  return base.map(o=>live[o.id]||o);
}
function _wceLiveOverlay(id){
  const live = window._wceLive;
  if(live && live[id]) return live[id];
  return (window.WCE_OVERLAYS||[]).find(x=>x.id===id);
}
function _wceProfileClick(p){
  const tr = p.transition||'fade';
  const _cur = window._wceActiveProfile;
  if(p.mode==='canvas' && p.returnOnRetrigger && _cur && _cur.__src===p){
    const _parent = p.parentId ? (window.WCE_PROFILES||[]).find(x=>x.id===p.parentId) : null;
    _wceRunTransition(()=>{ if(_parent) applyProfile(_parent); else applyGlobalPalette(); }, tr, p.duration);
  } else {
    _wceRunTransition(()=>applyProfile(p), tr, p.duration);
  }
}
function applyProfile(p){
  if(!p) return;
  const _eff = WCEUIS.resolveProfile(p, window.WCE_PROFILES||[], _wceDetectDeviceView());
  if(p.mode!=='canvas') _wceApplyColors(_eff.colors, _eff.panelBg, _eff.panelOpacity);
  window._wceActiveProfile = _eff;
  window._wceLive = _wceBuildLive(_eff);
  if(typeof buildThumbnailOverlays==='function') buildThumbnailOverlays();
}
function _wceRunTransition(applyFn, transitionType, duration){
  const dur = duration!=null ? duration : 400;
  if(transitionType === 'blackout' || transitionType === 'whiteout'){
    const panel = document.getElementById('panel');
    const rect = panel ? panel.getBoundingClientRect() : {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
    const half = Math.max(80, Math.round(dur/2));
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;'+
      'z-index:99999;background:'+(transitionType==='blackout'?'#000':'#fff')+';opacity:0;transition:opacity '+(half/1000)+'s ease;pointer-events:none';
    document.body.appendChild(overlay);
    requestAnimationFrame(()=>{ overlay.style.opacity='1'; });
    setTimeout(()=>{
      applyFn();
      setTimeout(()=>{
        overlay.style.opacity='0';
        setTimeout(()=>{ overlay.remove(); }, half+40);
      }, 80);
    }, half+10);
  } else if(transitionType === 'fade'){
    _wceEnsureColorTransitionCSS(dur);
    applyFn();
    clearTimeout(_wceColorTransitionCleanupTimer);
    _wceColorTransitionCleanupTimer = setTimeout(_wceRemoveColorTransitionCSS, dur+50);
  } else {
    _wceRemoveColorTransitionCSS();
    applyFn();
  }
}
let _wceColorTransitionCleanupTimer = null;
function _wceEnsureColorTransitionCSS(dur){
  if(document.getElementById('wce-color-transition-css')) return;
  const secs = (dur!=null?dur:400)/1000;
  const s=document.createElement('style'); s.id='wce-color-transition-css';
  s.textContent = '.pb2,.gb,.tb,.anim-btn,.cam-btn,.tt-btn,.cin-btn,.vc,.tnb,#panel{'+
    'transition:background-color '+secs+'s ease,color '+secs+'s ease,border-color '+secs+'s ease !important;}';
  document.head.appendChild(s);
}
function _wceRemoveColorTransitionCSS(){
  const s = document.getElementById('wce-color-transition-css');
  if(s) s.remove();
}
function _wceWireProfileTrigger(el, overlayId, clickFilter){
  const profiles = window.WCE_PROFILES||[];
  const matched = profiles.find(p=>p.mode==='canvas' && (p.triggerOverlayIds||[]).indexOf(overlayId)!==-1);
  if(matched){
    el.addEventListener('click', (ev)=>{ if(clickFilter && !clickFilter(ev)) return; _wceProfileClick(matched); });
  }
}
function _wceInitProfiles(){
  const profiles = window.WCE_PROFILES||[];
  document.querySelectorAll(SELECTABLE_SELECTOR).forEach(el=>{
    let matched = null;
    for(const p of profiles){
      const hit = (p.triggers||[]).some(t=>{
        const sel = (typeof t === 'string') ? t : t.selector;
        if(!sel) return false;
        try{ return el.matches(sel); }catch(e){ return false; }
      });
      if(hit){ matched = p; break; }
    }
    if(matched){
      const p = matched;
      el.addEventListener('click', ()=>_wceProfileClick(p));
    } else {
      el.addEventListener('click', ()=>{
        if(window._wceActiveProfile && window._wceActiveProfile.mode==='canvas') return;
        _wceRunTransition(applyGlobalPalette, 'fade');
      });
    }
  });
}
window._wceDesignerEditMode = window._wceDesignerEditMode !== undefined ? window._wceDesignerEditMode : !!window.WCE_DESIGNER_MODE;
function _wceApplyDesignerVisibility(){
  const forceShow = !!window._wceDesignerEditMode;
  [['anim', ['sa-ctrl','sa-combo','sa-builtin','sa-seq','sa-mat','sa-geo']], ['camera', ['sc-static','sc-turntable','sc-cinematic']], ['section', ['ssection']]].forEach(pair=>{
    const tabName = pair[0], sectionIds = pair[1];
    const isEmpty = sectionIds.every(id=>{
      const el=document.getElementById(id);
      return !el || !el.querySelector('button, select, .anim-btn, .cam-btn, .tt-btn, .cin-btn');
    });
    const tabBtn = document.querySelector('.tnb[data-tab="'+tabName+'"]');
    const tabPane = document.getElementById('tab-'+tabName);
    if(!tabBtn || !tabPane) return;
    const shouldHide = isEmpty && !forceShow;
    tabBtn.style.display = shouldHide ? 'none' : '';
    if(shouldHide && tabBtn.classList.contains('active')){
      tabBtn.classList.remove('active'); tabPane.classList.remove('active');
      const cfgBtn=document.querySelector('.tnb[data-tab="config"]'), cfgPane=document.getElementById('tab-config');
      if(cfgBtn) cfgBtn.classList.add('active');
      if(cfgPane) cfgPane.classList.add('active');
    }
  });
  const arBtn = document.getElementById('ar-btn');
  if(arBtn){
    var _isDesktopView = _wceDetectDeviceView() === 'desktop';
    var _arIosLive = (typeof window.WCE_DESIGNER_AR_IOS !== 'undefined') ? window.WCE_DESIGNER_AR_IOS : !!(CFG.ar && CFG.ar.ios_enabled);
    var _arAndroidLive = (typeof window.WCE_DESIGNER_AR_ANDROID !== 'undefined') ? window.WCE_DESIGNER_AR_ANDROID : !!(CFG.ar && CFG.ar.android_enabled);
    var _shouldForceShow = forceShow && !_isDesktopView && (_arIosLive || _arAndroidLive);
    if(_shouldForceShow) arBtn.style.display='flex';
    else if(arBtn.dataset.realArAvailable !== '1') arBtn.style.display='none';
  }
}
window._wceSetDesignerEditMode = function(on){
  window._wceDesignerEditMode = !!on;
  _wceApplyDesignerVisibility();
};
function _wceRootHost(){ return document.getElementById('wce-ui-canvas') || document.getElementById('wce-ui-stage') || document.body; }
function _wceIsIconOverlay(o){ return !!o && (o.type==='sound' || o.type==='viewtoggle' || ((o.type==='presentation' || o.type==='snapshot') && o.display==='icon')); }
function _wceIconShapeProps(o, eff){ return Object.assign({}, eff, {kind: undefined, image: undefined, color: o.color || '#1a1a1c'}); }
function _wceAltCapable(o){ return !!o && (o.type==='sound' || o.type==='viewtoggle' || (o.type==='presentation' && o.display==='icon')); }
function _wceAltSrc(o, alt){ return (alt && o.altStyle) ? Object.assign({}, o, o.altStyle) : o; }
function _wceIconKindFor(o, alt){
  if(o.type==='sound') return alt ? 'sound_off' : 'sound_on';
  if(o.type==='viewtoggle') return alt ? 'eye_off' : 'eye';
  if(o.type==='presentation') return alt ? 'close' : 'present';
  return 'snapshot';
}
function _wceDecorateIcon(el, o, sz){
  el.dataset.wceActionKind = o.type;
  el.title = o.label || (o.type==='sound' ? 'Toggle sound effects' : (o.type==='presentation' ? 'Presentation mode' : (o.type==='viewtoggle' ? 'Show / hide' : 'Take a snapshot')));
  const px = Math.round(sz * 0.5);
  let curAlt = false;
  const paint = function(alt){
    curAlt = !!alt && _wceAltCapable(o);
    const src = _wceAltSrc(o, curAlt);
    _wceApplyThumbShape(el, _wceIconShapeProps(src, _wceEffectiveThumbProps(src)));
    const ic = document.createElement('span');
    ic.className = 'wce-thumb-icon';
    ic.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;color:' + (src.iconColor || 'var(--text)');
    if(src.iconImage){
      const im = document.createElement('img');
      im.src = src.iconImage; im.alt = '';
      const ip = Math.round(sz * 0.62);
      im.style.cssText = 'width:' + ip + 'px;height:' + ip + 'px;object-fit:contain;pointer-events:none;-webkit-user-drag:none';
      ic.appendChild(im);
    } else {
      ic.innerHTML = WCEUIS.iconSvg(_wceIconKindFor(o, curAlt), px);
    }
    el.appendChild(ic);
  };
  el.__wcePaint = paint;
  el.__wceAlt = function(){ return curAlt; };
  el.__wceOverlay = o;
  if(o.type==='sound'){
    const sync = ()=>{ const off = !(window.WCE_SFX && window.WCE_SFX.isOn()); el.classList.toggle('off', off); paint(off); };
    sync();
    el.onclick = ()=>{ if(window.WCE_SFX) window.WCE_SFX.toggle(); sync(); };
    window.addEventListener('wce-sfx-toggle', sync);
  } else if(o.type==='presentation'){
    paint(_wcePresentationActive && _wcePresentationTriggerEl===el);
    el.onclick = ()=>{ _wcePresentationActive ? _wceExitPresentationMode() : _wceEnterPresentationMode(o, el); };
  } else if(o.type==='viewtoggle'){
    paint(!_wceViewToggleShown(o));
    if(!_wcePresentationActive){ el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; }
    el.onclick = ()=>_wceViewToggleClick(o);
  } else {
    paint(false);
    el.onclick = ()=>_wceTakeSnapshot();
  }
}
function _wceDetectDeviceView(){
  const forced = new URLSearchParams(window.location.search).get('wce_mobile_frame');
  if(forced === 'portrait') return 'mobileV';
  if(forced === 'horizontal') return 'mobileH';
  if(window.__wceUiView === 'mobileV' || window.__wceUiView === 'mobileH' || window.__wceUiView === 'desktop') return window.__wceUiView;
  const isTouch = window.matchMedia("(hover:none) and (pointer:coarse)").matches;
  if(!isTouch) return "desktop";
  return window.matchMedia("(orientation:landscape)").matches ? "mobileH" : "mobileV";
}
function _wceApplyDeviceOverrides(){
  const base = window.WCE_THEME || {};
  const view = _wceDetectDeviceView();
  const dev = base.deviceOverrides || {};
  const override = (view!=="desktop") ? dev[view] : null;
  const src = override || base;
  window.WCE_OVERLAYS = src.overlays || [];
  window.WCE_PROFILES = src.profiles || base.profiles || [];
  window.WCE_THUMBNAIL_GROUPS = src.thumbnailGroups || [];
  base.panelLayout = src.panelLayout || "tabs";
  base.chromeOverrides = src.chromeOverrides || {};
  base.globalThumbProps = src.globalThumbProps || base.globalThumbProps;
  base.panelHidden = (override ? override.panelHidden : base.panelHidden);
  base.startupProfileId = (override ? override.startupProfileId : base.startupProfileId);
  if(base.panelHiddenByDevice && base.panelHiddenByDevice[view] !== undefined) base.panelHidden = !!base.panelHiddenByDevice[view];
}
function _wceApplyStartupProfile(){
  const id = (window.WCE_THEME||{}).startupProfileId;
  const p = id && (window.WCE_PROFILES||[]).find(function(x){ return x.id===id; });
  if(p) applyProfile(p); else buildThumbnailOverlays();
}
let _wceOrientationListenerAttached = false;
function _wceAttachOrientationListener(){
  if(_wceOrientationListenerAttached) return;
  _wceOrientationListenerAttached = true;
  const mq = window.matchMedia("(orientation:landscape)");
  const onChange = function(){
    if(_wceDetectDeviceView()==="desktop") return;
    _wceApplyDeviceOverrides();
    if(window._wceActiveProfile && window._wceActiveProfile.__src) applyProfile(window._wceActiveProfile.__src);
    if(typeof buildThumbnailOverlays==="function") buildThumbnailOverlays();
    if(typeof _wceApplyChromeOverrides==="function") _wceApplyChromeOverrides();
    if(typeof _wceDeclutterOverlays==="function") _wceDeclutterOverlays();
    const pan = document.getElementById("panel"), ptab = document.getElementById("ptab");
    if(pan && ptab){
      const hidden = !!(window.WCE_THEME||{}).panelHidden;
      pan.style.display = hidden ? "none" : "";
      ptab.style.display = hidden ? "none" : "";
    }
  };
  if(mq.addEventListener) mq.addEventListener("change", onChange);
  else if(mq.addListener) mq.addListener(onChange);
}
function buildUI(){
  const _wceForcedMobile = new URLSearchParams(window.location.search).get('wce_mobile_frame');
  if(_wceForcedMobile === 'portrait') document.body.classList.add('wce-force-mobile-v');
  else if(_wceForcedMobile === 'horizontal') document.body.classList.add('wce-force-mobile-h');
  try{ WCEUIS.apply(window); }catch(e){}
  _wceApplyDeviceOverrides();
  _wceAttachOrientationListener();
  _wceAttachDeclutterResizeListener();
  buildVariants();buildGlobalSets();buildGeoPkgs();buildMatSubs();buildHDRISwitcher();buildFilterSwitcher();buildOceanSwitcher();buildSoundButtons();
  buildAdvGeo();buildAdvMat();buildAnimUI();buildSequenceUI();buildCameraUI();buildSectionViewUI();_wceApplyStartupProfile();if(typeof buildMatGeoAnimUI==='function') buildMatGeoAnimUI();
  _wceInitProfiles();
  document.getElementById('atb').addEventListener('click',()=>{
    const s=document.getElementById('as');s.classList.toggle('open');
    document.getElementById('aa').textContent=s.classList.contains('open')?'▴':'▾';
  });
  const ptab=document.getElementById('ptab'),pan=document.getElementById('panel');
  if((window.WCE_THEME||{}).panelHidden){pan.style.display='none';ptab.style.display='none';}
  ptab.onclick=()=>{pan.classList.toggle('closed');ptab.textContent=pan.classList.contains('closed')?'❮':'❯';};
  if(document.documentElement.classList.contains('wce-narrow')){pan.classList.add('closed');ptab.textContent='❮';}
  document.querySelectorAll('.tnb').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tnb').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
  const ccBtn=mk('button','at');
  ccBtn.id='force-refresh-btn';
  ccBtn.style.cssText='margin-top:30px;color:#c8a96e;border-color:var(--border)';
  ccBtn.innerHTML='↻ FORCE REFRESH';
  ccBtn.onclick=()=>{window.location.href=window.location.href.split('?')[0]+'?nocache='+Date.now();};
  document.getElementById('pb').appendChild(ccBtn);
  _wceApplyDesignerVisibility();
  _wceIndexStLabels();
  _wceApplyChromeOverrides();
  if(typeof _wceDeclutterOverlays==='function') _wceDeclutterOverlays();
}
function _wceIndexStLabels(){
  const parents = new Set();
  document.querySelectorAll('.st').forEach(function(el){ if(el.parentElement) parents.add(el.parentElement); });
  parents.forEach(function(parent){
    let i=0;
    Array.prototype.forEach.call(parent.children, function(child){
      if(child.classList.contains('st')){ child.dataset.stIdx = i; i++; }
    });
  });
}
function _wceApplyChromeOverrides(){
  const overrides = (window.WCE_THEME||{}).chromeOverrides || {};
  const isTextSel = function(s){ return s && (s === 'h1' || s === '#vl' || s === '#force-refresh-btn' || s === '#st' || s.indexOf('.st') !== -1 || s.indexOf('label[for=') !== -1 || s.indexOf('.hotspot-lbl') !== -1 || s.indexOf('.empty-note') !== -1); };
  Object.keys(overrides).forEach(function(sel){
    const entry = overrides[sel];
    const isText = isTextSel(sel);
    try{
      document.querySelectorAll(sel).forEach(function(el){
        el.style.display = entry.removed ? 'none' : '';
        if(entry.text !== undefined && entry.text !== null){
          if(isText){
            el.textContent = entry.text;
          } else {
            const existing = Array.prototype.find.call(el.childNodes, function(n){ return n.nodeType === 3; });
            if(existing) existing.textContent = entry.text;
            else el.insertBefore(document.createTextNode(entry.text), el.firstChild);
          }
        }
        if(entry.pos){
          el.style.left = entry.pos.x+'%'; el.style.top = entry.pos.y+'%';
          el.style.bottom = 'auto'; el.style.right = 'auto';
        }
      });
    }catch(e){}
  });
}
function buildAnimUI(){
  const overlaySet=_wceOverlaySet();
  const allCtrl=(CFG.animations||{}).controls||[];
  const controls=allCtrl.filter(d=>!d.builtin && !d.hidden_ui);
  const builtins=allCtrl.filter(d=>d.builtin);
  const combos=((CFG.animations||{}).combos||[]);
  const ctrlSec=document.getElementById('sa-ctrl');
  const comboSec=document.getElementById('sa-combo');
  const biSec=document.getElementById('sa-builtin');
  ctrlSec.innerHTML='<div class="st">Animation Controls</div>';
  if(controls.length){
    controls.forEach(def=>{
      if(def.trigger==='button'){
        const btn=mk('button','anim-btn');btn.dataset.anim=def.name;btn.dataset.animId=_wceDefId(def);
        btn.innerHTML=def.name.replace(/_/g,' ')+'<span class="anim-play-icon">▶</span>';
        btn.onclick=()=>triggerAnim(_wceDefId(def));ctrlSec.appendChild(btn);
      }else if(def.trigger==='hotspot'){
        const lbl=mk('div','hotspot-lbl');lbl.dataset.hotspotLabel=def.name;lbl.style.cssText='font-size:10px;color:var(--hot);padding:5px 0 5px 4px;letter-spacing:.1em';
        lbl.textContent='● '+def.name.replace(/_/g,' ')+'  [hotspot in scene]';ctrlSec.appendChild(lbl);
      }
    });
  }else{
    const p=mk('p','empty-note');p.dataset.note='anim-controls';p.style.cssText='font-size:10px;color:var(--muted);padding:6px 0';
    p.textContent='No animation controls exported.';ctrlSec.appendChild(p);
  }
  comboSec.innerHTML='<div class="st">Animation Combos</div>';
  if(combos.length){
    combos.forEach(def=>{
      if(def.trigger==='button'){
        const btn=mk('button','anim-btn');btn.dataset.anim=def.name;btn.dataset.animId=_wceDefId(def);
        const ms=(def.members||[]).join(' + ')||'—';
        btn.innerHTML=def.name.replace(/_/g,' ')+'<span class="anim-play-icon">▶</span>';
        btn.onclick=()=>triggerAnim(_wceDefId(def));comboSec.appendChild(btn);
      }else if(def.trigger==='hotspot'){
        const lbl=mk('div','hotspot-lbl');lbl.dataset.hotspotLabel=def.name;lbl.style.cssText='font-size:10px;color:var(--hot);padding:5px 0 5px 4px;letter-spacing:.1em';
        lbl.textContent='● '+def.name.replace(/_/g,' ')+'  [hotspot in scene]';comboSec.appendChild(lbl);
      }
    });
  }
  if(biSec){
    if(builtins.length){
      biSec.innerHTML='<div class="st">Special Effects</div>';
      builtins.forEach(def=>{
        if(def.trigger==='button'){
          const btn=mk('button','anim-btn');btn.dataset.anim=def.name;btn.dataset.animId=_wceDefId(def);
          btn.innerHTML=def.name.replace(/_/g,' ')+'<span class="anim-play-icon">▶</span>';
          btn.onclick=()=>triggerAnim(_wceDefId(def));biSec.appendChild(btn);
        }else if(def.trigger==='hotspot'){
          const lbl=mk('div','hotspot-lbl');lbl.dataset.hotspotLabel=def.name;lbl.style.cssText='font-size:10px;color:var(--hot);padding:5px 0 5px 4px;letter-spacing:.1em';
          lbl.textContent='● '+def.name.replace(/_/g,' ')+'  [hotspot in scene]';biSec.appendChild(lbl);
        }
      });
    }else{ biSec.innerHTML=''; }
  }
}
function _wceDefId(def){ return def.id || ((Array.isArray(def.members) ? 'combo:' : 'control:') + def.name); }
const _seqRunning = {};
function _fireStep(step) {
  const {action_type, action_name, target_state, target_name, target_uid, container_name, container_material, geo_toggle_chain} = step;
  if (action_type === 'flyto') {
    if (action_name) flyToCamera(action_name);
  } else if (action_type === 'mat_subset' || action_type === 'global_set') {
    const gset = (target_uid && (CFG.global_mat_sets||[]).find(x => x.uid === target_uid)) || (CFG.global_mat_sets||[]).find(x => x.name === target_name);
    const s = gset || (target_uid && (CFG.mat_subsets||[]).find(x => x.uid === target_uid)) || (CFG.mat_subsets||[]).find(x => x.name === target_name);
    if (s) {
      applyMatSubset(s.state, gset ? '__global_sets__' : s.category); refreshAdvMat(s.state);
      qsa('.gb').forEach(x=>x.classList.remove('active'));
      qsa('.pb2').forEach(x=>{ if(x.dataset.sc!==undefined) x.classList.remove('active'); });
      const btn = qsa('.gb').find(x=>x.dataset.gn===target_name) ||
                  qsa('.pb2').find(x=>x.dataset.mn===target_name);
      if (btn) btn.classList.add('active');
    }
  } else if (action_type === 'geo_subset') {
    const s = (CFG.geometry_subsets||[]).find(x => x.name === target_name);
    if (s) {
      applyGeoSubset(s.state);
      qsa('.pb2').forEach(x=>{ if(x.dataset.tp==='gp') x.classList.toggle('active', x.textContent===target_name); });
    }
  } else if (action_type === 'environment') {
    const item = (CFG.hdris||[]).find(x => x.name === target_name);
    if (item) {
      _loadHDRIItem(item);
      qsa('.pb2').forEach(x=>{ if(x.dataset.hf!==undefined) x.classList.toggle('active', x.dataset.name===item.name); });
    }
  } else if (action_type === 'filter') {
    const item = ((CFG.post_process&&CFG.post_process.filters)||[]).find(x => x.name === target_name);
    if (item && typeof _wceApplyPPFilter==='function') {
      _wceApplyPPFilter(item.filter_type, item.intensity, item);
      window._wceActivePPFilter=item.filter_type;
      qsa('.pb2').forEach(x=>{ if(x.dataset.pf!==undefined) x.classList.toggle('active', x.dataset.pfn===item.name); });
    }
  } else if (action_type === 'variant') {
    if (target_name && typeof applyVariant === 'function') applyVariant(target_name);
  } else if (action_type === 'ocean') {
    _wceSetOceanState(target_name);
  } else if (action_type === 'sound') {
    _wceSoundStep(target_name, step.sound_action);
  } else if (action_type === 'container') {
    if (container_name && container_material) {
      applyMat(container_name, container_material); matSt[container_name]=container_material; refreshAdvMat(matSt);
    }
  } else if (action_type === 'geo_variant') {
    (geo_toggle_chain||[]).forEach(gstep => {
      if (gstep.child && gstep.siblings && gstep.siblings.length) applyGeoToggle(gstep.child, gstep.siblings);
    });
  } else {
    if (action_name) flyToAnimState((action_type === 'combo' ? 'combo:' : 'control:') + action_name, target_state ?? 1);
  }
}
async function _runSteps(steps) {
  if (!steps || !steps.length) return;
  let i = 0;
    while (i < steps.length) {
      const group = [steps[i]];
      let j = i + 1;
      while (j < steps.length && steps[j].together) {
        group.push(steps[j]); j++;
      }
      const before = new Set(Object.keys(_segWatch));
      group.forEach(st => _fireStep(st));
      const newKeys = Object.keys(_segWatch).filter(k => !before.has(k));
      const hasFlyto = group.some(st => st.action_type === 'flyto');
      await new Promise(res => {
        if (newKeys.length === 0 && !hasFlyto) { setTimeout(res, 60); return; }
        const T0 = performance.now();
        const poll = () => {
          try {
            const animDone = newKeys.every(k => !_segWatch[k]);
            const flyDone = !hasFlyto || !window._isFlyActive();
            if ((animDone && flyDone) || performance.now() - T0 > 15000) { res(); return; }
          } catch(e) { res(); return; }
          setTimeout(poll, 30);
        };
        setTimeout(poll, 16);
      });
      i = j;
    }
}
window._runSteps = _runSteps;
async function executeSequence(seqName) {
  const seqs = (CFG.animations||{}).sequences || [];
  const seq  = seqs.find(s => s.name === seqName);
  if (!seq || !seq.steps || !seq.steps.length) return;
  if (_seqRunning[seqName]) return;
  _seqRunning[seqName] = true;
  try {
    await _runSteps(seq.steps);
  } finally {
    _seqRunning[seqName] = false;
  }
}
function buildSequenceUI() {
  const seqs = (CFG.animations||{}).sequences || [];
  if (!seqs.length) return;
  const overlaySet=_wceOverlaySet();
  const shown = seqs;
  let sec = document.getElementById('sa-seq');
  if (!sec) {
    const animTab = document.getElementById('tab-anim');
    if (!animTab) return;
    sec = mk('div', 'sec'); sec.id = 'sa-seq';
    animTab.appendChild(sec);
  }
  sec.innerHTML = '<div class="st">Sequences</div>';
  shown.forEach(seq => {
    const trigger = seq.trigger || 'button';
    if (trigger === 'button') {
      const btn = mk('button', 'anim-btn');
      btn.textContent = (seq.label || seq.name).replace(/_/g,' ');
      btn.dataset.seqName = seq.name;
      btn.onclick = () => executeSequence(seq.name);
      sec.appendChild(btn);
    } else if (trigger === 'hotspot') {
      const lbl = mk('div','hotspot-lbl'); lbl.dataset.hotspotLabel=seq.name;
      lbl.style.cssText = 'font-size:10px;color:var(--hot);padding:5px 0 5px 4px;letter-spacing:.1em';
      lbl.textContent = '● ' + seq.name.replace(/_/g,' ') + '  [hotspot in scene]';
      sec.appendChild(lbl);
    }
  });
  seqs.filter(s => s.trigger === 'hotspot' && s.hotspot_object).forEach(seq => {
    _registerHotspot(seq.hotspot_object, () => executeSequence(seq.name));
  });
}
function buildSectionViewUI(){
  const sec=document.getElementById('ssection');
  if(!sec) return;
  const keys=Object.keys(window._wceSectionAxes||{});
  if(!keys.length){ sec.innerHTML=''; return; }
  sec.innerHTML='<div class="st">Section View</div>';
  const order=['x','y','z'];
  order.filter(k=>window._wceSectionAxes[k]).forEach(axisKey=>{
    const ax=window._wceSectionAxes[axisKey];
    const row=mk('div','sr');
    const btn=mk('button','pb2 sec-axis-btn');
    btn.textContent=axisKey.toUpperCase();
    btn.dataset.axis=axisKey;
    if(ax.active) btn.classList.add('active');
    const slider=document.createElement('input');
    slider.type='range'; slider.min='0'; slider.max='100'; slider.step='0.5';
    slider.value=ax.position;
    slider.disabled=!ax.active;
    slider.className='sec-axis-slider';
    btn.onclick=()=>{
      ax.active=!ax.active;
      btn.classList.toggle('active', ax.active);
      slider.disabled=!ax.active;
      if(typeof window._wceSectionSetActive==='function') window._wceSectionSetActive(axisKey, ax.active);
    };
    row.appendChild(btn);
    slider.oninput=()=>{
      ax.position=parseFloat(slider.value);
      if(typeof window._wceSectionSetPosition==='function') window._wceSectionSetPosition(axisKey, ax.position);
    };
    row.appendChild(slider);
    sec.appendChild(row);
  });
}
function buildCameraUI(){
  const overlaySet=_wceOverlaySet();
  const staticList=(camCfg.static||[]);
  const tt=camCfg.turntable||{};
  const camSeqs=camCfg.camera_sequences||[];
  const staticSec=document.getElementById('sc-static');
  const ttSec=document.getElementById('sc-turntable');
  const cinSec=document.getElementById('sc-cinematic');
  staticSec.innerHTML = staticList.length ? '<div class="st">Scene Cameras</div>' : '';
  staticList.forEach(sc=>{
    const btn=mk('button','cam-btn');btn.dataset.cam=sc.name;
    btn.textContent=sc.name.replace(/_/g,' ');
    btn.onclick=()=>flyToCamera(sc.name);staticSec.appendChild(btn);
  });
  if(tt.enabled){
    ttSec.innerHTML='<div class="st">Turntable</div>';
    const btn=mk('button','tt-btn');btn.textContent='Auto Rotate';
    btn.onclick=()=>window._wceToggleTurntable();
    ttSec.appendChild(btn);
  } else {
    ttSec.innerHTML='';
  }
  cinSec.innerHTML = camSeqs.length ? '<div class="st">Camera Sequences</div>' : '';
  camSeqs.forEach(seq=>{
    const segDiv=mk('div');segDiv.style.cssText='font-size:9px;color:var(--muted);letter-spacing:.12em;margin-bottom:6px;line-height:1.9';
    segDiv.innerHTML='<b>'+(seq.label||seq.name).replace(/_/g,' ')+'</b><br>';
    (seq.segments||[]).forEach((s,i)=>{segDiv.innerHTML+=(i+1)+'. '+s.name.replace(/_/g,' ')+'<br>';});
    cinSec.appendChild(segDiv);
    if(seq.trigger==='button'){
      const btn=mk('button','cin-btn camseq-btn');btn.dataset.seq=seq.name;
      btn.innerHTML='<span>'+((seq.label||seq.name).toUpperCase().replace(/_/g,' '))+'</span>';
      btn.onclick=()=>(_camSeq[seq.name]&&_camSeq[seq.name].playing)?_stopCameraSequence(seq.name):_startCameraSequence(seq.name);
      cinSec.appendChild(btn);
    }else if(seq.trigger==='hotspot'){
      const lbl=mk('div','hotspot-lbl');lbl.dataset.hotspotLabel=seq.name;lbl.style.cssText='font-size:10px;color:var(--hot);padding:4px 0;letter-spacing:.1em';
      lbl.textContent='● Hotspot in scene starts '+(seq.label||seq.name).replace(/_/g,' ');cinSec.appendChild(lbl);
    }
    cinSec.appendChild(mk('div'));
  });
}
function _wceOverlayKey(o){
  if(!o.type && o.container && o.material) o.type='material';
  if(o.type==='material') return 'material::'+o.container+'::'+o.material;
  if(o.type==='geo_toggle') return 'geo_toggle::'+o.node;
  if(o.type==='hdri') return 'hdri::'+(o.uid || (o.item&&o.item.file));
  if(o.type==='mat_subset'||o.type==='global_set'||o.type==='geo_subset') return o.type+'::'+(o.uid||o.name);
  if(o.type==='turntable') return 'turntable::singleton';
  if(o.type==='cinematic') return 'cinematic::singleton';
  if(o.type==='camera_sequence') return 'camera_sequence::'+(o.name||'');
  if(o.type==='text' || o.type==='group' || o.type==='section_slider' || o.type==='color_selector' || o.type==='shape') return o.id || (o.type+'::'+Math.random().toString(36).slice(2));
  return o.type+'::'+o.name;
}
function _wceOverlaySet(){
  return new Set((window.WCE_OVERLAYS||[]).map(_wceOverlayKey));
}
function applyOverlay(o){
  if(!o.type && o.container && o.material) o.type='material';
  try{
    if(o.type==='material' && o.container && o.material){
      applyMat(o.container, o.material); matSt[o.container]=o.material; refreshAdvMat(matSt);
    } else if(o.type==='variant' && o.name){
      applyVariant(o.name);
    } else if(o.type==='mat_subset'||o.type==='global_set'){
      const gset=(o.uid && (CFG.global_mat_sets||[]).find(x=>x.uid===o.uid)) || (CFG.global_mat_sets||[]).find(x=>x.name===o.name);
      const s=gset || (o.uid && (CFG.mat_subsets||[]).find(x=>x.uid===o.uid)) || (CFG.mat_subsets||[]).find(x=>x.name===o.name) || (o.state ? {state:o.state} : null);
      if(s){ applyMatSubset(s.state, gset ? '__global_sets__' : s.category); refreshAdvMat(s.state); }
    } else if(o.type==='geo_subset'){
      const s=(o.uid && (CFG.geometry_subsets||[]).find(x=>x.uid===o.uid)) || (CFG.geometry_subsets||[]).find(x=>x.name===o.name) || (o.state ? {state:o.state} : null);
      if(s) applyGeoSubset(s.state);
    } else if(o.type==='geo_toggle' && o.node){
      applyGeoToggle(o.node, o.siblings||[]);
    } else if((o.type==='anim_control'||o.type==='anim_combo') && o.name){
      triggerAnim((o.type==='anim_combo' ? 'combo:' : 'control:') + o.name);
    } else if(o.type==='sequence' && o.name){
      executeSequence(o.name);
    } else if(o.type==='camera' && o.name){
      window._wceCamSel=o.name; flyToCamera(o.name);
    } else if(o.type==='turntable'){
      window._wceToggleTurntable();
    } else if(o.type==='cinematic'){
      (_camSeq['Cinematic']&&_camSeq['Cinematic'].playing) ? _stopCameraSequence('Cinematic') : _startCameraSequence('Cinematic');
    } else if(o.type==='camera_sequence' && o.name){
      (_camSeq[o.name]&&_camSeq[o.name].playing) ? _stopCameraSequence(o.name) : _startCameraSequence(o.name);
    } else if(o.type==='hdri'){
      const item=(o.uid && (CFG.hdris||[]).find(h=>h.uid===o.uid)) || (CFG.hdris||[]).find(h=>h.name===o.name) || o.item;
      if(item) _loadHDRIItem(item);
    } else if(o.type==='ocean_state'){
      _wceSetOceanState(o.name);
    } else if(o.type==='sound'){
      _wceSoundFireByName(o.name);
    } else if(o.type==='filter'){
      const fItem=((CFG.post_process&&CFG.post_process.filters)||[]).find(x=>x.name===o.name);
      if(fItem && typeof _wceApplyPPFilter==='function'){
        _wceApplyPPFilter(fItem.filter_type, fItem.intensity, fItem);
        window._wceActivePPFilter=fItem.filter_type;
        qsa('.pb2[data-pf]').forEach(x=>x.classList.toggle('active', x.dataset.pfn===fItem.name));
      }
    } else if(o.type==='mat_anim'||o.type==='geo_anim'){
      const mgKind=o.type==='mat_anim'?'MAT':'GEO';
      const mgList=mgKind==='MAT'?(CFG.mat_animations||[]):(CFG.geo_animations||[]);
      const mgDef=mgList.find(d=>d.source_key===o.name);
      if(mgDef){
        if(mgDef.play_mode==='step'){ if(typeof window._matGeoStep==='function') window._matGeoStep(mgKind, mgDef); }
        else if(typeof window.triggerMatGeoAnim==='function') window.triggerMatGeoAnim(mgKind, mgDef.source_key);
      }
    } else if(o.type==='presentation'){
      if(_wcePresentationActive){ _wceExitPresentationMode(); }
      else{ _wceEnterPresentationMode(o, document.querySelector('[data-overlay-id="'+o.id+'"]')); }
    } else if(o.type==='snapshot'){
      _wceTakeSnapshot();
    } else if(o.type==='media'){
      _wceOpenMedia(o.name);
    }
  }catch(e){ console.error('[WCE] overlay apply failed:', e); }
}
function buildVariants(){
  const keys=Object.keys(varData);if(!keys.length)return;
  const overlaySet=_wceOverlaySet();
  const sec=document.getElementById('sv');sec.innerHTML='<div class="st">Variants</div>';
  const g=mk('div','vg');
  keys.forEach(k=>{const b=mk('div','vc');b.dataset.v=k;b.textContent=k.replace(/_/g,' ');b.onclick=()=>applyVariant(k);g.appendChild(b);});
  sec.appendChild(g);
}
function buildGlobalSets(){
  const sets=CFG.global_mat_sets||[];if(!sets.length)return;
  const overlaySet=_wceOverlaySet();
  const sec=document.getElementById('sgs');sec.innerHTML='<div class="st">Full Configurations</div>';
  sets.forEach(s=>{
    const b=mk('button','gb');b.dataset.gn=s.name;b.textContent=s.name;
    b.onclick=()=>{activeV=null;qsa('.vc').forEach(x=>x.classList.remove('active'));applyMatSubset(s.state, '__global_sets__');qsa('.gb').forEach(x=>x.classList.remove('active'));qsa('.pb2[data-sc]').forEach(x=>x.classList.remove('active'));b.classList.add('active');refreshAdvMat(s.state);};
    sec.appendChild(b);
  });
}
function applyGeoToggle(colName,siblingNames){
  const sc=colName.replace(/ /g,'_');
  if(geoSt[sc]) return;
  const smooth=!!_TRANS.geometry;
  siblingNames.forEach(s=>{
    const n=findNode(s);
    const show=(s===sc);
    if(show) geoSt[s]=true; else delete geoSt[s];
    if(!n) return;
    if(smooth && root && root.visible){
      if(show && !n.visible) _geoDissolveNode(n,+1);
      else if(!show && n.visible) _geoDissolveNode(n,-1);
      else n.visible=show;
    } else {
      n.visible=show;
    }
  });
  refreshActive();
if(typeof _updateAnnotationVisibility==='function')_updateAnnotationVisibility();
_wceSyncGeoLinkedAreaLights();
}
function _wceSyncGeoLinkedAreaLights(){
  var _lights = (typeof window!=='undefined' && window._wceAreaLights) ? window._wceAreaLights : [];
  _lights.forEach(function(light){
    if(light.userData && light.userData.wceGeoChain && typeof window._wceRecomputeAreaLight==='function'){
      window._wceRecomputeAreaLight(light);
    }
  });
}
function applyGeoSubset(st){
  Object.entries(st).forEach(([parent,child])=>{
    let pN=CFG.geometry_exposed[parent]?parent:(CFG.geometry_exposed['GEOMETRIES_'+parent]?'GEOMETRIES_'+parent:null);
    const sib=pN&&CFG.geometry_exposed[pN]?CFG.geometry_exposed[pN].children.map(c=>c.name):[];
    applyGeoToggle(child.replace(/ /g,'_'),sib);
  });
  try{ window._wceGeoSubsetLast={sig:JSON.stringify(st), geo:_wceGeoSig()}; }catch(e){}
}
function buildAdvGeo(){
  const entries=Object.entries(CFG.geometry_exposed||{}).filter(([,t])=>!t.subset_only);
  const overlaySet=_wceOverlaySet();
  const sec=document.getElementById('sag');sec.innerHTML='<div class="st">Geometry Variants</div>';
  if(!entries.length){const p=mk('p','empty-note');p.dataset.note='geo-variants';p.style.cssText='font-size:10px;color:var(--muted);margin-top:4px';p.textContent='No geometry variants defined.';sec.appendChild(p);return;}
  entries.forEach(([pN,tree])=>{
    const allCh=(tree.children||[]).filter(c=>!c.name.toLowerCase().includes('common'));if(!allCh.length) return;
    const ch=allCh;
    if(!ch.length) return;
    const pf=(pN||'').replace(/[_]+$/,'')+'_';
    const fid='adv-geo-'+pN.replace(/[^a-z0-9]/gi,'-').toLowerCase();
    const row=mk('div','sr');const lbl=mk('label','sr-label');lbl.setAttribute('for',fid);lbl.textContent=pN.replace('GEOMETRIES_','').replace(/_/g,' ');row.appendChild(lbl);
    const sel=document.createElement('select');sel.id=fid;sel.innerHTML='<option value="">— select —</option>';
    ch.forEach(node=>{const o=document.createElement('option');o.value=node.name;const stripped=node.name.startsWith(pf)?node.name.slice(pf.length):node.name;o.textContent=stripped.replace(/_/g,' ')||node.name;sel.appendChild(o);});
    const cur=ch.find(c=>{const n=findNode(c.name);return n&&n.visible;});if(cur) sel.value=cur.name;
    sel.onchange=()=>{if(!sel.value)return;activeV=null;qsa('.vc').forEach(x=>x.classList.remove('active'));applyGeoToggle(sel.value,allCh.map(c=>c.name));};
    row.appendChild(sel);sec.appendChild(row);
  });
}
function buildGeoNode(container,children,depth,parentName){
  if(!children.length)return;
  const row=mk('div','tr');row.style.marginLeft=(depth*10)+'px';
  const pf=(parentName||'').replace(/[_]+$/,'')+'_';
  children.forEach(node=>{
    if(node.name.toLowerCase().includes('common'))return;
    const btn=mk('button','tb');btn.dataset.col=node.name;
    const stripped=node.name.startsWith(pf)?node.name.slice(pf.length):node.name;
    btn.textContent=stripped.replace(/_/g,' ')||node.name;
    btn.onclick=()=>{
      const sib=children.map(c=>c.name);applyGeoToggle(node.name,sib);
      row.querySelectorAll('.tb').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      container.querySelectorAll(`.nested-grp[data-depth="${depth}"]`).forEach(el=>el.classList.remove('open'));
      if(node.children?.length){
        const nid='ng-'+node.name.replace(/[^a-z0-9]/gi,'-');
        let nel=document.getElementById(nid);
        if(!nel){nel=mk('div','nested-grp');nel.id=nid;nel.dataset.depth=depth;buildGeoNode(nel,node.children,depth+1,node.name);container.appendChild(nel);}
        nel.classList.add('open');
      }
    };row.appendChild(btn);
  });container.appendChild(row);
}
function buildGeoPkgs(){
  const subs=CFG.geometry_subsets||[];if(!subs.length)return;
  const overlaySet=_wceOverlaySet();
  const sec=document.getElementById('sgp');sec.innerHTML='<div class="st">Packages</div>';
  const g=mk('div','pg');
  subs.forEach((s,i)=>{const b=mk('button','pb2');b.dataset.gi=i;b.dataset.tp='gp';b.textContent=s.name;
    b.onclick=()=>{activeV=null;qsa('.vc').forEach(x=>x.classList.remove('active'));applyGeoSubset(s.state);qsa('.pb2[data-tp="gp"]').forEach(x=>x.classList.remove('active'));b.classList.add('active');};g.appendChild(b);});
  sec.appendChild(g);
}
function buildMatSubs(){
  const subs=CFG.mat_subsets||[];if(!subs.length)return;
  const overlaySet=_wceOverlaySet();
  const byCat={};subs.forEach(s=>{(byCat[s.category]=byCat[s.category]||[]).push(s);});
  const sec=document.getElementById('sms');sec.innerHTML='';
  Object.entries(byCat).forEach(([cat,items])=>{
    const t=mk('div','st');t.textContent=cat;sec.appendChild(t);const g=mk('div','pg');
    items.forEach(s=>{const b=mk('button','pb2');b.dataset.sc=cat;b.dataset.mn=s.name;b.textContent=s.name;
      b.onclick=()=>{activeV=null;qsa('.vc').forEach(x=>x.classList.remove('active'));applyMatSubset(s.state, cat);qsa('.gb').forEach(x=>x.classList.remove('active'));qsa('.pb2[data-sc]').forEach(x=>x.classList.remove('active'));b.classList.add('active');refreshAdvMat(s.state);};g.appendChild(b);});
    sec.appendChild(g);
  });
}
function buildAdvMat(){refreshAdvMat({});}
function refreshAdvMat(state){
  _wceQueueThumbSync();
  const containers=CFG.containers||{};
  const overlaySet=_wceOverlaySet();
  const sec=document.getElementById('sam');sec.innerHTML='<div class="st">Individual Materials</div>';
  const allKeys=Object.keys(containers).filter(k=>containers[k]?.length);
  if(!allKeys.length){const p=mk('p','empty-note');p.dataset.note='material-containers';p.style.cssText='font-size:10px;color:var(--muted);margin-top:4px';p.textContent='No material containers defined.';sec.appendChild(p);return;}
  allKeys.forEach(c=>{
    const vals=containers[c];
    if(!vals.length) return;
    const fid='adv-mat-'+c.toLowerCase().replace(/[^a-z0-9]/g,'-');
    const row=mk('div','sr');const lbl=mk('label','sr-label');lbl.setAttribute('for',fid);lbl.textContent=c.replace(/_/g,' ');row.appendChild(lbl);
    const sel=document.createElement('select');sel.id=fid;sel.name=fid;sel.innerHTML='<option value="">— select —</option>';
    vals.forEach(v=>{const o=document.createElement('option');o.value=o.textContent=v;if(state[c]===v)o.selected=true;sel.appendChild(o);});
    sel.onchange=()=>{if(sel.value){activeV=null;qsa('.vc').forEach(x=>x.classList.remove('active'));applyMat(c,sel.value);matSt[c]=sel.value;_wceQueueThumbSync();}};
    row.appendChild(sel);sec.appendChild(row);
  });
}
function _wceShapeVertices(shape){
  switch(shape){
    case 'hexagon': return [[25,0],[75,0],[100,50],[75,100],[25,100],[0,50]];
    case 'pentagon': return [[50,0],[100,38],[82,100],[18,100],[0,38]];
    case 'octagon': return [[30,0],[70,0],[100,30],[100,70],[70,100],[30,100],[0,70],[0,30]];
    case 'diamond': return [[50,0],[100,50],[50,100],[0,50]];
    default: return null;
  }
}
function _wceRoundedPolygonPath(sizePx, vertsPct, radiusPx){
  const pts = vertsPct.map(p => [p[0]/100*sizePx, p[1]/100*sizePx]);
  const n = pts.length;
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const norm=v=>{ const l=Math.hypot(v[0],v[1])||1; return [v[0]/l,v[1]/l]; };
  let d='';
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n], curr=pts[i], next=pts[(i+1)%n];
    const v1=norm([curr[0]-prev[0],curr[1]-prev[1]]), v2=norm([next[0]-curr[0],next[1]-curr[1]]);
    const len1=dist(prev,curr), len2=dist(curr,next);
    const r=Math.max(0,Math.min(radiusPx,len1/2,len2/2));
    const p1=[curr[0]-v1[0]*r,curr[1]-v1[1]*r], p2=[curr[0]+v2[0]*r,curr[1]+v2[1]*r];
    d += (i===0?'M ':'L ')+p1[0].toFixed(2)+' '+p1[1].toFixed(2)+' ';
    d += 'Q '+curr[0].toFixed(2)+' '+curr[1].toFixed(2)+' '+p2[0].toFixed(2)+' '+p2[1].toFixed(2)+' ';
  }
  return d+'Z';
}
const THUMB_GROUP_PROPS = ['size','shape','radius','borderWidth','borderColor','color','imageScale','opacity'];
const THUMB_GROUP_STYLE_PROPS = ['size','shape','radius','borderWidth','borderColor','opacity'];
function _wceEffectiveThumbProps(o){
  let merged = Object.assign({}, o);
  if(o.styleGroupId){
    const props = o.styleGroupId==='__global__' ? (window.WCE_THEME||{}).globalThumbProps :
      ((window.WCE_THUMBNAIL_GROUPS||[]).find(g=>g.id===o.styleGroupId)||{}).props;
    if(props){
      THUMB_GROUP_STYLE_PROPS.forEach(k=>{ if(merged[k]===undefined && props[k]!==undefined) merged[k]=props[k]; });
    }
  }
  const activeProfile = window._wceActiveProfile;
  if(activeProfile && activeProfile.thumbnails && activeProfile.thumbnails[o.id]){
    const override = activeProfile.thumbnails[o.id];
    if(activeProfile.mode==='canvas'){
      THUMB_GROUP_PROPS.forEach(k=>{ if(override[k]!==undefined) merged[k]=override[k]; });
    } else {
      THUMB_GROUP_PROPS.forEach(k=>{ if(o[k]===undefined && override[k]!==undefined) merged[k]=override[k]; });
    }
  }
  return merged;
}
function _wceEffectiveTextProps(o){
  let merged = Object.assign({}, o);
  const activeProfile = window._wceActiveProfile;
  if(activeProfile && activeProfile.textOverrides && activeProfile.textOverrides[o.id]){
    const override = activeProfile.textOverrides[o.id];
    if(activeProfile.mode==='canvas'){
      Object.keys(override).forEach(k=>{ merged[k]=override[k]; });
    } else {
      Object.keys(override).forEach(k=>{ if(o[k]===undefined) merged[k]=override[k]; });
    }
  }
  return merged;
}
function _wceEffectiveGroupProps(g){
  let merged = Object.assign({}, g);
  const activeProfile = window._wceActiveProfile;
  if(activeProfile && activeProfile.groupOverrides && activeProfile.groupOverrides[g.id]){
    const override = activeProfile.groupOverrides[g.id];
    if(activeProfile.mode==='canvas'){
      Object.keys(override).forEach(k=>{ merged[k]=override[k]; });
    } else {
      Object.keys(override).forEach(k=>{ if(g[k]===undefined) merged[k]=override[k]; });
    }
  }
  return merged;
}
function _wceApplyThumbShape(el, o0){
  const o = _wceEffectiveThumbProps(o0);
  el.innerHTML = '';
  if(o.emptied){
    el.style.display = 'none';
    return;
  }
  WCEG.paintThumb(el, o);
}
function _wceApplyGroupStyle(el, g){
  const header=el.querySelector('.wce-group-header');
  const body=el.querySelector('.wce-group-body');
  const label=el.querySelector('.wce-group-label');
  if(header){
    header.style.background=_wceHexToRgba(g.tabBg||'#1a1a1c', (g.tabBgOpacity!=null?g.tabBgOpacity:100)/100);
    header.style.borderColor=g.tabBorderColor||'#444444';
    header.style.borderWidth=(g.tabBorderWidth!=null?g.tabBorderWidth:1)+'px';
    header.style.borderStyle='solid';
    header.style.borderRadius=(g.tabRadius!=null?g.tabRadius:0)+'px';
  }
  if(body){
    body.style.background=_wceHexToRgba(g.shelfBg||'#1a1a1c', (g.shelfBgOpacity!=null?g.shelfBgOpacity:100)/100);
    body.style.borderColor=g.shelfBorderColor||'#444444';
    body.style.borderWidth=(g.shelfBorderWidth!=null?g.shelfBorderWidth:1)+'px';
    body.style.borderStyle='solid';
    body.style.borderRadius=(g.shelfRadius!=null?g.shelfRadius:0)+'px';
  }
  if(label){
    label.style.fontFamily=g.titleFont?("'"+g.titleFont+"',sans-serif"):'';
    label.style.fontSize=(g.titleFontSize||13)+'px';
    label.style.color=g.titleColor||'';
  }
  WCEG.groupExtras(el, g);
}
function _wceApplyGroupCollapse(el, g){
  const body = el.querySelector('.wce-group-body');
  const header = el.querySelector('.wce-group-header');
  if(!body || !header) return;
  const collapsed = !!g.collapsed;
  const dir = g.direction || 'vertical';
  const isHoriz = (dir==='horizontal' || dir==='reverse-horizontal');
  const isReverse = (dir==='reverse-horizontal' || dir==='reverse-vertical');
  const dirChanged = el.dataset.wceDir !== dir;
  el.dataset.wceDir = dir;
  if(dirChanged){
    header.style.writingMode=''; header.style.transform='';
    header.style.width=''; header.style.height=''; header.style.flexShrink='';
    el.style.display=''; el.style.flexDirection=''; el.style.transform='';
    body.style.width=''; body.style.position=''; body.style.left=''; body.style.top=''; body.style.right=''; body.style.bottom='';
    if(isHoriz){
      el.style.display='flex';
      el.style.flexDirection = isReverse ? 'row-reverse' : 'row';
      el.style.width='auto';
      header.style.flexShrink='0'; header.style.width='32px';
      header.style.writingMode='vertical-rl'; header.style.transform='rotate(180deg)';
      if(isReverse){
        el.style.transform = 'translateX(-100%)';
      }
    } else if(isReverse){
      el.style.display='flex';
      el.style.flexDirection='column-reverse';
      el.style.transform = 'translateY(-100%)';
    }
  }
  if(isHoriz){
    const label=header.querySelector('.wce-group-label');
    let naturalLen=g.height||140;
    if(label){
      const clone=label.cloneNode(true);
      clone.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;writing-mode:horizontal-tb;transform:none;left:-9999px';
      header.appendChild(clone);
      naturalLen=Math.max(g.height||140, clone.scrollWidth+40);
      header.removeChild(clone);
    }
    header.style.height=naturalLen+'px';
    header.style.width=Math.max(32,(g.arrowSize!=null?g.arrowSize:9)+18)+'px';
    body.style.height=naturalLen+'px';
    body.style.width=collapsed?'0px':(g.width||180)+'px';
  } else {
    el.style.width=(g.width||180)+'px';
    body.style.height=collapsed?'0px':(g.height||140)+'px';
  }
  WCEG.scheduleRefresh(el);
  const _orient = WCEG.headerArrowOrient(dir, collapsed);
  const _deg = {h:0, v:90, rh:180, rv:270}[_orient] || 0;
  const _arrowEl = el.querySelector('.wce-group-arrow');
  const _hdrShapeEl = el.querySelector('.wce-group-hdrshape');
  if(_arrowEl){ _arrowEl.textContent = '▸'; _arrowEl.style.transform = 'rotate('+_deg+'deg)'; }
  if(_hdrShapeEl) _hdrShapeEl.style.transform = 'rotate('+_deg+'deg)';
}
let _wceGroupArrowDelegationAttached = false;
function _wceAttachGroupArrowDelegation(){
  if(_wceGroupArrowDelegationAttached) return;
  _wceGroupArrowDelegationAttached = true;
  document.body.addEventListener('click', function(ev){
    const hit = ev.target.closest('.wce-group-arrow, .wce-group-hdrshape');
    if(!hit) return;
    ev.stopPropagation();
    if(window.__wceMode && window.__wceMode !== 'live') return;
    const groupEl = hit.closest('.wce-overlay-group');
    if(!groupEl) return;
    const gid = groupEl.dataset.overlayId;
    const g = _wceLiveOverlay(gid);
    if(!g || g.expandTrigger === "none") return;
    g.collapsed = !g.collapsed;
    _wceApplyGroupCollapse(groupEl, g);
  }, true);
}
function _wceThumbCategoryStyle(o){
  const t=o.type;
  if(t==='camera'||t==='turntable'||t==='cinematic'||t==='camera_sequence') return {color:'var(--cam)',bg:'#100a18'};
  if(t==='geo_toggle') return {color:'var(--a2)',bg:'#080f1e'};
  if(t==='mat_subset'||t==='geo_subset'||t==='hdri'||t==='filter'||t==='material') return {color:'var(--ok)',bg:'#071410'};
  return {color:'var(--accent)',bg:'#161208'};
}
function _wceHlGroups(){
  const base=window.WCE_THEME||{};
  let src=base;
  try{
    const v=_wceDetectDeviceView(); const ov=(base.deviceOverrides||{})[v];
    if(v!=='desktop' && ov) src=ov;
  }catch(e){}
  return src.highlightGroups || base.highlightGroups || [];
}
function _wceApplyLitVars(el, o){
  const cat=_wceThumbCategoryStyle(o);
  el.style.setProperty('--wce-thumb-active-color', cat.color);
  el.style.setProperty('--wce-thumb-active-bg', cat.bg);
  el.style.removeProperty('--wce-lit-glow'); el.style.removeProperty('--wce-lit-glow-r');
  if(!o || !o.hlGroupId) return;
  const g=_wceHlGroups().find(x=>x.id===o.hlGroupId);
  if(!g) return;
  if(g.color) el.style.setProperty('--wce-thumb-active-color', g.color);
  if(g.glow){
    el.style.setProperty('--wce-lit-glow', g.glowColor || 'var(--wce-thumb-active-color)');
    el.style.setProperty('--wce-lit-glow-r', (g.glowSize!=null ? g.glowSize : 14)+'px');
  }
}
function _wceCamAtName(name){
  try{
    const def=((typeof camCfg!=='undefined' && camCfg && camCfg.static)||[]).find(c=>c.name===name);
    const c=window.cam, t=window._wceCtrl;
    if(!def || !def.position || !c) return false;
    const gap=(a,b)=>Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    if(gap([c.position.x,c.position.y,c.position.z], def.position) > 0.01) return false;
    const locked=def.lock ? def.lock!=='free' : !!def.lock_tumble_pan;
    if(!locked && def.target && t && t.target && gap([t.target.x,t.target.y,t.target.z], def.target) > 0.01) return false;
    return true;
  }catch(e){ return false; }
}
let _wceThumbPoll=null;
function _wceStartThumbPoll(){
  if(_wceThumbPoll) return;
  _wceThumbPoll=setInterval(()=>{
    if(document.hidden) return;
    try{ _wceSyncThumbHighlights(); }catch(e){}
    try{ _wceUpdateCalculators(); }catch(e){}
    try{ _wceSyncPanelHighlights(); }catch(e){}
  }, 200);
}
function _wceThumbCovered(o){
  if(!o.type && o.container && o.material) o.type='material';
  const t=o.type;
  const ms=(typeof matSt!=='undefined' && matSt) || {};
  const gs=(typeof geoSt!=='undefined' && geoSt) || {};
  const gk=v=>String(v).replace(/ /g,'_');
  const allMat=st=>{ const e=Object.entries(st||{}); return e.length>0 && (e.every(([c,m])=>ms[c]===m || ms[c]===_wceWantMat(c,m)) || _wceMatSetSticky(st)); };
  const allGeo=st=>{ const e=Object.entries(st||{}); return e.length>0 && e.every(([p,c])=>!!gs[gk(c)]); };
  if(t==='material') return !!(o.container && o.material && ms[o.container]===o.material);
  if(t==='geo_toggle') return !!(o.node && gs[gk(o.node)]);
  if(t==='mat_subset' || t==='global_set'){
    const gset=(o.uid && (CFG.global_mat_sets||[]).find(x=>x.uid===o.uid)) || (CFG.global_mat_sets||[]).find(x=>x.name===o.name);
    const s=gset || (o.uid && (CFG.mat_subsets||[]).find(x=>x.uid===o.uid)) || (CFG.mat_subsets||[]).find(x=>x.name===o.name) || (o.state ? {state:o.state} : null);
    return !!s && allMat(s.state);
  }
  if(t==='geo_subset'){
    const s=(o.uid && (CFG.geometry_subsets||[]).find(x=>x.uid===o.uid)) || (CFG.geometry_subsets||[]).find(x=>x.name===o.name) || (o.state ? {state:o.state} : null);
    return !!s && (allGeo(s.state) || _wceGeoSubsetSticky(s.state));
  }
  if(t==='variant'){
    const d=(typeof varData!=='undefined' && varData) ? varData[o.name] : null;
    if(!d) return false;
    const SKIP=['CAMERA_SETTINGS','MAT_SUBSETS','GLOBAL_MAT_SETS','GEO_SETS','LIGHTS','ENVIRONMENTS'];
    const exposed=CFG.geometry_exposed||{};
    let n=0, ok=true;
    Object.entries(d).forEach(([k,v])=>{
      if(!ok || typeof v!=='string' || !v || v==='NONE') return;
      if(k.startsWith('GEOMETRIES_')){ if(!exposed[k]) return; n++; if(!gs[gk(v)]) ok=false; }
      else if(!SKIP.includes(k)){ n++; if(ms[k]!==v && ms[k]!==_wceWantMat(k,v)) ok=false; }
    });
    return (ok && n>0) || _wceVariantSticky(o.name);
  }
  if(t==='hdri'){
    const list=CFG.hdris||[];
    const item=(o.uid && list.find(h=>h.uid===o.uid)) || list.find(h=>h.name===o.name) || o.item;
    if(!item) return false;
    if(window._wceEnvSel!==undefined) return window._wceEnvSel===(item.uid||item.name);
    return !!item.default;
  }
  if(t==='camera') return _wceCamAtName(o.name) || (window._wceCamSel===o.name && !!(window._isFlyActive && window._isFlyActive()));
  if(t==='sequence') return !!(o.name && _seqRunning[o.name]);
  if(t==='cinematic') return !!(_camSeq['Cinematic'] && _camSeq['Cinematic'].playing);
  if(t==='camera_sequence') return !!(o.name && _camSeq[o.name] && _camSeq[o.name].playing);
  if(t==='turntable') return !!window._turntableActive;
  if(t==='ocean_state') return _wceOceanStateIs(o.name);
  if(t==='sound') return _wceSoundIsOnByName(o.name);
  if(t==='filter'){
    const f=((CFG.post_process&&CFG.post_process.filters)||[]).find(x=>x.name===o.name);
    return !!f && (window._wceActivePPFilterName!==undefined ? window._wceActivePPFilterName===f.name : window._wceActivePPFilter===f.filter_type);
  }
  if(t==='anim_control' || t==='anim_combo'){
    const def=(typeof _animDefByRef==='function') ? _animDefByRef((t==='anim_combo' ? 'combo:' : 'control:') + o.name) : null;
    if(!def) return null;
    const id=_wceDefId(def), isCombo=Array.isArray(def.members);
    if(def.builtin==='hover') return !!(window._builtinActive && window._builtinActive.Hover);
    if(def.anim_type==='GEO_FLICKER') return !!(window._geoFlickerTimers && window._geoFlickerTimers[def.name]);
    if(def.anim_type==='GEO_TOGGLE') return ((window.animState||{})[def.name]||0)>0;
    const bk=window._animBtnKeys||{}, kp=window._keepPlayingActive||{}, w=window._segWatch||{};
    const busy=v=>!!(v && (v.size!==undefined ? v.size : v.length)>0);
    const keyOf=n=>{ try{ return _resolveAnimKey(n); }catch(e){ return n; } };
    if(kp[id] || busy(bk[id])) return true;
    if(!isCombo) return !!w[keyOf(def.name)];
    return def.members.some(n=>{
      const md=_animDefByRef('control:'+n), mid=md ? _wceDefId(md) : 'control:'+n;
      if(kp[mid]) return false;
      return !!w[keyOf(n)] || busy(bk[mid]);
    });
  }
  if(t==='mat_anim' || t==='geo_anim'){
    const list=t==='mat_anim' ? (CFG.mat_animations||[]) : (CFG.geo_animations||[]);
    const def=list.find(d=>d.source_key===o.name);
    if(!def || def.play_mode==='step' || !window._matGeoActive) return null;
    return !!window._matGeoActive[def.source_key];
  }
  if(t==='toggle'){
    const res=window._wceResolveToggleState, states=o.states||[];
    if(typeof res!=='function' || !states.length) return null;
    let tracked=false, any=false;
    states.forEach(st=>{ try{ const r=res(st); const c=r ? _wceThumbCovered(r) : null; if(c!==null){ tracked=true; if(c) any=true; } }catch(e){} });
    return tracked ? any : null;
  }
  return null;
}
function _wceSyncThumbHighlights(){
  if(window._wceDesignerEditMode) return;
  const list=(typeof _wceEffectiveOverlays==='function') ? _wceEffectiveOverlays() : (window.WCE_OVERLAYS||[]);
  list.forEach(o=>{
    try{
      if(!o || !o.id) return;
      const hit=_wceThumbCovered(o);
      if(hit===null) return;
      const el=document.querySelector('[data-overlay-id="'+o.id+'"]');
      if(el && el.classList.contains('wce-overlay-thumb')) el.classList.toggle('active', hit);
    }catch(e){}
  });
}
let _wceThumbSyncTimer=null;
function _wceQueueThumbSync(){
  if(_wceThumbSyncTimer) return;
  _wceThumbSyncTimer=setTimeout(()=>{ _wceThumbSyncTimer=null; _wceSyncThumbHighlights(); try{ _wceUpdateCalculators(); }catch(e){} try{ _wceSyncPanelHighlights(); }catch(e){} },0);
}
function buildThumbnailOverlays(){
  _wceBuildThumbnailOverlaysCore();
  try{ WCEUIS.applyStacking(document, _wceEffectiveOverlays()); }catch(e){}
  try{ WCEUIS.applyHover(document, _wceEffectiveOverlays()); }catch(e){}
  _wceSyncThumbHighlights();
  try{ _wceUpdateCalculators(); }catch(e){}
  try{ _wceSyncPanelHighlights(); }catch(e){}
  _wceStartThumbPoll();
}
function _wceBuildThumbnailOverlaysCore(){
  document.querySelectorAll('.wce-overlay-thumb,.wce-overlay-text,.wce-overlay-group,.wce-overlay-shape,.wce-overlay-section-slider,.wce-overlay-color-selector,.wce-overlay-action-btn').forEach(el=>el.remove());
  const list=_wceEffectiveOverlays();
  const _wceLoadedFonts={};
  function _wceEnsureFontLoaded(fam){
    const key=fam.trim().toLowerCase();
    if(_wceLoadedFonts[key]) return;
    _wceLoadedFonts[key]=true;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='https://fonts.googleapis.com/css2?family='+fam.trim().replace(/ /g,'+')+':wght@300;400;500;600;700&display=swap';
    document.head.appendChild(link);
  }
  const groupEls={};
  const groupHeaderEls={};
  function _wceRenderGroup(g, forceRoot){
    WCEG.ensureHeaderChildren(g, list);
    const el=mk('div','wce-overlay-group');
    el.dataset.overlayId=g.id;
    el.style.left=g.x+'%'; el.style.top=g.y+'%';
    el.innerHTML=WCEG.groupInnerHTML(g);
    const geff=_wceEffectiveGroupProps(g);
    _wceApplyGroupCollapse(el, g);
    _wceApplyGroupStyle(el, geff);
    if(geff.titleFont) _wceEnsureFontLoaded(geff.titleFont);
    _wceWireProfileTrigger(el, g.id);
    (forceRoot ? _wceRootHost() : hostFor(g)).appendChild(el);
    groupEls[g.id]=WCEG.groupHost(el);
    groupHeaderEls[g.id]=WCEG.groupHeaderHost(el);
    WCEG.scheduleRefresh(el);
    const _collapseClicksLive = () => !window.__wceMode || window.__wceMode === 'live';
    if(g.expandTrigger==='hover'){
      el.addEventListener('mouseenter',()=>{
        if(!_collapseClicksLive()) return;
        if(g.collapsed){ g.collapsed=false; _wceApplyGroupCollapse(el, g); }
      });
      el.addEventListener('mouseleave',()=>{
        if(!_collapseClicksLive()) return;
        if(!g.collapsed){ g.collapsed=true; _wceApplyGroupCollapse(el, g); }
      });
    } else if(g.expandTrigger==='header'){
      const _hdr=el.querySelector('.wce-group-header');
      if(_hdr){
        _hdr.style.cursor='pointer';
        _hdr.addEventListener('click',()=>{
          if(!_collapseClicksLive()) return;
          g.collapsed=!g.collapsed; _wceApplyGroupCollapse(el, g);
        });
      }
    }
  }
  function hostFor(o){
    if(o.headerRole && o.groupId && groupHeaderEls[o.groupId]) return groupHeaderEls[o.groupId];
    return (o.groupId && groupEls[o.groupId]) || _wceRootHost();
  }
  function _wceRenderShape(s, forceRoot){
    const el=WCEG.buildShape(document, s);
    el.style.left=(s.x??10)+'%'; el.style.top=(s.y??10)+'%';
    if((window.WCE_PROFILES||[]).some(p=>p.mode==='canvas' && (p.triggerOverlayIds||[]).indexOf(s.id)!==-1)){
      el.style.pointerEvents='auto'; el.style.cursor='pointer';
      const _content=WCEG.shapeHost(el);
      _wceWireProfileTrigger(el, s.id, ev=>ev.target===el || ev.target===_content);
    }
    if(s.link){ el.classList.add('wce-overlay-linked'); el.addEventListener('click', ev=>{ if(el.contains(ev.target)) window.open(s.link, '_blank'); }); }
    if(s.headerRole==='arrow' && s.groupId){
      el.style.pointerEvents='auto'; el.style.cursor='pointer';
      el.addEventListener('click', function(ev){
        ev.stopPropagation();
        const pg=_wceLiveOverlay(s.groupId);
        if(!pg || pg.expandTrigger==="none") return;
        pg.collapsed=!pg.collapsed;
        const pgEl=document.querySelector('[data-overlay-id="'+pg.id+'"]');
        if(pgEl) _wceApplyGroupCollapse(pgEl, pg);
      });
    }
    (forceRoot ? _wceRootHost() : hostFor(s)).appendChild(el);
    groupEls[s.id]=WCEG.shapeHost(el);
  }
  (function(){
    const conts=list.filter(o=>o.type==='group' || o.type==='shape');
    const known=new Set(conts.map(c=>c.id));
    const draw=(c,forceRoot)=>{ if(c.type==='group') _wceRenderGroup(c,forceRoot); else _wceRenderShape(c,forceRoot); };
    let pending=conts.slice(), rounds=conts.length+1;
    while(pending.length && rounds-- > 0){
      const later=[];
      pending.forEach(c=>{
        if(c.groupId && known.has(c.groupId) && !groupEls[c.groupId]) later.push(c); else draw(c,false);
      });
      if(later.length===pending.length){ later.forEach(c=>draw(c,true)); break; }
      pending=later;
    }
  })();
  _wceAttachGroupArrowDelegation();
  list.filter(o=>o.type==='text').forEach(o0=>{
    const o=_wceEffectiveTextProps(o0);
    const el=mk('div','wce-overlay-text');
    el.dataset.overlayId=o0.id;
    el.textContent=o.label||'';
    if(o.calc){ _wceCalcInit(el,o); }
    el.style.color=o.color||'#ffffff';
    el.style.fontSize=(o.fontSize||13)+'px';
    if(o.fontFamily){ el.style.fontFamily=`'${o.fontFamily}',sans-serif`; _wceEnsureFontLoaded(o.fontFamily); }
    el.style.left=o0.x+'%'; el.style.top=o0.y+'%';
    el.style.transform=o0.rotation?'rotate('+o0.rotation+'deg)':'';
    if(o.link){
      el.classList.add('wce-overlay-linked');
      el.addEventListener('click', ()=>window.open(o.link, '_blank'));
    }
    _wceWireProfileTrigger(el, o0.id);
    hostFor(o).appendChild(el);
  });
  function _wceResolveToggleState(st){
    if(!st || !st.type) return null;
    if(st.type==='camera'||st.type==='anim_control'||st.type==='anim_combo'||st.type==='sequence'||st.type==='camera_sequence'||st.type==='variant'||st.type==='filter'||st.type==='mat_anim'||st.type==='geo_anim'){
      return {type:st.type, name:st.target};
    }
    if(st.type==='hdri'){
      const item=(st.targetUid && (CFG.hdris||[]).find(h=>h.uid===st.targetUid)) || (CFG.hdris||[]).find(h=>h.name===st.target || h.file===st.target);
      return item ? {type:'hdri', item} : null;
    }
    if(st.type==='mat_subset'||st.type==='global_set'){
      const pool=(CFG.mat_subsets||[]).concat(CFG.global_mat_sets||[]);
      const s=(st.targetUid && pool.find(x=>x.uid===st.targetUid)) || pool.find(x=>x.name===st.target);
      return s ? {type:st.type, state:s.state} : null;
    }
    if(st.type==='geo_subset'){
      const s=(st.targetUid && (CFG.geometry_subsets||[]).find(x=>x.uid===st.targetUid)) || (CFG.geometry_subsets||[]).find(x=>x.name===st.target);
      return s ? {type:'geo_subset', state:s.state} : null;
    }
    if(st.type==='material'){
      const parts=String(st.target||'').split('::');
      if(parts.length<2) return null;
      return {type:'material', container:parts[0], material:parts.slice(1).join('::')};
    }
    if(st.type==='geo_toggle'){
      let sib=null;
      Object.keys(CFG.geometry_exposed||{}).forEach(function(pn){
        const tree=CFG.geometry_exposed[pn];
        if(!tree||tree.subset_only||sib) return;
        const ch=(tree.children||[]).filter(function(c){ return c.name.toLowerCase().indexOf('common')===-1; });
        if(ch.some(function(c){ return c.name===st.target; })) sib=ch.map(function(c){ return c.name; });
      });
      return sib ? {type:'geo_toggle', node:st.target, siblings:sib} : null;
    }
    if(st.type==='turntable'||st.type==='cinematic'){
      return {type:st.type};
    }
    return null;
  }
  window._wceResolveToggleState=_wceResolveToggleState;
  function _wceShowTogglePicker(o, el, states){
    const existing=document.getElementById('wce-toggle-picker');
    if(existing) existing.remove();
    const rect=el.getBoundingClientRect();
    const pop=document.createElement('div');
    pop.id='wce-toggle-picker';
    const _dpTheme=(window.WCE_THEME&&window.WCE_THEME.dropdownPicker)||{};
    const _dpBg=_wceHexToRgba(_dpTheme.bgColor||'#0a0a0c', 0.95), _dpBorder=_dpTheme.borderColor||'#c8a96e';
    pop.style.cssText='position:fixed;z-index:10002;background:'+_dpBg+';border:1px solid '+_dpBorder+';border-radius:4px;padding:6px;min-width:120px;overflow-y:auto;box-sizing:border-box';
    pop.style.left=rect.left+'px';
    pop.style.top=(rect.bottom+6)+'px';
    states.forEach((st,i)=>{
      const item=document.createElement('div');
      item.textContent=st.label || st.target || ('Option '+(i+1));
      item.style.cssText='padding:6px 10px;cursor:pointer;color:#fff;font-size:13px;border-radius:2px';
      item.addEventListener('mouseenter',()=>{ item.style.background='rgba(255,255,255,.1)'; });
      item.addEventListener('mouseleave',()=>{ item.style.background=''; });
      item.addEventListener('click',(e)=>{
        e.stopPropagation();
        o.activeIndex=i;
        const resolved=_wceResolveToggleState(st);
        if(resolved) applyOverlay(resolved);
        pop.remove();
        buildThumbnailOverlays();
      });
      pop.appendChild(item);
    });
    document.body.appendChild(pop);
    const _uiS = window.__wceUiScale || 1;
    if(_uiS !== 1){ pop.style.transformOrigin = '0 0'; pop.style.transform = 'scale(' + _uiS + ')'; }
    (function(){
      const pad=8, vw=window.innerWidth, vh=window.innerHeight;
      pop.style.maxHeight=(Math.max(120,vh-2*pad)/_uiS)+'px';
      const pr=pop.getBoundingClientRect();
      const below=vh-rect.bottom-pad-6, above=rect.top-pad-6;
      const openUp = pr.height>below && above>below;
      const avail=Math.max(120, openUp?above:below);
      const h=Math.min(pr.height, avail);
      pop.style.maxHeight=(h/_uiS)+'px';
      pop.style.top=(openUp ? Math.max(pad, rect.top-6-h) : rect.bottom+6)+'px';
      pop.style.left=Math.max(pad, Math.min(rect.left, vw-pr.width-pad))+'px';
    })();
    const closeHandler=(e)=>{
      if(!pop.contains(e.target)){ pop.remove(); document.removeEventListener('pointerdown', closeHandler, true); }
    };
    setTimeout(()=>document.addEventListener('pointerdown', closeHandler, true), 0);
  }
  list.filter(o=>o.type==='color_selector').forEach(o=>{
    try{
      const el=mk('div','wce-overlay-color-selector');
      el.dataset.overlayId=o.id;
      el.style.left=(o.x??10)+'%'; el.style.top=(o.y??10)+'%';
      _wceColorSelMount(el,o);
      hostFor(o).appendChild(el);
    }catch(e){ console.error('[WCE] failed to render a color selector:', e); }
  });
  list.filter(o=>o.type==='section_slider').forEach(o=>{
    try{
      const el=mk('div','wce-overlay-section-slider');
      el.dataset.overlayId=o.id;
      el.style.left=(o.x??10)+'%'; el.style.top=(o.y??10)+'%'; el.style.width=(o.width||200)+'px';
      el.style.setProperty('--sec-track-color', o.trackColor||'#333333');
      el.style.setProperty('--sec-track-height', (o.trackHeight!=null?o.trackHeight:6)+'px');
      el.style.setProperty('--sec-thumb-color', o.thumbColor||'#c8a96e');
      el.style.setProperty('--sec-thumb-size', (o.thumbSize!=null?o.thumbSize:16)+'px');
      const axes=window._wceSectionAxes||{};
      const axisKeys=['x','y','z'].filter(k=>axes[k]);
      if(axisKeys.length){
        if(o.controlMode==='combined'){
          let currentAxis=axisKeys.find(k=>axes[k].active)||axisKeys[0];
          const radiosDiv=mk('div','wce-sec-radios');
          const radioEls={};
          axisKeys.forEach(k=>{
            const r=mk('span','wce-sec-radio'+(k===currentAxis?' active':''));
            r.textContent=k.toUpperCase();
            if(k===currentAxis) r.style.background=o.activeColor||'#c8a96e';
            radioEls[k]=r;
            radiosDiv.appendChild(r);
          });
          el.appendChild(radiosDiv);
          const row=mk('div','wce-sec-row');
          const lbl = o.showLabels!==false ? mk('span','wce-sec-axislabel') : null;
          if(lbl){ lbl.textContent=currentAxis.toUpperCase(); row.appendChild(lbl); }
          const slider=document.createElement('input');
          slider.type='range'; slider.min='0'; slider.max='100'; slider.step='0.5'; slider.className='wce-sec-native-slider';
          slider.value=axes[currentAxis].position;
          slider.oninput=()=>{
            axes[currentAxis].position=parseFloat(slider.value);
            if(typeof window._wceSectionSetPosition==='function') window._wceSectionSetPosition(currentAxis, axes[currentAxis].position);
          };
          row.appendChild(slider);
          el.appendChild(row);
          axisKeys.forEach(k=>{
            radioEls[k].onclick=()=>{
              currentAxis=k;
              axisKeys.forEach(kk=>{
                const shouldBeActive=(kk===k);
                if(axes[kk].active!==shouldBeActive){
                  axes[kk].active=shouldBeActive;
                  if(typeof window._wceSectionSetActive==='function') window._wceSectionSetActive(kk, shouldBeActive);
                }
                radioEls[kk].classList.toggle('active', kk===currentAxis);
                radioEls[kk].style.background = kk===currentAxis ? (o.activeColor||'#c8a96e') : '';
              });
              slider.value=axes[currentAxis].position;
              if(lbl) lbl.textContent=currentAxis.toUpperCase();
            };
          });
        } else {
          axisKeys.forEach(k=>{
            const ax=axes[k];
            const row=mk('div','wce-sec-row');
            if(o.showLabels!==false){ const lbl=mk('span','wce-sec-axislabel'); lbl.textContent=k.toUpperCase(); row.appendChild(lbl); }
            const btn=mk('button','wce-sec-axisbtn'+(ax.active?' active':''));
            btn.textContent=k.toUpperCase();
            if(ax.active) btn.style.background=o.activeColor||'#c8a96e';
            const slider=document.createElement('input');
            slider.type='range'; slider.min='0'; slider.max='100'; slider.step='0.5'; slider.className='wce-sec-native-slider';
            slider.value=ax.position; slider.disabled=!ax.active;
            btn.onclick=()=>{
              ax.active=!ax.active;
              btn.classList.toggle('active', ax.active);
              btn.style.background = ax.active ? (o.activeColor||'#c8a96e') : '';
              slider.disabled=!ax.active;
              if(typeof window._wceSectionSetActive==='function') window._wceSectionSetActive(k, ax.active);
            };
            slider.oninput=()=>{
              ax.position=parseFloat(slider.value);
              if(typeof window._wceSectionSetPosition==='function') window._wceSectionSetPosition(k, ax.position);
            };
            row.appendChild(btn); row.appendChild(slider);
            el.appendChild(row);
          });
        }
      }
      hostFor(o).appendChild(el);
    }catch(e){ console.error('[WCE] failed to render a section slider:', e); }
  });
list.filter(o=>o.type==='presentation' && o.display!=='icon').forEach(o=>{
    const el=mk('button','wce-overlay-action-btn');
    el.dataset.overlayId=o.id;
    el.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg><span>'+(o.label||'Present')+'</span>';
    el.style.left=o.x+'%'; el.style.top=o.y+'%';
    el.onclick=()=>{ _wcePresentationActive ? _wceExitPresentationMode() : _wceEnterPresentationMode(o, el); };
    _wceWireProfileTrigger(el, o.id);
    hostFor(o).appendChild(el);
  });
list.filter(o=>o.type==='snapshot' && o.display!=='icon').forEach(o=>{
    const el=mk('button','wce-overlay-action-btn');
    el.dataset.overlayId=o.id;
    el.dataset.wceActionKind='snapshot';
    el.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>'+(o.label||'Snapshot')+'</span>';
    el.style.left=o.x+'%'; el.style.top=o.y+'%';
    el.onclick=()=>_wceTakeSnapshot();
    _wceWireProfileTrigger(el, o.id);
    hostFor(o).appendChild(el);
  });
  list.filter(o=>o.type!=='group' && o.type!=='shape' && o.type!=='text' && o.type!=='section_slider' && o.type!=='color_selector' && (o.type!=='presentation' || o.display==='icon') && (o.type!=='snapshot' || o.display==='icon')).forEach(o=>{
    if(!o.type && o.container && o.material) o.type='material';
    const el=mk('div','wce-overlay-thumb');
    if(o.id) el.dataset.overlayId=o.id;
    _wceApplyLitVars(el, o);
    el.style.left=(o.x??10)+'%';
    el.style.top=(o.y??10)+'%';
    const eff = _wceEffectiveThumbProps(o);
    const sz=eff.size||46;
    el.style.width=sz+'px';el.style.height=sz+'px';
    if(o.type==='toggle'){
      const states=o.states||[];
      const activeIdx=Math.min(o.activeIndex||0, Math.max(0,states.length-1));
      const cur=states[activeIdx]||{};
      const shapeProps=Object.assign({}, eff, {
        kind: cur.image ? 'image' : undefined,
        image: cur.image || undefined,
        imageAspect: cur.imageAspect, imageFit: cur.imageFit, imageX: cur.imageX, imageY: cur.imageY,
        imageScale: cur.imageScale != null ? cur.imageScale : eff.imageScale,
        color: cur.image ? undefined : (eff.color || '#808080'),
      });
      _wceApplyThumbShape(el, shapeProps);
      el.title = cur.label || o.name || 'Toggle';
      el.onclick=()=>{
        if(o.mode==='dropdown'){
          _wceShowTogglePicker(o, el, states);
        } else if(o.cycleShowMode==='current'){
          if(states.length){
            const resolved=_wceResolveToggleState(states[activeIdx]);
            if(resolved) applyOverlay(resolved);
            o.activeIndex = (activeIdx+1) % states.length;
          }
          buildThumbnailOverlays();
        } else {
          if(states.length){
            o.activeIndex = (activeIdx+1) % states.length;
            const resolved=_wceResolveToggleState(states[o.activeIndex]);
            if(resolved) applyOverlay(resolved);
          }
          buildThumbnailOverlays();
        }
      };
    } else {
      _wceApplyThumbShape(el, _wceIsIconOverlay(o) ? _wceIconShapeProps(o, eff) : o);
      el.title = o.label || o.material || o.name || '';
      if(o.type==='deco_image'){
        el.style.cursor='default';
        el.classList.add('wce-overlay-image');
        if(o.link){
          el.classList.add('wce-overlay-linked');
          el.addEventListener('click', ()=>window.open(o.link, '_blank'));
        }
      } else {
        el.onclick=()=>{
          if(o.type==='media'){ applyOverlay(o); return; }
          applyOverlay(o);
          qsa('.wce-overlay-thumb').forEach(t=>t.classList.remove('active'));
          el.classList.add('active');
          _wceSyncThumbHighlights(); _wceQueueThumbSync();
        };
      }
    }
    if(_wceIsIconOverlay(o)) _wceDecorateIcon(el, o, sz);
    _wceWireProfileTrigger(el, o.id);
    hostFor(o).appendChild(el);
  });
  _wceDeclutterOverlays();
}
function _wasOverlappingInDesigner(a, b){
  if(!(isFinite(a.rx) && isFinite(b.rx))) return false;
  return Math.min(a.rx + a.rw, b.rx + b.rw) - Math.max(a.rx, b.rx) > 0 &&
         Math.min(a.ry + a.rh, b.ry + b.rh) - Math.max(a.ry, b.ry) > 0;
}
function _wceDeclutterOverlays(){
  if(window._wceDesignerEditMode) return;
  const SELECTOR = '.wce-overlay-thumb,.wce-overlay-text,.wce-overlay-action-btn,.wce-overlay-shape,.wce-overlay-group,.wce-overlay-section-slider';
  const MIN_GAP = 4;
  const _s = window.__wceUiScale || 1;
  const _hid = new Set((_wceEffectiveOverlays() || []).filter(function(x){ return x && x.hidden; }).map(function(x){ return String(x.id); }));
  const contexts = new Map();
  document.querySelectorAll(SELECTOR).forEach(el=>{
    if(el.dataset.overlayId && _hid.has(el.dataset.overlayId)) return;
    const groupBody = el.closest('.wce-shape-content,.wce-group-body');
    const key = groupBody || _wceRootHost();
    if(!contexts.has(key)) contexts.set(key, []);
    contexts.get(key).push(el);
  });
  const _allBoxes = [];
  const _allEls = [];
  contexts.forEach((els, key)=>{
    els.forEach(el=>{
      const _curL = el.style.left, _curT = el.style.top;
      if(el.dataset.wceBaseLeft===undefined || (_curL && _curL.indexOf('calc(')!==0 && _curL !== el.dataset.wceBaseLeft)) el.dataset.wceBaseLeft = _curL;
      if(el.dataset.wceBaseTop===undefined  || (_curT && _curT.indexOf('calc(')!==0 && _curT !== el.dataset.wceBaseTop))  el.dataset.wceBaseTop  = _curT;
      const _curX = el.style.transform;
      if(el.dataset.wceBaseTransform===undefined || (_curX && !/ scale\([\d.]+\)$/.test(_curX))) el.dataset.wceBaseTransform = _curX || '';
      el.style.transform = el.dataset.wceBaseTransform;
      el.style.transformOrigin = '';
      el.style.transition = 'none';
      el.style.left = el.dataset.wceBaseLeft;
      el.style.top  = el.dataset.wceBaseTop;
    });
    const _refSz = (key && key !== _wceRootHost()) ? [key.offsetWidth, key.offsetHeight] : WCEUIS.refSize(window);
    const boxes = els.map(el=>{
      const r = el.getBoundingClientRect();
      const bl = el.dataset.wceBaseLeft, bt = el.dataset.wceBaseTop;
      const okRef = /%$/.test(bl || '') && /%$/.test(bt || '');
      const _ov = el.dataset.overlayId ? _wceLiveOverlay(el.dataset.overlayId) : null;
      return {el, x:r.left, y:r.top, w:r.width, h:r.height, dx:0, dy:0,
              rx: okRef ? parseFloat(bl) / 100 * _refSz[0] : NaN, ry: okRef ? parseFloat(bt) / 100 * _refSz[1] : NaN,
              rw: el.offsetWidth, rh: el.offsetHeight, gid: (_ov && _ov.gid) || null,
              topLevel: (key === _wceRootHost())};
    });
    for(let pass=0; boxes.length>1 && pass<6; pass++){
      let moved = false;
      for(let i=0;i<boxes.length;i++){
        for(let j=i+1;j<boxes.length;j++){
          const a=boxes[i], b=boxes[j];
          if(_wasOverlappingInDesigner(a, b)) continue;
          const ax1=a.x+a.dx, ay1=a.y+a.dy, ax2=ax1+a.w, ay2=ay1+a.h;
          const bx1=b.x+b.dx, by1=b.y+b.dy, bx2=bx1+b.w, by2=by1+b.h;
          const overlapX = Math.min(ax2,bx2) - Math.max(ax1,bx1);
          const overlapY = Math.min(ay2,by2) - Math.max(ay1,by1);
          if(overlapX > -MIN_GAP && overlapY > -MIN_GAP){
            const needX = overlapX + MIN_GAP;
            const needY = overlapY + MIN_GAP;
            const acx=ax1+a.w/2, acy=ay1+a.h/2, bcx=bx1+b.w/2, bcy=by1+b.h/2;
            if(needX < needY){
              const dir = acx <= bcx ? -1 : 1;
              a.dx += dir*needX/2; b.dx -= dir*needX/2;
            } else {
              const dir = acy <= bcy ? -1 : 1;
              a.dy += dir*needY/2; b.dy -= dir*needY/2;
            }
            moved = true;
          }
        }
      }
      if(!moved) break;
    }
    _allBoxes.push(...boxes);
    _allEls.push(...els);
  });
  {
    const boxes = _allBoxes, els = _allEls;
    if(typeof _wceDetectDeviceView === 'function'){
      const _view = _wceDetectDeviceView();
      const _vp = (window.visualViewport ? {w: window.visualViewport.width, h: window.visualViewport.height} : {w: window.innerWidth, h: window.innerHeight});
      const BLEED_MARGIN = 4;
      const _topBoxes = boxes.filter(b=>b.topLevel);
      const _isFrame = b => b.el.classList.contains('wce-overlay-group');
      const _ufParent = new Map();
      _topBoxes.forEach(b=>_ufParent.set(b, b));
      const _ufFind = function(b){
        let r = b; while(_ufParent.get(r) !== r) r = _ufParent.get(r);
        let c = b; while(_ufParent.get(c) !== c){ const n = _ufParent.get(c); _ufParent.set(c, r); c = n; }
        return r;
      };
      const _ufUnion = function(a, b){ const ra = _ufFind(a), rb = _ufFind(b); if(ra !== rb) _ufParent.set(ra, rb); };
      for(let i = 0; i < _topBoxes.length; i++){
        for(let j = i + 1; j < _topBoxes.length; j++){
          const a = _topBoxes[i], b = _topBoxes[j];
          if((a.gid && b.gid && a.gid === b.gid) || _wasOverlappingInDesigner(a, b)) _ufUnion(a, b);
        }
      }
      const _components = new Map();
      _topBoxes.forEach(b=>{ const r = _ufFind(b); if(!_components.has(r)) _components.set(r, []); _components.get(r).push(b); });
      const _units = [];
      const _boxUnitKey = new Map();
      let _unitSeq = 0;
      _components.forEach(function(members){
        if(members.length >= 2){
          const key = 'u:' + (_unitSeq++);
          members.forEach(function(b){ _boxUnitKey.set(b, key); });
          _units.push(members);
        } else if(_isFrame(members[0])){
          _units.push(members);
        }
      });
      function _wceResolveUnitBleed(members){
        if(_view === 'mobileV'){
          const top = Math.min(...members.map(b=>b.y+b.dy));
          const bottom = Math.max(...members.map(b=>b.y+b.dy+b.h));
          const left = Math.min(...members.map(b=>b.x+b.dx));
          const avail = _vp.h - BLEED_MARGIN;
          if(bottom <= avail) return;
          const overflow = bottom - avail;
          if(top - overflow >= 0){
            members.forEach(b=>{ b.dy -= overflow; });
            return;
          }
          const dyPartial = -top;
          const scale = Math.max(0.01, avail / (bottom - top));
          const anchorX = left, anchorY = 0;
          members.forEach(b=>{
            b.dy += dyPartial;
            const px = b.x + b.dx, py = b.y + b.dy;
            b._scale = scale;
            b._originX = anchorX - px; b._originY = anchorY - py;
          });
        } else if(_view === 'mobileH'){
          const left = Math.min(...members.map(b=>b.x+b.dx));
          const right = Math.max(...members.map(b=>b.x+b.dx+b.w));
          const top = Math.min(...members.map(b=>b.y+b.dy));
          const avail = _vp.w - BLEED_MARGIN;
          if(right <= avail) return;
          const overflow = right - avail;
          if(left - overflow >= 0){
            members.forEach(b=>{ b.dx -= overflow; });
            return;
          }
          const dxPartial = -left;
          const scale = Math.max(0.01, avail / (right - left));
          const anchorX = 0, anchorY = top;
          members.forEach(b=>{
            b.dx += dxPartial;
            const px = b.x + b.dx, py = b.y + b.dy;
            b._scale = scale;
            b._originX = anchorX - px; b._originY = anchorY - py;
          });
        }
      }
      _units.forEach(_wceResolveUnitBleed);
      _topBoxes.forEach(b=>{
        if(b._scale !== undefined) return;
        if(_view === 'mobileV'){
          const bottom = b.y + b.dy + b.h;
          if(bottom > _vp.h - BLEED_MARGIN) b.dy -= (bottom - (_vp.h - BLEED_MARGIN));
        } else if(_view === 'mobileH'){
          const right = b.x + b.dx + b.w;
          if(right > _vp.w - BLEED_MARGIN) b.dx -= (right - (_vp.w - BLEED_MARGIN));
        }
      });
      const _unitMap = new Map();
      _topBoxes.forEach(b=>{
        const key = _boxUnitKey.get(b) || ('b:'+_topBoxes.indexOf(b));
        if(!_unitMap.has(key)) _unitMap.set(key, []);
        _unitMap.get(key).push(b);
      });
      const _overlapUnits = Array.from(_unitMap.values()).map(mem=>{
        const s = b => b._scale || 1;
        const x1=Math.min(...mem.map(b=>b.x+b.dx)), y1=Math.min(...mem.map(b=>b.y+b.dy));
        const x2=Math.max(...mem.map(b=>b.x+b.dx+b.w*s(b))), y2=Math.max(...mem.map(b=>b.y+b.dy+b.h*s(b)));
        return {mem, x:x1, y:y1, w:x2-x1, h:y2-y1, ux:0, uy:0};
      });
      for(let pass=0; _overlapUnits.length>1 && pass<6; pass++){
        let moved=false;
        for(let i=0;i<_overlapUnits.length;i++){
          for(let j=i+1;j<_overlapUnits.length;j++){
            const a=_overlapUnits[i], b=_overlapUnits[j];
            if(a.mem.length===1 && b.mem.length===1) continue;
            const ax1=a.x+a.ux, ay1=a.y+a.uy, ax2=ax1+a.w, ay2=ay1+a.h;
            const bx1=b.x+b.ux, by1=b.y+b.uy, bx2=bx1+b.w, by2=by1+b.h;
            const oX = Math.min(ax2,bx2) - Math.max(ax1,bx1);
            const oY = Math.min(ay2,by2) - Math.max(ay1,by1);
            if(oX > -MIN_GAP && oY > -MIN_GAP){
              const needX = oX + MIN_GAP, needY = oY + MIN_GAP;
              const acx=ax1+a.w/2, acy=ay1+a.h/2, bcx=bx1+b.w/2, bcy=by1+b.h/2;
              if(needX < needY){ const dir = acx<=bcx?-1:1; a.ux += dir*needX/2; b.ux -= dir*needX/2; }
              else { const dir = acy<=bcy?-1:1; a.uy += dir*needY/2; b.uy -= dir*needY/2; }
              moved=true;
            }
          }
        }
        if(!moved) break;
      }
      _overlapUnits.forEach(u=>{ u.mem.forEach(b=>{ b.dx += u.ux; b.dy += u.uy; }); });
    }
    boxes.forEach(b=>{
      if(b.dx || b.dy){
        b.el.style.left = 'calc(' + b.el.dataset.wceBaseLeft + ' + ' + (b.dx / _s).toFixed(1) + 'px)';
        b.el.style.top  = 'calc(' + b.el.dataset.wceBaseTop  + ' + ' + (b.dy / _s).toFixed(1) + 'px)';
      }
      if(b._scale !== undefined){
        b.el.style.transformOrigin = (b._originX / _s).toFixed(1) + 'px ' + (b._originY / _s).toFixed(1) + 'px';
        b.el.style.transform = (b.el.dataset.wceBaseTransform ? b.el.dataset.wceBaseTransform + ' ' : '') + 'scale(' + b._scale.toFixed(4) + ')';
      }
    });
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ els.forEach(el=>{ el.style.transition=''; }); }));
  }
}
let _wceDeclutterResizeAttached = false;
function _wceAttachDeclutterResizeListener(){
  if(_wceDeclutterResizeAttached) return;
  _wceDeclutterResizeAttached = true;
  let t = null;
  const again = ()=>{ clearTimeout(t); t = setTimeout(_wceDeclutterOverlays, 150); };
  window.addEventListener('resize', again);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', again);
    window.visualViewport.addEventListener('scroll', again);
  }
}
function refreshActive(){
  qsa('.vc').forEach(b=>b.classList.toggle('active',b.dataset.v===activeV));
  qsa('.tb').forEach(b=>b.classList.remove('active'));
  Object.keys(geoSt).forEach(k=>{if(geoSt[k]){const btn=document.querySelector(`.tb[data-col="${k}"]`);if(btn)btn.classList.add('active');}  });
  _wceQueueThumbSync();
}
const mk=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};
const qsa=(s)=>[...document.querySelectorAll(s)];
function _wceTakeSnapshot(){
  try{
    if(typeof window._wceAaSnapshotRender==="function") window._wceAaSnapshotRender(); else comp.render();
    renderer.domElement.toBlob(function(blob){
      if(!blob){ console.error('[WCE] Snapshot failed: toBlob returned null'); return; }
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download='snapshot-'+Date.now()+'.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }catch(e){ console.error('[WCE] Snapshot failed:', e); }
}
let _wcePresentationActive=false;
try{Object.defineProperty(window,"_wcePresentationActiveFlag",{get:function(){return _wcePresentationActive;},configurable:true});}catch(e){}
let _wcePresentationIconHost=null;
let _wcePresentationHiddenEls=[];
let _wcePresentationHiddenMarkers=[];
const _wcePresentationRevealed=new Set();
let _wcePresentationKeyHandler=null;
let _wcePresentationDef=null;
let _wcePresentationTriggerEl=null;
let _wcePresentationTriggerOrigHTML=null;
function _wcePresentationHideSelectors(){
  return ['#panel','#ptab','#ar-btn','.wce-overlay-thumb','.wce-overlay-text',
          '.wce-overlay-group','.wce-overlay-shape','.wce-overlay-section-slider','.wce-overlay-color-selector','.wce-overlay-action-btn'];
}
const _WCE_PRES_CATS = ['bulk:hotspots','bulk:annotations','bulk:imagetriggers','chrome:panel','pres:overlays','pres:ui','pres:slider'];
function _wceElementCategory(el){
  if(el.id==='panel' || el.id==='ptab') return 'chrome:panel';
  if(el.id==='ar-btn') return 'pres:ui';
  const k = el.dataset && el.dataset.wceActionKind;
  if(k==='sound' || k==='snapshot' || k==='presentation') return 'pres:overlays';
  if(el.classList && el.classList.contains('wce-overlay-section-slider')) return 'pres:slider';
  if(el.dataset && el.dataset.overlayId) return 'pres:ui';
  return null;
}
function _wceMigratePresCat(cat){
  if(_WCE_PRES_CATS.indexOf(cat) >= 0) return cat;
  if(cat==='chrome:ar') return 'pres:ui';
  if(typeof cat==='string' && cat.indexOf('overlay:')===0){
    const id = cat.slice(8);
    const o = (_wceEffectiveOverlays()||[]).find(function(x){ return x && String(x.id)===id; });
    if(o && (o.type==='sound' || o.type==='snapshot' || o.type==='presentation')) return 'pres:overlays';
    if(o && o.type==='section_slider') return 'pres:slider';
    return 'pres:ui';
  }
  return 'pres:ui';
}
function _wcePresentationCategorySelector(cat){
  if(cat==='chrome:panel') return '#panel,#ptab';
  return null;
}
function _wceHideMarkerCategory(kind, hasHotkey, arr, filterFn){
  (arr||[]).forEach(function(item){
    if(!filterFn(item)) return;
    _wcePresentationHiddenMarkers.push({item:item, orig:item.hidden, kind:kind});
    if(!hasHotkey) item.hidden = true;
  });
}
function _wceToggleMarkerCategory(kind, reveal){
  _wcePresentationHiddenMarkers.forEach(function(entry){
    if(entry.kind !== kind) return;
    entry.item.hidden = !reveal;
  });
}
function _wceEnterPresentationMode(def, triggerEl){
  if(_wcePresentationActive) return;
  _wcePresentationActive=true;
  _wcePresentationDef=def||{};
  _wcePresentationHiddenEls=[];
  _wcePresentationHiddenMarkers=[];
  _wcePresentationRevealed.clear();
  _wcePresentationTriggerEl=triggerEl||null;
  _wcePresentationTriggerOrigHTML=null;
  const hotkeyCats = new Set((_wcePresentationDef.hotkeys||[]).map(function(h){ return _wceMigratePresCat(h.category); }));
  _wceViewToggleTargets().forEach(function(c){ hotkeyCats.add(c); });
  hotkeyCats.add('pres:overlays');
  _wcePresentationHideSelectors().forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(el){
      if(el.dataset.wceActionKind==='viewtoggle') return;
      if(el===_wcePresentationTriggerEl) return;
      _wcePresentationHiddenEls.push({el:el, prevDisplay:el.style.display});
      const cat = _wceElementCategory(el);
      if(cat && hotkeyCats.has(cat)){
        _wcePresentationRevealed.add(cat);
        return;
      }
      el.style.display='none';
    });
  });
  _wceHideMarkerCategory('hotspot', hotkeyCats.has('bulk:hotspots'), window.hotspots, function(hs){ return !hs.isAnnotation; });
  _wceHideMarkerCategory('annotation', hotkeyCats.has('bulk:annotations'), window.hotspots, function(hs){ return !!hs.isAnnotation; });
  _wceHideMarkerCategory('imagetrigger', hotkeyCats.has('bulk:imagetriggers'), window._imgTriggers, function(){ return true; });
  if(hotkeyCats.has('bulk:hotspots')) _wcePresentationRevealed.add('bulk:hotspots');
  if(hotkeyCats.has('bulk:annotations')) _wcePresentationRevealed.add('bulk:annotations');
  if(hotkeyCats.has('bulk:imagetriggers')) _wcePresentationRevealed.add('bulk:imagetriggers');
  document.querySelectorAll('[data-wce-action-kind="viewtoggle"]').forEach(function(el){ el.style.visibility=''; el.style.pointerEvents=''; });
  _wceSyncViewToggles();
  if(_wcePresentationTriggerEl){
    if(_wcePresentationDef.showCloseButton===false){
      _wcePresentationHiddenEls.push({el:_wcePresentationTriggerEl, prevDisplay:_wcePresentationTriggerEl.style.display});
      _wcePresentationTriggerEl.style.display='none';
    } else {
      if(_wcePresentationTriggerEl.__wcePaint){
        _wcePresentationIconHost=null; _wcePresentationTriggerOrigHTML=null;
        _wcePresentationTriggerEl.__wcePaint(true);
      } else {
        _wcePresentationIconHost=_wcePresentationTriggerEl.querySelector('.wce-thumb-icon')||_wcePresentationTriggerEl;
        _wcePresentationTriggerOrigHTML=_wcePresentationIconHost.innerHTML;
        _wcePresentationIconHost.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg><span>Close</span>';
      }
      _wcePresentationTriggerEl.classList.add('wce-presentation-active');
    }
  }
  const rootEl=document.documentElement;
  const req=rootEl.requestFullscreen||rootEl.webkitRequestFullscreen||rootEl.mozRequestFullScreen;
  if(req){ try{ req.call(rootEl).catch(function(){}); }catch(e){} }
  try{ window.focus(); }catch(e){}
  _wcePresentationKeyHandler=function(ev){
    const hotkeys=_wcePresentationDef.hotkeys||[];
    const seen={};
    hotkeys.filter(function(h){ return h.key===ev.code; }).forEach(function(h){
      const c=_wceMigratePresCat(h.category);
      if(seen[c]) return;
      seen[c]=1;
      _wceTogglePresentationReveal(c);
    });
  };
  document.addEventListener('keydown', _wcePresentationKeyHandler);
}
function _wceTogglePresentationReveal(cat){
  cat=_wceMigratePresCat(cat);
  const isRevealed=_wcePresentationRevealed.has(cat);
  if(cat==='bulk:hotspots'){
    _wceToggleMarkerCategory('hotspot', !isRevealed);
  } else if(cat==='bulk:annotations'){
    _wceToggleMarkerCategory('annotation', !isRevealed);
  } else if(cat==='bulk:imagetriggers'){
    _wceToggleMarkerCategory('imagetrigger', !isRevealed);
  } else {
    _wcePresentationHiddenEls.forEach(function(entry){
      if(entry.el===_wcePresentationTriggerEl) return;
      if(_wceElementCategory(entry.el)!==cat) return;
      entry.el.style.display = isRevealed ? 'none' : (entry.prevDisplay||'');
    });
  }
  if(isRevealed) _wcePresentationRevealed.delete(cat); else _wcePresentationRevealed.add(cat);
  _wceSyncViewToggles();
}
function _wceViewToggleCats(o){
  const out=[];
  (o.targets||[]).forEach(function(t){ const c=_wceMigratePresCat(t); if(out.indexOf(c)<0) out.push(c); });
  return out;
}
function _wceViewToggleTargets(){
  const out=[];
  (_wceEffectiveOverlays()||[]).forEach(function(o){
    if(!o || o.type!=='viewtoggle' || o.hidden) return;
    _wceViewToggleCats(o).forEach(function(c){ out.push(c); });
  });
  return out;
}
function _wceViewToggleShown(o){
  if(!_wcePresentationActive) return true;
  const cats=_wceViewToggleCats(o);
  return cats.length>0 && cats.every(function(c){ return _wcePresentationRevealed.has(c); });
}
function _wceViewToggleClick(o){
  if(!_wcePresentationActive) return;
  const cats=_wceViewToggleCats(o);
  if(!cats.length) return;
  const allShown=cats.every(function(c){ return _wcePresentationRevealed.has(c); });
  cats.forEach(function(c){
    if(allShown ? _wcePresentationRevealed.has(c) : !_wcePresentationRevealed.has(c)) _wceTogglePresentationReveal(c);
  });
  _wceSyncViewToggles();
}
function _wceSyncViewToggles(){
  document.querySelectorAll('[data-wce-action-kind="viewtoggle"]').forEach(function(el){
    const o=el.__wceOverlay;
    if(!o || !el.__wcePaint) return;
    const shown=_wceViewToggleShown(o);
    if(el.__wceAlt()===shown) el.__wcePaint(!shown);
  });
}
function _wceExitPresentationMode(){
  if(!_wcePresentationActive) return;
  _wcePresentationActive=false;
  _wcePresentationHiddenEls.forEach(function(entry){ entry.el.style.display=entry.prevDisplay; });
  _wcePresentationHiddenEls=[];
  _wcePresentationHiddenMarkers.forEach(function(entry){ entry.item.hidden=entry.orig; });
  _wcePresentationHiddenMarkers=[];
  _wcePresentationRevealed.clear();
  if(_wcePresentationTriggerEl && _wcePresentationTriggerEl.__wcePaint){
    try{ _wcePresentationTriggerEl.__wcePaint(false); }catch(e){}
    _wcePresentationTriggerEl.classList.remove('wce-presentation-active');
  }
  document.querySelectorAll('[data-wce-action-kind="viewtoggle"]').forEach(function(el){
    try{ if(el.__wcePaint) el.__wcePaint(false); }catch(e){}
    el.style.visibility='hidden'; el.style.pointerEvents='none';
  });
  if(_wcePresentationTriggerEl && _wcePresentationTriggerOrigHTML!==null){
    (_wcePresentationIconHost||_wcePresentationTriggerEl).innerHTML=_wcePresentationTriggerOrigHTML; _wcePresentationIconHost=null;
    _wcePresentationTriggerEl.classList.remove('wce-presentation-active');
  }
  _wcePresentationTriggerEl=null;
  _wcePresentationTriggerOrigHTML=null;
  if(_wcePresentationKeyHandler){ document.removeEventListener('keydown', _wcePresentationKeyHandler); _wcePresentationKeyHandler=null; }
  if(document.fullscreenElement && document.exitFullscreen){ try{ document.exitFullscreen().catch(function(){}); }catch(e){} }
}
document.addEventListener('fullscreenchange', function(){
  if(!document.fullscreenElement && _wcePresentationActive) _wceExitPresentationMode();
});
var _WCE_CALC_CUR = {
  USD: {symbol: '$', code: 'USD'}, INR: {symbol: '₹', code: 'INR'}, EUR: {symbol: '€', code: 'EUR'}, GBP: {symbol: '£', code: 'GBP'},
  JPY: {symbol: '¥', code: 'JPY'}, CNY: {symbol: '¥', code: 'CNY'}, AED: {symbol: 'AED', code: 'AED'}, SAR: {symbol: 'SAR', code: 'SAR'},
  CHF: {symbol: 'CHF', code: 'CHF'}, CAD: {symbol: 'C$', code: 'CAD'}, AUD: {symbol: 'A$', code: 'AUD'}, SGD: {symbol: 'S$', code: 'SGD'}
};
var _WCE_CALC_ALLOW = {material: 1, geo_toggle: 1, variant: 1, mat_subset: 1, global_set: 1, geo_subset: 1};
function _wcePriceKey(o){
  if(!o) return '';
  if(o.type === 'toggle') return o.id || '';
  try{ return _wceOverlayKey(o) || o.id || ''; }catch(e){ return o.id || ''; }
}
function _wcePricingData(){
  try{ if(typeof window._wceGetPricing === 'function'){ const p = window._wceGetPricing(); if(p) return p; } }catch(e){}
  const p = (window.WCE_THEME || {}).pricing;
  return (p && typeof p === 'object') ? p : {items: {}, groups: []};
}
function _wcePlacedOverlays(){
  let layouts = null;
  try{ if(typeof window._wceGetAllLayoutOverlays === 'function') layouts = window._wceGetAllLayoutOverlays(); }catch(e){}
  if(!layouts){
    const base = window.WCE_THEME || {};
    layouts = [base.overlays || []];
    const dev = base.deviceOverrides || {};
    Object.keys(dev).forEach(function(k){ if(dev[k] && dev[k].overlays) layouts.push(dev[k].overlays); });
  }
  return layouts.concat([window.WCE_OVERLAYS || []]);
}
function _wceCalcCandidates(){
  const seen = {}, out = [];
  _wcePlacedOverlays().forEach(function(list){
    (list || []).forEach(function(o){
      if(!o || !o.type || !_WCE_CALC_ALLOW[o.type]) return;
      const k = _wcePriceKey(o);
      if(!k || seen[k]) return;
      seen[k] = 1; out.push(o);
    });
  });
  const items = (_wcePricingData().items) || {};
  Object.keys(items).forEach(function(k){
    const d = items[k] && items[k].d;
    if(seen[k] || !d || !d.type || !_WCE_CALC_ALLOW[d.type]) return;
    seen[k] = 1;
    out.push(Object.assign({}, d, {label: d.label || d.name || d.material || d.node || k}));
  });
  return out;
}
function _wceCatalogBundles(){
  const out = [];
  const cfg = (typeof CFG !== 'undefined' && CFG) ? CFG : {};
  const vd = (typeof varData !== 'undefined' && varData) ? varData : {};
  Object.keys(vd).forEach(function(n){ out.push({type: 'variant', name: n, label: String(n).replace(/_/g, ' ')}); });
  (cfg.global_mat_sets || []).forEach(function(x){ out.push({type: 'global_set', name: x.name, uid: x.uid, label: String(x.name).replace(/_/g, ' ')}); });
  (cfg.mat_subsets || []).forEach(function(x){ out.push({type: 'mat_subset', name: x.name, uid: x.uid, label: String(x.name).replace(/_/g, ' ')}); });
  (cfg.geometry_subsets || []).forEach(function(x){ out.push({type: 'geo_subset', name: x.name, uid: x.uid, label: String(x.name).replace(/_/g, ' ')}); });
  return out;
}
function _wceBundleCandidates(){
  const seen = {}, out = [];
  _wceCalcCandidates().concat(_wceCatalogBundles()).forEach(function(o){
    if(!_wceIsBundle(o)) return;
    const k = _wcePriceKey(o);
    if(!k || seen[k]) return;
    seen[k] = 1; out.push(o);
  });
  return out;
}
var _WCE_BUNDLE_TYPES = {variant: 1, mat_subset: 1, global_set: 1, geo_subset: 1};
function _wceIsBundle(o){ return !!o && !!_WCE_BUNDLE_TYPES[o.type]; }
function _wceGk(v){ return String(v).replace(/ /g, '_'); }
function _wceBundleParts(o){
  const mats = {}, geos = {};
  let n = 0;
  const addState = function(st, geo){
    Object.keys(st || {}).forEach(function(k){
      if(geo){ geos[_wceGk(st[k])] = 1; } else { mats[k] = st[k]; }
      n++;
    });
  };
  const cfg = (typeof CFG !== 'undefined' && CFG) ? CFG : {};
  if(o.type === 'variant'){
    const d = (typeof varData !== 'undefined' && varData) ? varData[o.name] : null;
    if(!d) return null;
    const SKIP = ['CAMERA_SETTINGS', 'MAT_SUBSETS', 'GLOBAL_MAT_SETS', 'GEO_SETS', 'LIGHTS', 'ENVIRONMENTS'];
    const exposed = cfg.geometry_exposed || {};
    Object.keys(d).forEach(function(k){
      const v = d[k];
      if(typeof v !== 'string' || !v || v === 'NONE') return;
      if(k.indexOf('GEOMETRIES_') === 0){ if(!exposed[k]) return; geos[_wceGk(v)] = 1; n++; }
      else if(SKIP.indexOf(k) < 0){ mats[k] = v; n++; }
    });
  } else if(o.type === 'mat_subset' || o.type === 'global_set'){
    const gset = (o.uid && (cfg.global_mat_sets || []).find(function(x){ return x.uid === o.uid; })) || (cfg.global_mat_sets || []).find(function(x){ return x.name === o.name; });
    const s = gset || (o.uid && (cfg.mat_subsets || []).find(function(x){ return x.uid === o.uid; })) || (cfg.mat_subsets || []).find(function(x){ return x.name === o.name; }) || (o.state ? {state: o.state} : null);
    if(!s) return null;
    addState(s.state, false);
  } else if(o.type === 'geo_subset'){
    const s = (o.uid && (cfg.geometry_subsets || []).find(function(x){ return x.uid === o.uid; })) || (cfg.geometry_subsets || []).find(function(x){ return x.name === o.name; }) || (o.state ? {state: o.state} : null);
    if(!s) return null;
    addState(s.state, true);
  } else return null;
  return n > 0 ? {mats: mats, geos: geos} : null;
}
function _wceBundleHasPart(parts, p){
  if(!parts || !p) return false;
  if(p.type === 'material') return Object.prototype.hasOwnProperty.call(parts.mats, p.container) && parts.mats[p.container] === p.material;
  if(p.type === 'geo_toggle') return !!parts.geos[_wceGk(p.node)];
  return false;
}
function _wceBundleSize(parts){ return Object.keys(parts.mats).length + Object.keys(parts.geos).length; }
function _wceBundleRank(o){ return o.type === 'variant' ? 3 : (o.type === 'global_set' ? 2 : 1); }
function _wceBundleInside(x, y){
  if(!x || !y || x.o === y.o || _wcePriceKey(x.o) === _wcePriceKey(y.o)) return false;
  const xs = _wceBundleSize(x.parts), ys = _wceBundleSize(y.parts);
  if(xs > ys) return false;
  if(xs === ys && _wceBundleRank(y.o) <= _wceBundleRank(x.o)) return false;
  const ym = y.parts.mats, xm = x.parts.mats;
  const okM = Object.keys(xm).every(function(k){ return Object.prototype.hasOwnProperty.call(ym, k) && ym[k] === xm[k]; });
  return okM && Object.keys(x.parts.geos).every(function(g){ return !!y.parts.geos[g]; });
}
function _wceBundlesOf(p){
  if(!p) return [];
  const isPart = (p.type === 'material' || p.type === 'geo_toggle');
  if(!isPart && !_wceIsBundle(p)) return [];
  let self = null;
  if(!isPart){
    let pp = null;
    try{ pp = _wceBundleParts(p); }catch(e){}
    if(!pp) return [];
    self = {o: p, parts: pp};
  }
  const out = [];
  _wceBundleCandidates().forEach(function(b){
    let parts = null;
    try{ parts = _wceBundleParts(b); }catch(e){}
    if(!parts) return;
    if(isPart ? _wceBundleHasPart(parts, p) : _wceBundleInside(self, {o: b, parts: parts})) out.push(String(b.label || b.name || b.type));
  });
  return out;
}
function _wceNum(x){ return x != null && x !== '' && isFinite(+x); }
function _wceCalcLines(){
  const P = _wcePricingData(), items = P.items || {}, groups = P.groups || [];
  const cands = _wceCalcCandidates();
  const lit = cands.map(function(o){ try{ return _wceThumbCovered(o) === true; }catch(e){ return false; } });
  const bundles = [];
  _wceBundleCandidates().forEach(function(o){
    let on = false;
    try{ on = _wceThumbCovered(o) === true; }catch(e){}
    if(!on) return;
    let parts = null;
    try{ parts = _wceBundleParts(o); }catch(e){}
    if(parts) bundles.push({o: o, parts: parts});
  });
  const lines = [];
  cands.forEach(function(o, i){
    if(!lit[i]) return;
    const k = _wcePriceKey(o), it = items[k];
    if(!it) return;
    const g = it.g ? groups.find(function(x){ return x.id === it.g; }) : null;
    let via;
    if(_wceIsBundle(o)){
      const ok = _wcePriceKey(o);
      const me = bundles.find(function(b){ return _wcePriceKey(b.o) === ok; });
      via = me ? bundles.filter(function(b){ return _wceBundleInside(me, b); }) : [];
    } else {
      via = bundles.filter(function(b){ return _wceBundleHasPart(b.parts, o); });
    }
    if(via.some(function(b){ const bi = items[_wcePriceKey(b.o)]; return !!(bi && bi.cover); })) return;
    let v = null, t = 'add';
    if(via.length){
      if(_wceNum(it.bv)){ v = +it.bv; t = it.t || 'add'; }
      else if(g && _wceNum(g.bv)){ v = +g.bv; t = g.t || 'add'; }
    }
    if(v == null){
      if(_wceNum(it.v)){ v = +it.v; t = it.t || 'add'; }
      else if(g && _wceNum(g.v)){ v = +g.v; t = g.t || 'add'; }
    }
    if(v == null) return;
    lines.push({label: String(o.label || o.name || o.material || k).replace(/_/g, ' '), v: v, t: t,
                inBundle: via.length > 0, via: via.map(function(b){ return String(b.o.label || b.o.name || ''); })});
  });
  return lines;
}
function _wceCalcTotals(lines, calc){
  const base = Number(calc.basePrice) || 0;
  let add = 0, sub = 0, pct = 0;
  lines.forEach(function(L){ if(L.t === 'sub') sub += L.v; else if(L.t === 'pct') pct += L.v; else add += L.v; });
  const sum = base + add - sub;
  const pctAmt = sum * pct / 100;
  const net = sum + pctAmt;
  const dp = Math.min(100, Math.max(0, Number(calc.discountPct) || 0));
  const discount = net * dp / 100;
  const taxable = net - discount;
  const tp = Math.min(100, Math.max(0, Number(calc.taxPct) || 0));
  const tax = taxable * tp / 100;
  return {base: base, sum: sum, pctAmt: pctAmt, net: net, discount: discount, taxable: taxable, tax: tax, total: taxable + tax, count: lines.length};
}
function _wceCalcNum(n, calc){
  let dec = parseInt(calc.decimals, 10);
  if(!(dec >= 0)) dec = 0;
  if(dec > 4) dec = 4;
  const f = Math.pow(10, dec);
  const a = Math.round((Math.abs(n) + 1e-9) * f) / f;
  const neg = n < 0 && a !== 0;
  const parts = a.toFixed(dec).split('.');
  let ip = parts[0];
  const fp = parts[1] || '';
  const g = calc.grouping || 'intl';
  let dsep = '.';
  if(g === 'intl') ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  else if(g === 'indian'){
    if(ip.length > 3){ const last3 = ip.slice(-3), rest = ip.slice(0, -3); ip = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3; }
  } else if(g === 'eu'){ ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); dsep = ','; }
  return {neg: neg, text: ip + (fp ? dsep + fp : ''), isZero: a === 0};
}
function _wceCalcSymbol(calc){
  const c = calc.currency || 'USD';
  if(c === 'none') return '';
  if(c === 'custom') return String(calc.customCurrency || '');
  const d = _WCE_CALC_CUR[c];
  if(!d) return '';
  return (calc.currencyStyle === 'code') ? d.code : d.symbol;
}
function _wceCalcMoney(n, calc){
  const r = _wceCalcNum(n, calc), sym = _wceCalcSymbol(calc), sign = r.neg ? '-' : '';
  if(!sym) return sign + r.text;
  if((calc.currencyPos || 'before') === 'after') return sign + r.text + ' ' + sym;
  const wordy = /[A-Za-z]{2,}/.test(sym);
  return sign + sym + (wordy ? ' ' : '') + r.text;
}
function _wceCalcValueFor(calc, tt){
  switch(calc.show){
    case 'subtotal': return tt.net;
    case 'tax': return tt.tax;
    case 'discount': return tt.discount;
    case 'count': return tt.count;
    default: return tt.total;
  }
}
function _wceCalcCompose(o, calc, lines, tt, valueOverride){
  const prefix = o.label ? String(o.label) : '';
  const show = calc.show || 'total';
  if(show === 'breakdown'){
    const out = [];
    if(prefix) out.push(prefix);
    if(tt.base) out.push('Base price  ' + _wceCalcMoney(tt.base, calc));
    lines.forEach(function(L){
      let txt;
      if(L.t === 'pct') txt = (L.v >= 0 ? '+' : '-') + Math.abs(L.v) + '%';
      else txt = (((L.t === 'sub') !== (L.v < 0)) ? '-' : '+') + _wceCalcMoney(Math.abs(L.v), calc);
      out.push(L.label + '  ' + txt);
    });
    if(tt.discount) out.push('Discount  -' + _wceCalcMoney(tt.discount, calc));
    if(tt.tax) out.push('Tax  +' + _wceCalcMoney(tt.tax, calc));
    out.push('Total  ' + _wceCalcMoney(tt.total, calc));
    return out.join('\n');
  }
  const real = (valueOverride === undefined);
  const val = real ? _wceCalcValueFor(calc, tt) : valueOverride;
  let body;
  if(show === 'count') body = String(Math.round(val));
  else {
    const zero = _wceCalcNum(val, calc).isZero;
    body = (real && zero && calc.zeroText) ? String(calc.zeroText) : _wceCalcMoney(val, calc);
  }
  return (prefix ? prefix + ' ' : '') + body + (calc.suffixText ? ' ' + calc.suffixText : '');
}
function _wceCalcText(o){
  const calc = o.calc || {};
  const lines = _wceCalcLines();
  return _wceCalcCompose(o, calc, lines, _wceCalcTotals(lines, calc));
}
function _wceCalcInit(el, o){
  el.setAttribute('data-wce-calc', '1');
  el.style.whiteSpace = ((o.calc || {}).show === 'breakdown') ? 'pre-line' : '';
  el.textContent = _wceCalcText(o);
}
function _wceUpdateCalculators(){
  const els = document.querySelectorAll('[data-wce-calc]');
  if(!els.length) return;
  const lines = _wceCalcLines();
  Array.prototype.forEach.call(els, function(el){
    const id = el.getAttribute('data-overlay-id');
    const o0 = id ? _wceLiveOverlay(id) : null;
    if(!o0 || !o0.calc) return;
    const o = (typeof _wceEffectiveTextProps === 'function') ? _wceEffectiveTextProps(o0) : o0;
    const calc = o.calc || o0.calc;
    const tt = _wceCalcTotals(lines, calc);
    const show = calc.show || 'total';
    el.style.whiteSpace = (show === 'breakdown') ? 'pre-line' : '';
    const target = _wceCalcValueFor(calc, tt);
    const canAnim = calc.animate !== false && show !== 'breakdown' && show !== 'count';
    if(el.__wceCalcTarget === undefined){ el.__wceCalcTarget = target; el.__wceCalcCur = target; }
    if(target !== el.__wceCalcTarget){
      el.__wceCalcTarget = target;
      if(canAnim){
        const from = (typeof el.__wceCalcCur === 'number') ? el.__wceCalcCur : target, t0 = performance.now(), dur = 380;
        const token = (el.__wceCalcAnim = (el.__wceCalcAnim || 0) + 1);
        const step = function(now){
          if(el.__wceCalcAnim !== token || !el.isConnected) return;
          const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
          const cur = from + (target - from) * e;
          el.__wceCalcCur = cur;
          if(k < 1){ el.textContent = _wceCalcCompose(o, calc, lines, tt, cur); requestAnimationFrame(step); }
          else { el.__wceCalcCur = target; el.__wceCalcAnim = 0; el.textContent = _wceCalcCompose(o, calc, _wceCalcLines(), _wceCalcTotals(_wceCalcLines(), calc)); }
        };
        requestAnimationFrame(step);
        return;
      }
      el.__wceCalcCur = target;
      el.__wceCalcAnim = 0;
    }
    if(el.__wceCalcAnim) return;
    const txt = _wceCalcCompose(o, calc, lines, tt);
    if(el.textContent !== txt) el.textContent = txt;
  });
}
var _WCE_MV_DEF = {
  coverPct: 80, fit: 'contain', bgMode: 'dim', dimPct: 75, blurPx: 12, bgColor: '#000000',
  showClose: true, closeOnBackdrop: true, closeOnEsc: true, anim: 'fade', animMs: 220,
  radius: 6, borderWidth: 0, borderColor: '#ffffff', shadow: true,
  vidAutoplay: true, vidLoop: true, vidMuted: false, vidControls: true
};
var _wceMv = null;
function _wceMvCfg(){
  let src = null;
  try{ if(typeof window._wceGetMediaViewer === 'function') src = window._wceGetMediaViewer(); }catch(e){}
  if(!src) src = (window.WCE_THEME || {}).mediaViewer || {};
  return Object.assign({}, _WCE_MV_DEF, src);
}
function _wceMvRgba(hex, a){
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + (isNaN(r) ? 0 : r) + ',' + (isNaN(g) ? 0 : g) + ',' + (isNaN(b) ? 0 : b) + ',' + a + ')';
}
function _wceMvSampleSrc(){
  return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a7bd5"/><stop offset="1" stop-color="#c8a96e"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><text x="800" y="470" font-family="sans-serif" font-size="72" fill="#ffffff" text-anchor="middle">Sample picture</text></svg>');
}
function _wceMediaFind(name){
  const list = ((typeof CFG !== 'undefined' && CFG) ? CFG.media_items : (window.CFG || {}).media_items) || [];
  return list.find(function(m){ return m.name === name; });
}
function _wceMvLayout(){
  if(!_wceMv) return;
  const c = _wceMv.cfg, box = _wceMv.box, el = _wceMv.el;
  const W = Math.max(40, window.innerWidth * c.coverPct / 100), H = Math.max(40, window.innerHeight * c.coverPct / 100);
  const nw = _wceMv.type === 'video' ? el.videoWidth : el.naturalWidth, nh = _wceMv.type === 'video' ? el.videoHeight : el.naturalHeight;
  let bw = W, bh = H;
  if(c.fit !== 'cover' && nw > 0 && nh > 0){ const s = Math.min(W / nw, H / nh); bw = nw * s; bh = nh * s; }
  box.style.width = Math.round(bw) + 'px';
  box.style.height = Math.round(bh) + 'px';
  el.style.width = '100%'; el.style.height = '100%';
  el.style.objectFit = (c.fit === 'cover') ? 'cover' : 'contain';
}
function _wceMvApply(){
  if(!_wceMv) return;
  const c = _wceMv.cfg, root = _wceMv.root, box = _wceMv.box, el = _wceMv.el;
  const dim = Math.min(100, Math.max(0, +c.dimPct)) / 100;
  root.style.background = 'transparent';
  root.style.backdropFilter = ''; root.style.webkitBackdropFilter = '';
  if(c.bgMode === 'black') root.style.background = '#000';
  else if(c.bgMode === 'dim') root.style.background = _wceMvRgba(c.bgColor, dim);
  else if(c.bgMode === 'blur'){
    root.style.background = _wceMvRgba(c.bgColor, dim);
    const f = 'blur(' + Math.max(0, +c.blurPx) + 'px)';
    root.style.backdropFilter = f; root.style.webkitBackdropFilter = f;
  }
  box.style.borderRadius = Math.max(0, +c.radius) + 'px';
  box.style.border = (+c.borderWidth > 0) ? (+c.borderWidth + 'px solid ' + c.borderColor) : 'none';
  box.style.boxShadow = c.shadow ? '0 14px 50px rgba(0,0,0,.55)' : 'none';
  _wceMv.btn.style.display = c.showClose ? 'flex' : 'none';
  if(_wceMv.type === 'video'){
    el.loop = !!c.vidLoop; el.controls = !!c.vidControls; el.muted = !!c.vidMuted;
  }
  _wceMvLayout();
}
function _wceMediaRestyle(){
  if(!_wceMv) return;
  _wceMv.cfg = _wceMvCfg();
  _wceMvApply();
}
function _wceMvKey(ev){
  if(!_wceMv) return;
  if((ev.key === 'Escape' || ev.key === 'Esc') && _wceMv.cfg.closeOnEsc){
    ev.stopImmediatePropagation(); ev.preventDefault();
    _wceCloseMedia();
  }
}
function _wceCloseMedia(immediate){
  const mv = _wceMv;
  if(!mv) return;
  _wceMv = null;
  window.removeEventListener('keydown', _wceMvKey, true);
  window.removeEventListener('resize', mv.onResize);
  try{ if(mv.type === 'video'){ mv.el.pause(); } }catch(e){}
  const done = function(){ try{ mv.el.removeAttribute('src'); if(mv.type === 'video') mv.el.load(); }catch(e){} if(mv.root.parentNode) mv.root.parentNode.removeChild(mv.root); };
  const dur = (immediate === true || mv.cfg.anim === 'none') ? 0 : Math.max(0, +mv.cfg.animMs);
  if(!dur){ done(); return; }
  mv.root.style.transition = 'opacity ' + dur + 'ms ease';
  mv.root.style.opacity = '0';
  mv.root.style.pointerEvents = 'none';
  setTimeout(done, dur + 30);
}
function _wceOpenMedia(name, opts){
  opts = opts || {};
  _wceCloseMedia(true);
  let m = _wceMediaFind(name);
  if(!m && opts.sample) m = {name: 'Sample', type: 'image', src: _wceMvSampleSrc()};
  if(!m || !m.src){ console.warn('[WCE] Media item not found or has no file: ' + name); return; }
  const cfg = _wceMvCfg();
  const root = document.createElement('div');
  root.id = 'wce-media-viewer';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', m.name || 'Media');
  root.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:10050;display:flex;align-items:center;justify-content:center;box-sizing:border-box;margin:0;padding:0';
  const box = document.createElement('div');
  box.style.cssText = 'position:relative;overflow:hidden;box-sizing:border-box;flex:none;background:transparent';
  const type = (m.type === 'video') ? 'video' : 'image';
  let el;
  if(type === 'video'){
    el = document.createElement('video');
    el.playsInline = true; el.setAttribute('playsinline', ''); el.preload = 'auto';
    el.style.cssText = 'display:block;background:#000';
    el.src = m.src;
  } else {
    el = document.createElement('img');
    el.alt = m.name || ''; el.draggable = false;
    el.style.cssText = 'display:block;user-select:none;-webkit-user-drag:none';
    el.src = m.src;
  }
  box.appendChild(el);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.setAttribute('aria-label', 'Close'); btn.innerHTML = '&times;';
  btn.style.cssText = 'position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.6);color:#fff;border:1px solid rgba(255,255,255,.4);font-size:26px;line-height:1;cursor:pointer;padding:0;z-index:2';
  root.appendChild(box); root.appendChild(btn);
  _wceMv = {root: root, box: box, el: el, btn: btn, type: type, cfg: cfg, onResize: function(){ _wceMvLayout(); }};
  root.addEventListener('click', function(ev){
    if(!_wceMv || _wceMv.root !== root) return;
    if(ev.target === root && _wceMv.cfg.closeOnBackdrop) _wceCloseMedia();
  });
  btn.addEventListener('click', function(ev){ ev.stopPropagation(); _wceCloseMedia(); });
  window.addEventListener('keydown', _wceMvKey, true);
  window.addEventListener('resize', _wceMv.onResize);
  el.addEventListener(type === 'video' ? 'loadedmetadata' : 'load', function(){ if(_wceMv && _wceMv.el === el) _wceMvLayout(); });
  _wceMvApply();
  const dur = (cfg.anim === 'none') ? 0 : Math.max(0, +cfg.animMs);
  if(dur){
    root.style.opacity = '0';
    root.style.transition = 'opacity ' + dur + 'ms ease';
    box.style.opacity = '0';
    box.style.transform = (cfg.anim === 'scale') ? 'scale(.9)' : ((cfg.anim === 'slide') ? 'translateY(28px)' : 'none');
    box.style.transition = 'transform ' + dur + 'ms ease, opacity ' + dur + 'ms ease';
  }
  document.body.appendChild(root);
  if(dur){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ root.style.opacity = '1'; box.style.opacity = '1'; box.style.transform = 'none'; }); });
  }
  try{ root.tabIndex = -1; root.focus({preventScroll: true}); }catch(e){}
  if(type === 'video' && cfg.vidAutoplay){
    const p = el.play();
    if(p && p.catch) p.catch(function(){ el.muted = true; const q = el.play(); if(q && q.catch) q.catch(function(){}); });
  }
}
function _wceGeoSig(){
  try{ return Object.keys(geoSt).filter(function(k){ return geoSt[k]; }).sort().join('|'); }catch(e){ return ''; }
}
function _wceGeoSubsetSticky(state){
  var l = window._wceGeoSubsetLast;
  try{ return !!l && l.sig === JSON.stringify(state) && l.geo === _wceGeoSig(); }catch(e){ return false; }
}
function _wceWantMat(c, m){
  try{ return (typeof _wceResolveWantedMat === 'function') ? _wceResolveWantedMat(c, m) : m; }catch(e){ return m; }
}
function _wceStateSig(){
  try{
    var mats = Object.keys(matSt).sort().map(function(k){ return k + '=' + matSt[k]; }).join('|');
    return _wceGeoSig() + '#' + mats;
  }catch(e){ return ''; }
}
function _wceMatSetSticky(state){
  var l = window._wceMatSetLast;
  try{ return !!l && l.sig === JSON.stringify(state) && l.st === _wceStateSig(); }catch(e){ return false; }
}
function _wceVariantSticky(name){
  var l = window._wceVariantLast;
  try{ return !!l && l.name === name && l.st === _wceStateSig(); }catch(e){ return false; }
}
function _wceSyncPanelHighlights(){
  if(window._wceDesignerEditMode) return;
  if(typeof _wceThumbCovered !== 'function') return;
  var cfg = (typeof CFG !== 'undefined' && CFG) || {};
  var cov = function(o){ try{ return _wceThumbCovered(o); }catch(e){ return null; } };
  var q = function(sel){ return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var set = function(el, on, cls){ if(el && on !== null && on !== undefined) el.classList.toggle(cls || 'active', !!on); };
  var hd = cfg.hdris || [];
  q('.pb2[data-hf]').forEach(function(b){
    var item = (b.dataset.uid && hd.find(function(h){ return h.uid === b.dataset.uid; })) ||
               hd.find(function(h){ return h.name === b.dataset.name; });
    if(item) set(b, cov({type: 'hdri', uid: item.uid, name: item.name, item: item}));
  });
  q('.pb2[data-oc]').forEach(function(b){ set(b, !!_wceOceanStateIs(b.dataset.oc)); });
  q('.pb2[data-snd]').forEach(function(b){ set(b, _wceSoundIsOnByName(b.dataset.snd)); });
  q('.pb2[data-pf]').forEach(function(b){
    var on = (window._wceActivePPFilterName !== undefined)
      ? (window._wceActivePPFilterName === b.dataset.pfn)
      : (window._wceActivePPFilter === b.dataset.pf);
    set(b, on);
  });
  q('.vc[data-v]').forEach(function(b){
    var c = cov({type: 'variant', name: b.dataset.v});
    set(b, !!c);
  });
  q('.gb[data-gn]').forEach(function(b){
    var s = (cfg.global_mat_sets || []).find(function(x){ return x.name === b.dataset.gn; });
    if(s) set(b, cov({type: 'mat_subset', state: s.state}));
  });
  q('.pb2[data-sc][data-mn]').forEach(function(b){
    var s = (cfg.mat_subsets || []).find(function(x){ return x.category === b.dataset.sc && x.name === b.dataset.mn; });
    if(s) set(b, cov({type: 'mat_subset', state: s.state}));
  });
  q('.pb2[data-tp="gp"]').forEach(function(b){
    var s = (cfg.geometry_subsets || [])[parseInt(b.dataset.gi, 10)];
    if(s) set(b, cov({type: 'geo_subset', state: s.state}));
  });
  q('.cam-btn[data-cam]').forEach(function(b){ set(b, cov({type: 'camera', name: b.dataset.cam})); });
  q('.tt-btn').forEach(function(b){ set(b, cov({type: 'turntable'})); });
  q('.camseq-btn[data-seq]').forEach(function(b){ set(b, cov({type: 'camera_sequence', name: b.dataset.seq}), 'playing'); });
  q('.anim-btn[data-seq-name]').forEach(function(b){ set(b, cov({type: 'sequence', name: b.dataset.seqName}), 'playing'); });
}
function _wceOceanProfiles(){ return (CFG && CFG.ocean && CFG.ocean.enabled && CFG.ocean.profiles) ? CFG.ocean.profiles : []; }
function _wceOceanStatesOn(){ return _wceOceanProfiles().length>0; }
function _wceOceanFind(n){
  var ps=_wceOceanProfiles(), k=String(n==null?'':n).toLowerCase(), i;
  if(!ps.length) return null;
  for(i=0;i<ps.length;i++){ if(String(ps[i].id).toLowerCase()===k || String(ps[i].name).toLowerCase()===k) return ps[i]; }
  if(k==='static') return ps[0];
  if(k==='running') return ps[1] || null;
  return null;
}
function _wceSetOceanState(n){
  try{
    var pf=_wceOceanFind(n);
    if(!pf) return;
    var o=window._wceOcean;
    if(o && typeof o.setProfile==='function') o.setProfile(pf.id);
    else window._wcePendingOcean=pf.id;
    try{ _wceSyncPanelHighlights(); }catch(e){}
    try{ _wceSyncThumbHighlights(); }catch(e){}
  }catch(e){ console.warn('[WCE] ocean profile failed', e); }
}
function _wceOceanStateIs(n){
  var o=window._wceOcean, pf=_wceOceanFind(n);
  if(!_wceOceanStatesOn() || !pf) return null;
  var cur=(o && typeof o.getProfile==='function') ? o.getProfile() : (window._wcePendingOcean || CFG.ocean.start_profile);
  return cur===pf.id;
}
function buildOceanSwitcher(){
  var sec=document.getElementById('socean');
  if(!sec) return;
  var ps=_wceOceanProfiles();
  if(ps.length<2){ sec.innerHTML=''; return; }
  sec.innerHTML='<div class="st">Ocean</div>';
  var g=mk('div','pg');
  ps.forEach(function(pf){
    var b=mk('button','pb2'); b.textContent=pf.name; b.dataset.oc=pf.name;
    if(_wceOceanStateIs(pf.name)) b.classList.add('active');
    b.onclick=function(){ _wceSetOceanState(pf.name); qsa('.pb2[data-oc]').forEach(function(x){ x.classList.toggle('active', x.dataset.oc===pf.name); }); };
    g.appendChild(b);
  });
  sec.appendChild(g);
}
function _wceSoundDefs(){ return (CFG && CFG.sounds) ? CFG.sounds : []; }
function _wceSoundDefByName(n){
  var k=String(n==null?'':n).toLowerCase(), l=_wceSoundDefs(), i;
  for(i=0;i<l.length;i++){ if(String(l[i].name).toLowerCase()===k || String(l[i].key).toLowerCase()===k) return l[i]; }
  return null;
}
function _wceSoundFireByName(n){
  var d=_wceSoundDefByName(n);
  if(d && typeof window._wceSoundFire==='function') window._wceSoundFire(d);
}
function _wceSoundIsOnByName(n){
  var d=_wceSoundDefByName(n);
  return !!(d && typeof window._wceSoundIsOn==='function' && window._wceSoundIsOn(d));
}
function _wceSoundStep(name, act){
  var d=_wceSoundDefByName(name);
  if(!d || typeof window._wceSoundFire!=='function') return;
  var on=_wceSoundIsOnByName(name);
  if(act==='stop'){ if(d.loop && on) window._wceSoundFire(d); return; }
  if(d.loop){ if(!on) window._wceSoundFire(d); } else window._wceSoundFire(d);
}
function buildSoundButtons(){
  var sec=document.getElementById('ssound');
  if(!sec) return;
  var list=_wceSoundDefs().filter(function(d){ return d.trigger_type==='button'; });
  if(!list.length){ sec.innerHTML=''; return; }
  sec.innerHTML='<div class="st">Sound</div>';
  var g=mk('div','pg');
  list.forEach(function(d){
    var b=mk('button','pb2'); b.textContent=d.name; b.dataset.snd=d.name;
    if(_wceSoundIsOnByName(d.name)) b.classList.add('active');
    b.onclick=function(){ _wceSoundFireByName(d.name); b.classList.toggle('active', _wceSoundIsOnByName(d.name)); };
    g.appendChild(b);
  });
  sec.appendChild(g);
}
(function _wcePresentOnLoad(){
  try{
    if(!(typeof CFG!=='undefined' && CFG && CFG.default_presentation)) return;
    var tries=0;
    function findDef(){
      var l=(typeof _wceEffectiveOverlays==='function') ? _wceEffectiveOverlays() : (window.WCE_OVERLAYS||[]), i;
      for(i=0;i<(l||[]).length;i++){ if(l[i] && l[i].type==='presentation' && !l[i].hidden) return l[i]; }
      return null;
    }
    function go(){
      if(++tries>600) return;
      var ld=document.getElementById('ld');
      if(ld && ld.style.display!=='none' && !ld.classList.contains('hidden')){ setTimeout(go,250); return; }
      var o=findDef(), el=o ? document.querySelector('[data-overlay-id="'+o.id+'"]') : null;
      if(!o || !el){ setTimeout(go,250); return; }
      try{ if(!_wcePresentationActive) _wceEnterPresentationMode(o, el); }catch(e){ console.warn('[WCE] could not open in Presentation Mode:', e); }
    }
    setTimeout(go,600);
  }catch(e){}
})();
(function(){
  try{
    if(document.getElementById('wce-colorsel-css')) return;
    var s = document.createElement('style'); s.id = 'wce-colorsel-css';
    s.textContent = [
      '.wce-overlay-color-selector{position:fixed;z-index:6;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--cs-gap,9px);max-width:calc(100vw - 16px);font-family:inherit;line-height:1.2;pointer-events:auto;user-select:none;-webkit-user-select:none;color:var(--cs-text,#fff);font-size:var(--cs-fs,12px)}',
      '.wce-group-content>.wce-overlay-color-selector,.wce-shape-content>.wce-overlay-color-selector{position:absolute}',
      '.wce-shape-content .wce-overlay-color-selector{pointer-events:auto}',
      '.wce-cs-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.wce-cs-head.clickable{cursor:pointer}',
      '.wce-cs-title{font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-size:calc(var(--cs-fs,12px) * .9);opacity:.92}',
      '.wce-cs-chev{opacity:.7;font-size:10px}',
      '.wce-cs-select{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);color:inherit;border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:4px 6px;font:inherit;outline:none}',
      '.wce-cs-select option{color:#111}',
      '.wce-cs-colors{display:flex;flex-wrap:wrap;align-items:center;gap:var(--cs-swgap,6px)}',
      '.wce-cs-sw,.wce-cs-picker{width:var(--cs-sw,22px);height:var(--cs-sw,22px);box-sizing:border-box;padding:0;margin:0;cursor:pointer;flex:0 0 auto;border:2px solid rgba(255,255,255,.18);background:none}',
      '.wce-cs-sw.round,.wce-cs-picker.round{border-radius:50%}.wce-cs-sw.rounded,.wce-cs-picker.rounded{border-radius:25%}.wce-cs-sw.sq,.wce-cs-picker.sq{border-radius:2px}',
      '.wce-cs-picker{overflow:hidden;-webkit-appearance:none;appearance:none}',
      '.wce-cs-picker::-webkit-color-swatch-wrapper{padding:0}.wce-cs-picker::-webkit-color-swatch{border:0;border-radius:inherit}.wce-cs-picker::-moz-color-swatch{border:0;border-radius:inherit}',
      '.wce-cs-picker.mixed{opacity:.45}',
      '.wce-cs-sw.active,.wce-cs-picker.active{border-color:var(--cs-accent,#c8a96e);box-shadow:0 0 0 1px var(--cs-accent,#c8a96e)}',
      '.wce-cs-note{font-size:calc(var(--cs-fs,12px) * .85);opacity:.65}',
      '.wce-cs-rows{display:flex;flex-direction:column;gap:var(--cs-gap,9px)}',
      '.wce-cs-row{display:grid;grid-template-columns:76px 1fr 38px;align-items:center;gap:8px}',
      '.wce-cs-row.novals{grid-template-columns:76px 1fr}',
      '.wce-cs-row.stacked{grid-template-columns:1fr auto}.wce-cs-row.stacked .wce-cs-range{grid-column:1 / -1;grid-row:2}',
      '.wce-cs-row.stacked.novals{grid-template-columns:1fr}',
      '.wce-cs-lbl{opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.wce-cs-val{text-align:right;color:var(--cs-val,inherit);opacity:.8;font-variant-numeric:tabular-nums}',
      '.wce-cs-row.off{opacity:.35}.wce-cs-row.off .wce-cs-range{pointer-events:none}',
      '.wce-cs-range{-webkit-appearance:none;appearance:none;width:100%;height:var(--cs-thumbsz,14px);background:transparent;margin:0;cursor:pointer;outline:none}',
      '.wce-cs-range::-webkit-slider-runnable-track{height:var(--cs-th,5px);background:var(--cs-trackbg,var(--cs-track,#3a3a44));border-radius:999px}',
      '.wce-cs-range::-webkit-slider-thumb{-webkit-appearance:none;width:var(--cs-thumbsz,14px);height:var(--cs-thumbsz,14px);border-radius:var(--cs-thumbr,50%);background:var(--cs-thumb,#c8a96e);border:var(--cs-thumbbw,0px) solid var(--cs-thumbbc,#fff);box-sizing:border-box;margin-top:calc((var(--cs-th,5px) - var(--cs-thumbsz,14px)) / 2)}',
      '.wce-cs-range::-moz-range-track{height:var(--cs-th,5px);background:var(--cs-trackbg,var(--cs-track,#3a3a44));border-radius:999px}',
      '.wce-cs-range::-moz-range-thumb{width:var(--cs-thumbsz,14px);height:var(--cs-thumbsz,14px);border-radius:var(--cs-thumbr,50%);background:var(--cs-thumb,#c8a96e);border:var(--cs-thumbbw,0px) solid var(--cs-thumbbc,#fff);box-sizing:border-box}',
      '.wce-cs-btns{display:flex;gap:8px;flex-wrap:wrap}',
      '.wce-cs-btn{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:3px 10px;font:inherit;cursor:pointer;opacity:.85}',
      '.wce-cs-btn:hover{opacity:1;border-color:var(--cs-accent,#c8a96e)}',
      '.wce-cs-empty{opacity:.65;font-style:italic}',
      '.wce-cs-edit *{pointer-events:none !important}',
      '.wce-overlay-thumb.wce-cs-picked{outline:2px solid var(--wce-cs-ring,#c8a96e);outline-offset:2px}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }catch(e){}
})();
function _wceColorSelDefaults(){
  return {
    width:230, panelBg:'#14141a', panelOpacity:88, blur:0, radius:10, padding:12, gap:9, borderWidth:1, borderColor:'#3a3a44', shadow:0,
    textColor:'#ffffff', fontSize:12, fontWeight:'400', letterSpacing:0, textCase:'none', valueColor:'#ffffff',
    showTitle:true, titleFormat:'Color · {part}', collapsible:false, startCollapsed:false,
    showColor:true, showSwatches:true, showRoughness:true, showMetalness:true, showClearcoat:true, showSpecular:true,
    showReset:true, showResetAll:false, showPicker:false, showNote:true, showValues:true, decimals:2, rowLayout:'inline',
    lblRoughness:'', lblMetalness:'', lblClearcoat:'', lblSpecular:'',
    trackColor:'#3a3a44', trackHeight:5, showFill:false, fillColor:'#c8a96e', thumbColor:'#c8a96e', thumbSize:14, thumbRadius:50,
    thumbBorderWidth:0, thumbBorderColor:'#ffffff', showFullRange:false, disallowedColor:'#5a5a64',
    swatchSize:22, swatchShape:'circle', swatchGap:6, accent:'#c8a96e',
    swatches:['#ffffff','#111111','#c0392b','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad'],
    remember:true, pulseOnSelect:true, colorTweenMs:0, emptyState:'first', emptyText:'Select a part to edit its color'
  };
}
var _WCE_CS_PROPS = ['roughness', 'metalness', 'clearcoat', 'specular'];
var _WCE_CS_PROP_LABEL = {roughness: 'Roughness', metalness: 'Metalness', clearcoat: 'Clearcoat', specular: 'Specular'};
function _wceCsNice(c){
  var n = String(c || '').replace(/^MAT_/i, '').replace(/_+/g, ' ').trim().toLowerCase();
  return n.replace(/\b[a-z]/g, function(ch){ return ch.toUpperCase(); }) || String(c);
}
function _wceCsBare(c){ return String(c || '').toUpperCase().replace(/^MAT_/, ''); }
function _wceCsClamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
function _wceCsRgba(hex, op){
  var h = String(hex || '#000000').replace('#', '');
  if(h.length === 3) h = h.split('').map(function(x){ return x + x; }).join('');
  var n = parseInt(h, 16); if(isNaN(n)) n = 0;
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (_wceCsClamp(op, 0, 100) / 100) + ')';
}
function _wceCsMats(c){
  var W = window._wce, r = [], cc = W && W.cloneCache && W.cloneCache[c];
  if(!cc) return r;
  Object.keys(cc).forEach(function(mn){
    var e = cc[mn]; if(!e) return;
    ['plain', 'ao'].forEach(function(k){ if(e[k]) r.push(e[k]); });
  });
  return r;
}
function _wceCsUpgrade(c){
  var W = window._wce, T = W && W.THREE, root = window.root, cc = W && W.cloneCache && W.cloneCache[c];
  if(!T || !root || !cc || !T.MeshPhysicalMaterial) return;
  Object.keys(cc).forEach(function(mn){
    ['plain', 'ao'].forEach(function(k){
      var m = cc[mn] && cc[mn][k];
      if(!m || m.isMeshPhysicalMaterial || !m.isMeshStandardMaterial) return;
      try{
        var n = new T.MeshPhysicalMaterial();
        T.MeshStandardMaterial.prototype.copy.call(n, m);
        n.defines = {STANDARD: '', PHYSICAL: ''};
        n.name = m.name; n.userData = m.userData; n.clippingPlanes = m.clippingPlanes;
        n.needsUpdate = true;
        cc[mn][k] = n;
        root.traverse(function(o){
          if(!o.isMesh) return;
          if(Array.isArray(o.material)){ for(var i = 0; i < o.material.length; i++){ if(o.material[i] === m) o.material[i] = n; } }
          else if(o.material === m) o.material = n;
        });
        if(typeof m.dispose === 'function') m.dispose();
      }catch(err){ console.warn('[WCE] Color Selector: could not enable clearcoat / specular for "' + c + '":', err); }
    });
  });
}
function _wceCsRead(c){
  var mats = _wceCsMats(c), m = mats[0];
  if(!m) return null;
  return {
    color: '#' + m.color.getHexString(),
    roughness: m.roughness != null ? m.roughness : 1,
    metalness: m.metalness != null ? m.metalness : 0,
    clearcoat: m.clearcoat != null ? m.clearcoat : 0,
    specular: m.specularIntensity != null ? m.specularIntensity : 1,
    hasMap: mats.some(function(x){ return !!x.map; }),
    physical: mats.every(function(x){ return !!x.isMeshPhysicalMaterial; })
  };
}
function _wceCsRender(ms){ try{ if(window._wce && window._wce.requestRender) window._wce.requestRender(ms || 400); }catch(e){} }
function _wceCsSet(c, prop, v){
  _wceCsMats(c).forEach(function(m){
    var t = m.userData && m.userData.wceTarget;
    if(prop === 'color'){ if(m.color){ m.color.set(v); if(t && t.color) t.color.copy(m.color); } }
    else if(prop === 'roughness'){ m.roughness = v; if(t) t.roughness = v; }
    else if(prop === 'metalness'){ m.metalness = v; if(t) t.metalness = v; }
    else if(prop === 'clearcoat'){ if(!('clearcoat' in m)) return; m.clearcoat = v; if(t) t.clearcoat = v; }
    else if(prop === 'specular'){ if(!('specularIntensity' in m)) return; m.specularIntensity = v; if(t) t.specularIntensity = v; }
  });
  _wceCsRender(400);
}
function _wceCsTweenColor(c, hex, ms){
  if(!(ms > 0)){ _wceCsSet(c, 'color', hex); return; }
  var mats = _wceCsMats(c); if(!mats.length) return;
  var id = (_wceCsTweenColor._n = (_wceCsTweenColor._n || 0) + 1), t0 = performance.now();
  var froms = mats.map(function(m){ return m.color.clone(); });
  var tos = mats.map(function(m){ return m.color.clone().set(hex); });
  mats.forEach(function(m){ m.userData.wceCsTw = id; });
  (function step(now){
    var t = _wceCsClamp((now - t0) / ms, 0, 1);
    mats.forEach(function(m, i){
      if(m.userData.wceCsTw !== id) return;
      m.color.copy(froms[i]).lerp(tos[i], t);
      var tg = m.userData && m.userData.wceTarget; if(tg && tg.color) tg.color.copy(m.color);
    });
    _wceCsRender(120);
    if(t < 1) requestAnimationFrame(step);
  })(t0);
}
var _wceCsPulseId = 0;
function _wceCsPulse(keys, hex, ms){
  ms = ms || 700;
  var mats = [];
  keys.forEach(function(k){ _wceCsMats(k).forEach(function(m){ if(m.emissive) mats.push(m); }); });
  if(!mats.length) return;
  var id = ++_wceCsPulseId, t0 = performance.now();
  mats.forEach(function(m){
    if(!m.userData.wceCsPulse) m.userData.wceCsPulse = {e: m.emissive.clone(), i: m.emissiveIntensity};
    m.emissive.set(hex); m.userData.wceCsPulseId = id;
  });
  (function step(now){
    var t = _wceCsClamp((now - t0) / ms, 0, 1), k = Math.sin(Math.PI * t);
    mats.forEach(function(m){ if(m.userData.wceCsPulseId === id) m.emissiveIntensity = k * 0.9; });
    _wceCsRender(120);
    if(t < 1){ requestAnimationFrame(step); return; }
    mats.forEach(function(m){
      if(m.userData.wceCsPulseId !== id) return;
      var o = m.userData.wceCsPulse; if(o){ m.emissive.copy(o.e); m.emissiveIntensity = o.i; }
      delete m.userData.wceCsPulse; delete m.userData.wceCsPulseId;
    });
    _wceCsRender(200);
  })(t0);
}
function _wceCsCfg(){
  var c = window._wce && window._wce.CFG && window._wce.CFG.color_selector;
  return (c && Array.isArray(c.items)) ? c.items : [];
}
function _wceCsResolveKey(name){
  var W = window._wce; if(!W || !W.cloneCache) return null;
  if(W.cloneCache[name]) return name;
  var b = _wceCsBare(name), ks = Object.keys(W.cloneCache);
  for(var i = 0; i < ks.length; i++){ if(_wceCsBare(ks[i]) === b) return ks[i]; }
  return null;
}
function _wceColorSelItems(){
  var W = window._wce, out = [];
  if(!W || !W.CFG) return out;
  var all = W.CFG.containers_all || {};
  _wceCsCfg().forEach(function(it){
    var key = _wceCsResolveKey(it.container); if(!key) return;
    if(!_wceCsMats(key).length) return;
    var b = _wceCsBare(key), n = null;
    Object.keys(all).forEach(function(k){ if(_wceCsBare(k) === b && Array.isArray(all[k])) n = all[k].length; });
    if(n !== null && n !== 1) return;
    out.push({key: key, bare: b, label: it.label || _wceCsNice(it.container), cfg: it});
  });
  return out;
}
var _wceCsSel = [];
var _wceCsBase = {};
var _wceCsInited = {};
var _wceCsMem = null;
var _wceCsRememberOn = false;
var _wceCsPanels = [];
var _wceCsSaveTimer = 0;
function _wceCsStoreKey(){ return 'wce-cs:' + (location.pathname || '/'); }
function _wceCsLoadMem(){
  if(_wceCsMem) return _wceCsMem;
  try{ _wceCsMem = JSON.parse(localStorage.getItem(_wceCsStoreKey()) || '{}') || {}; }catch(e){ _wceCsMem = {}; }
  return _wceCsMem;
}
function _wceCsSaveMem(){
  if(_wceCsSaveTimer) return;
  _wceCsSaveTimer = setTimeout(function(){
    _wceCsSaveTimer = 0;
    try{ localStorage.setItem(_wceCsStoreKey(), JSON.stringify(_wceCsMem || {})); }catch(e){}
  }, 300);
}
function _wceCsRemember(key){
  if(!_wceCsRememberOn) return;
  var l = _wceCsRead(key); if(!l) return;
  _wceCsLoadMem()[key] = {color: l.color, roughness: l.roughness, metalness: l.metalness, clearcoat: l.clearcoat, specular: l.specular};
  _wceCsSaveMem();
}
function _wceCsEnsureInit(items, remember){
  items.forEach(function(it){
    if(_wceCsInited[it.key]) return;
    _wceCsInited[it.key] = true;
    var c = it.cfg || {};
    var needPhys = ['clearcoat', 'specular'].some(function(p){ return c[p] && c[p].enabled !== false; });
    if(needPhys) _wceCsUpgrade(it.key);
    if(!_wceCsRead(it.key)) return;
    if(c.color && c.color.enabled !== false && c.color.start) _wceCsSet(it.key, 'color', c.color.start);
    _WCE_CS_PROPS.forEach(function(p){
      var pc = c[p];
      if(pc && pc.enabled !== false && pc.start != null) _wceCsSet(it.key, p, _wceCsClamp(pc.start, pc.min != null ? pc.min : 0, pc.max != null ? pc.max : 1));
    });
    _wceCsBase[it.key] = _wceCsRead(it.key);
    if(remember){
      var m = _wceCsLoadMem()[it.key];
      if(m){
        if(m.color && c.color && c.color.enabled !== false) _wceCsSet(it.key, 'color', m.color);
        _WCE_CS_PROPS.forEach(function(p){
          var pc = c[p];
          if(pc && pc.enabled !== false && typeof m[p] === 'number') _wceCsSet(it.key, p, _wceCsClamp(m[p], pc.min != null ? pc.min : 0, pc.max != null ? pc.max : 1));
        });
      }
    }
  });
}
function _wceCsResetKeys(keys){
  keys.forEach(function(k){
    var b = _wceCsBase[k]; if(!b) return;
    _wceCsSet(k, 'color', b.color);
    _WCE_CS_PROPS.forEach(function(p){ _wceCsSet(k, p, b[p]); });
    if(_wceCsRememberOn){ delete _wceCsLoadMem()[k]; _wceCsSaveMem(); }
  });
}
function _wceCsNotify(){
  _wceCsPanels = _wceCsPanels.filter(function(p){ return p.el && p.el.isConnected; });
  _wceCsPanels.forEach(function(p){ try{ p.render(); }catch(e){ console.error('[WCE] Color Selector render failed:', e); } });
  try{ _wceCsRefreshPicked(); }catch(e){}
}
function _wceCsSetSel(keys, opt){
  opt = opt || {};
  var cur = _wceCsSel.slice().sort().join('|'), nxt = keys.slice().sort().join('|');
  _wceCsSel = keys.slice();
  _wceCsNotify();
  if(opt.pulse !== false && (cur !== nxt || opt.force)){
    var p = _wceCsPanels.filter(function(x){ return x.d && x.d.pulseOnSelect; })[0];
    if(p && window.__wceMode !== 'edit') _wceCsPulse(keys, p.d.accent || '#c8a96e', 700);
  }
}
function _wceCsKeysForOverlay(o, items){
  var W = window._wce, names = [];
  if(!W || !o) return [];
  if(o.type === 'material' && o.container) names = [o.container];
  else if(o.type === 'mat_subset' || o.type === 'global_set'){
    var CFG = W.CFG || {};
    var gset = (o.uid && (CFG.global_mat_sets || []).find(function(x){ return x.uid === o.uid; })) || (CFG.global_mat_sets || []).find(function(x){ return x.name === o.name; });
    var s = gset || (o.uid && (CFG.mat_subsets || []).find(function(x){ return x.uid === o.uid; })) || (CFG.mat_subsets || []).find(function(x){ return x.name === o.name; }) || (o.state ? {state: o.state} : null);
    if(s && s.state) names = Object.keys(s.state);
  }
  var out = [];
  names.forEach(function(n){
    var b = _wceCsBare(n);
    items.forEach(function(i){ if(i.bare === b && out.indexOf(i.key) < 0) out.push(i.key); });
  });
  return out;
}
function _wceCsOnOverlay(o){
  if(!_wceCsPanels.length) return;
  var keys = _wceCsKeysForOverlay(o, _wceColorSelItems());
  if(keys.length) _wceCsSetSel(keys, {force: true});
}
function _wceCsRefreshPicked(){
  var items = _wceColorSelItems(), sel = _wceCsSel.slice().sort().join('|');
  var list = (typeof _wceEffectiveOverlays === 'function') ? (_wceEffectiveOverlays() || []) : (window.WCE_OVERLAYS || []);
  list.forEach(function(o){
    if(!o || !o.id || (o.type !== 'material' && o.type !== 'mat_subset' && o.type !== 'global_set')) return;
    var el = document.querySelector('[data-overlay-id="' + String(o.id).replace(/"/g, '\\"') + '"]'); if(!el) return;
    var keys = _wceCsKeysForOverlay(o, items);
    el.classList.toggle('wce-cs-picked', !!sel && keys.length > 0 && keys.slice().sort().join('|') === sel);
  });
}
var _wceCsPollOn = false;
function _wceCsStartPoll(){
  if(_wceCsPollOn) return; _wceCsPollOn = true;
  setInterval(function(){
    if(document.hidden || !_wceCsPanels.length) return;
    try{ _wceCsRefreshPicked(); }catch(e){}
  }, 400);
}
if(typeof applyOverlay === 'function'){
  var _wceCsOrigApplyOverlay = applyOverlay;
  applyOverlay = function(o){
    var r = _wceCsOrigApplyOverlay.apply(this, arguments);
    try{ _wceCsOnOverlay(o); }catch(e){}
    return r;
  };
}
function _wceCsTrackBg(d, lo, hi, val, mixed){
  var track = d.trackColor, fill = d.showFill && !mixed ? d.fillColor : d.trackColor, dis = d.disallowedColor;
  var v = _wceCsClamp(val, lo, hi);
  var segs = [];
  if(lo > 0) segs.push([0, lo, dis]);
  segs.push([lo, v, fill]);
  segs.push([v, hi, track]);
  if(hi < 100) segs.push([hi, 100, dis]);
  return 'linear-gradient(to right,' + segs.filter(function(s){ return s[1] > s[0]; }).map(function(s){ return s[2] + ' ' + s[0] + '% ' + s[1] + '%'; }).join(',') + ')';
}
function _wceColorSelMount(el, o, opt){
  opt = opt || {};
  var d = Object.assign(_wceColorSelDefaults(), o || {});
  var inDesigner = !!window.__wceMode;
  el.classList.add('wce-overlay-color-selector');
  el.classList.toggle('wce-cs-edit', !!opt.edit);
  el.style.width = d.width + 'px';
  el.style.padding = d.padding + 'px';
  el.style.background = _wceCsRgba(d.panelBg, d.panelOpacity);
  el.style.border = d.borderWidth + 'px solid ' + d.borderColor;
  el.style.borderRadius = d.radius + 'px';
  el.style.boxShadow = d.shadow > 0 ? '0 4px ' + d.shadow + 'px rgba(0,0,0,.45)' : '';
  el.style.backdropFilter = el.style.webkitBackdropFilter = d.blur > 0 ? 'blur(' + d.blur + 'px)' : '';
  el.style.fontWeight = d.fontWeight; el.style.letterSpacing = d.letterSpacing + 'px';
  el.style.textTransform = d.textCase === 'none' ? '' : d.textCase;
  var sv = function(k, v){ el.style.setProperty(k, v); };
  sv('--cs-text', d.textColor); sv('--cs-val', d.valueColor); sv('--cs-fs', d.fontSize + 'px'); sv('--cs-gap', d.gap + 'px');
  sv('--cs-accent', d.accent); sv('--cs-track', d.trackColor); sv('--cs-th', d.trackHeight + 'px');
  sv('--cs-thumb', d.thumbColor); sv('--cs-thumbsz', d.thumbSize + 'px'); sv('--cs-thumbr', d.thumbRadius + '%');
  sv('--cs-thumbbw', d.thumbBorderWidth + 'px'); sv('--cs-thumbbc', d.thumbBorderColor);
  sv('--cs-sw', d.swatchSize + 'px'); sv('--cs-swgap', d.swatchGap + 'px');
  try{ document.documentElement.style.setProperty('--wce-cs-ring', d.accent); }catch(e){}
  var panel = null;
  for(var pi = 0; pi < _wceCsPanels.length; pi++){ if(_wceCsPanels[pi].el === el){ panel = _wceCsPanels[pi]; break; } }
  if(!panel){ panel = {el: el, collapsed: !!d.startCollapsed}; _wceCsPanels.push(panel); }
  panel.d = d; panel.o = o; panel.opt = opt;
  _wceCsRememberOn = !!d.remember && !inDesigner;
  _wceCsStartPoll();
  var swClass = function(){ return d.swatchShape === 'square' ? 'sq' : (d.swatchShape === 'rounded' ? 'rounded' : 'round'); };
  var fmt = function(v){ return (+v).toFixed(Math.max(0, Math.min(3, d.decimals | 0))); };
  panel.render = function(){
    el.innerHTML = '';
    el.style.display = '';
    var items = _wceColorSelItems();
    if(!items.length){
      var tries = (opt.tries || 0);
      if(tries < 20){ setTimeout(function(){ if(el.isConnected){ opt.tries = tries + 1; panel.render(); } }, 500); }
      var none = document.createElement('div'); none.className = 'wce-cs-empty';
      if(_wceCsCfg().length) none.textContent = tries < 20 ? 'Looking for the parts to edit...' : 'The listed containers were not found in this model.';
      else none.textContent = inDesigner ? 'No containers yet. Add them under UI & Annotations > Color Selector.' : '';
      if(!inDesigner && (tries >= 20 || !_wceCsCfg().length)){ el.style.display = 'none'; return; }
      el.appendChild(none);
      return;
    }
    _wceCsEnsureInit(items, _wceCsRememberOn);
    _wceCsSel = _wceCsSel.filter(function(k){ return items.some(function(i){ return i.key === k; }); });
    if(!_wceCsSel.length && d.emptyState === 'first') _wceCsSel = [items[0].key];
    var S = _wceCsSel.map(function(k){ return items.filter(function(i){ return i.key === k; })[0]; });
    if(d.showTitle || d.collapsible){
      var head = document.createElement('div'); head.className = 'wce-cs-head' + (d.collapsible ? ' clickable' : '');
      var title = document.createElement('div'); title.className = 'wce-cs-title';
      var part = S.length === 0 ? '' : (S.length === 1 ? S[0].label : S.length + ' parts');
      title.textContent = S.length ? String(d.titleFormat || 'Color · {part}').replace('{part}', part)
        : (String(d.titleFormat || 'Color').replace('{part}', '').replace(/^[\s·\-–—:|]+/, '').replace(/[\s·\-–—:|]+$/, '') || 'Color');
      head.appendChild(title);
      if(d.collapsible){
        var chev = document.createElement('span'); chev.className = 'wce-cs-chev'; chev.textContent = panel.collapsed ? '▸' : '▾'; head.appendChild(chev);
        head.onclick = function(){ panel.collapsed = !panel.collapsed; panel.render(); };
      }
      el.appendChild(head);
    }
    if(d.collapsible && panel.collapsed) return;
    if(d.showPicker){
      var sel = document.createElement('select'); sel.className = 'wce-cs-select';
      var op0 = document.createElement('option'); op0.value = ''; op0.textContent = 'Select a part...'; sel.appendChild(op0);
      items.forEach(function(i){ var op = document.createElement('option'); op.value = i.key; op.textContent = i.label; sel.appendChild(op); });
      sel.value = S.length === 1 ? S[0].key : '';
      sel.onchange = function(){ _wceCsSetSel(sel.value ? [sel.value] : [], {force: true}); };
      el.appendChild(sel);
    }
    if(!S.length){
      if(d.emptyState === 'hide' && !inDesigner){ el.style.display = 'none'; return; }
      var pr = document.createElement('div'); pr.className = 'wce-cs-empty'; pr.textContent = d.emptyText || 'Select a part to edit its color';
      el.appendChild(pr);
      return;
    }
    var body = document.createElement('div'); body.style.cssText = 'display:flex;flex-direction:column;gap:' + d.gap + 'px';
    el.appendChild(body);
    var cfgOf = function(it, p){ return (it.cfg && it.cfg[p]) || {}; };
    var looks = function(){ return S.map(function(i){ return _wceCsRead(i.key) || {}; }); };
    var canColor = (d.showColor || d.showSwatches) && S.every(function(i){ return !(i.cfg.color) || i.cfg.color.enabled !== false; });
    var colorWrap = document.createElement('div'); colorWrap.style.cssText = 'display:flex;flex-direction:column;gap:' + Math.max(4, d.gap - 3) + 'px';
    var applyColor = function(hex){
      S.forEach(function(i){ _wceCsTweenColor(i.key, hex, d.colorTweenMs); });
      setTimeout(function(){ S.forEach(function(i){ _wceCsRemember(i.key); }); }, (d.colorTweenMs || 0) + 30);
      buildColors(hex);
    };
    var buildColors = function(forceHex){
      colorWrap.innerHTML = '';
      var ls = looks(), first = ls[0] || {};
      var mixed = !forceHex && ls.some(function(l){ return l.color !== first.color; });
      var curHex = forceHex || (mixed ? '#808080' : first.color);
      var wrap = document.createElement('div'); wrap.className = 'wce-cs-colors';
      var pal = null;
      S.forEach(function(i){ if(!pal && i.cfg.color && i.cfg.color.swatches && i.cfg.color.swatches.length) pal = i.cfg.color.swatches; });
      pal = pal || d.swatches || [];
      var picker = null, sws = [];
      var mark = function(hex){
        var h = String(hex).toLowerCase();
        sws.forEach(function(b){ b.classList.toggle('active', !mixed && b.dataset.hex === h); });
        if(picker) picker.classList.toggle('active', !mixed && !sws.some(function(b){ return b.dataset.hex === h; }));
      };
      if(d.showSwatches){
        pal.forEach(function(hex){
          var b = document.createElement('button'); b.type = 'button'; b.className = 'wce-cs-sw ' + swClass();
          b.style.background = hex; b.dataset.hex = String(hex).toLowerCase(); b.title = hex;
          b.onclick = function(){ applyColor(hex); };
          wrap.appendChild(b); sws.push(b);
        });
      }
      if(d.showColor){
        picker = document.createElement('input'); picker.type = 'color'; picker.className = 'wce-cs-picker ' + swClass() + (mixed ? ' mixed' : '');
        picker.value = /^#[0-9a-f]{6}$/i.test(curHex) ? curHex : '#808080';
        picker.title = mixed ? 'The selected parts differ - picking a colour sets all of them' : (first.hasMap ? 'Tint (multiplies the base texture)' : 'Colour');
        picker.oninput = function(){
          S.forEach(function(i){ _wceCsSet(i.key, 'color', picker.value); });
          mixed = false; picker.classList.remove('mixed'); mark(picker.value);
        };
        picker.onchange = function(){ S.forEach(function(i){ _wceCsRemember(i.key); }); };
        wrap.appendChild(picker);
      }
      colorWrap.appendChild(wrap);
      mark(curHex);
      if(mixed){
        var mn = document.createElement('div'); mn.className = 'wce-cs-note'; mn.textContent = 'Mixed - the selected parts have different colors.'; colorWrap.appendChild(mn);
      }
      if(d.showNote && ls.some(function(l){ return l.hasMap; })){
        var note = document.createElement('div'); note.className = 'wce-cs-note';
        note.textContent = 'Multiplied on top of the base texture. White keeps the texture as it is.';
        colorWrap.appendChild(note);
      }
    };
    if(canColor){ body.appendChild(colorWrap); buildColors(); }
    var rows = document.createElement('div'); rows.className = 'wce-cs-rows';
    _WCE_CS_PROPS.forEach(function(p){
      var cap = p.charAt(0).toUpperCase() + p.slice(1);
      if(!d['show' + cap]) return;
      if(!S.every(function(i){ return cfgOf(i, p).enabled !== false && i.cfg[p]; })) return;
      var lo = Math.max.apply(null, S.map(function(i){ var v = cfgOf(i, p).min; return v != null ? v : 0; }));
      var hi = Math.min.apply(null, S.map(function(i){ var v = cfgOf(i, p).max; return v != null ? v : 1; }));
      if(lo > hi) return;
      var ls = looks(), vals = ls.map(function(l){ return l[p]; }), v0 = vals[0];
      var mixed = vals.some(function(v){ return Math.abs(v - v0) > 0.0005; });
      var needsPhys = (p === 'clearcoat' || p === 'specular');
      var off = needsPhys && !ls.every(function(l){ return l.physical; });
      var label = d['lbl' + cap] || _WCE_CS_PROP_LABEL[p];
      var r = document.createElement('div'); r.className = 'wce-cs-row' + (off ? ' off' : '') + (d.rowLayout === 'stacked' ? ' stacked' : '') + (d.showValues ? '' : ' novals');
      if(off) r.title = 'This material does not support ' + label.toLowerCase() + '.';
      var l = document.createElement('span'); l.className = 'wce-cs-lbl'; l.textContent = label;
      var inp = document.createElement('input'); inp.type = 'range'; inp.className = 'wce-cs-range'; inp.step = '0.01';
      var full = !!d.showFullRange;
      inp.min = full ? '0' : String(lo); inp.max = full ? '1' : String(hi);
      inp.value = String(_wceCsClamp(v0, lo, hi));
      var vEl = document.createElement('span'); vEl.className = 'wce-cs-val';
      var paint = function(v, isMixed){
        var a = +inp.min, b = +inp.max, span = (b - a) || 1;
        var pct = function(x){ return (_wceCsClamp(x, a, b) - a) / span * 100; };
        inp.style.setProperty('--cs-trackbg', _wceCsTrackBg(d, pct(lo), pct(hi), pct(v), isMixed));
        vEl.textContent = isMixed ? 'mixed' : fmt(v);
      };
      paint(_wceCsClamp(v0, lo, hi), mixed);
      inp.oninput = function(){
        var v = _wceCsClamp(parseFloat(inp.value), lo, hi);
        if(String(v) !== inp.value) inp.value = String(v);
        paint(v, false);
        S.forEach(function(i){
          var pc = cfgOf(i, p); _wceCsSet(i.key, p, _wceCsClamp(v, pc.min != null ? pc.min : 0, pc.max != null ? pc.max : 1));
        });
      };
      inp.onchange = function(){ S.forEach(function(i){ _wceCsRemember(i.key); }); };
      r.appendChild(l); r.appendChild(inp); if(d.showValues) r.appendChild(vEl);
      rows.appendChild(r);
    });
    if(rows.children.length) body.appendChild(rows);
    if(!canColor && !rows.children.length){
      var nothing = document.createElement('div'); nothing.className = 'wce-cs-empty'; nothing.textContent = 'Nothing is editable for this part.'; body.appendChild(nothing);
    }
    if(d.showReset || d.showResetAll){
      var btns = document.createElement('div'); btns.className = 'wce-cs-btns';
      if(d.showReset){
        var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'wce-cs-btn'; rb.textContent = S.length > 1 ? 'Reset these' : 'Reset';
        rb.onclick = function(){ _wceCsResetKeys(S.map(function(i){ return i.key; })); panel.render(); };
        btns.appendChild(rb);
      }
      if(d.showResetAll){
        var ra = document.createElement('button'); ra.type = 'button'; ra.className = 'wce-cs-btn'; ra.textContent = 'Reset all';
        ra.onclick = function(){ _wceCsResetKeys(items.map(function(i){ return i.key; })); panel.render(); };
        btns.appendChild(ra);
      }
      body.appendChild(btns);
    }
  };
  panel.render();
}
window._wceColorSelMount = _wceColorSelMount;
window._wceColorSelItems = _wceColorSelItems;
window._wceColorSelScan = _wceColorSelItems;
window._wceColorSelDefaults = _wceColorSelDefaults;


'use strict';
const MAP_W = 10000, MAP_H = 10000;
let data = null, conflicts = [], adminMode = false;
let vx = 0, vy = 0, vs = 1;
let drag = false, dx0 = 0, dy0 = 0, vx0 = 0, vy0 = 0;
const L = { continents:true,regions:true,geography:true,cities:true,
            roads:true,railways:true,ports:true,airports:true,conflicts:true };

async function init(isAdmin) {
  adminMode = isAdmin;
  data = await fetch('data/world.json').then(r=>r.json());
  if (adminMode) conflicts = await fetch('data/conflicts.json').then(r=>r.json());
  fitView(); render(); setupControls(); buildLayerPanel();
}

function sx(x) { return x*vs+vx; }
function sy(y) { return (MAP_H-y)*vs+vy; }

function polyPath(pts) {
  if(!pts||pts.length<3) return '';
  return 'M '+pts.map(p=>`${sx(p[0])} ${sy(p[1])}`).join(' L ')+' Z';
}
function linePath(pts) {
  if(!pts||pts.length<2) return '';
  return 'M '+pts.map(p=>`${sx(p[0])} ${sy(p[1])}`).join(' L ');
}

function fitView() {
  const el=document.getElementById('map-container');
  const w=el.clientWidth, h=el.clientHeight;
  vs=Math.min(w/MAP_W,h/MAP_H)*0.92;
  vx=(w-MAP_W*vs)/2; vy=(h-MAP_H*vs)/2;
}

function hexRgba(hex,a) {
  if(!hex||hex.length<6) return `rgba(150,150,150,${a})`;
  const h=hex.replace('#','');
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function starPath(cx,cy,r) {
  let d=''; for(let i=0;i<5;i++){
    const ao=Math.PI*(i*2/5-0.5), ai=Math.PI*(i*2/5+0.2-0.5);
    const ox=cx+r*Math.cos(ao),oy=cy+r*Math.sin(ao);
    const ix=cx+r*0.4*Math.cos(ai),iy=cy+r*0.4*Math.sin(ai);
    d+=(i===0?'M':'L')+`${ox} ${oy} L${ix} ${iy} `;
  } return d+'Z';
}

function render() {
  const svg=document.getElementById('map-svg');
  const el=document.getElementById('map-container');
  svg.setAttribute('width',el.clientWidth); svg.setAttribute('height',el.clientHeight);
  let h=[];

  // Ocean
  h.push(`<rect width="${el.clientWidth}" height="${el.clientHeight}" fill="#1a3a5c"/>`);

  // Geography
  if(L.geography) {
    const GC={terrain:'rgba(180,140,80,0.35)',climate:'rgba(100,200,100,0.3)',biome:'rgba(80,160,200,0.3)'};
    for(const g of data.geography||[]) {
      const d=polyPath(g.polygon); if(!d) continue;
      const fill=GC[g.type]||GC.terrain;
      const info=`Type: ${esc(g.type)}<br>Tags: ${esc((g.tags||[]).join(', ')||'—')}`;
      h.push(`<path class="geo-zone" d="${d}" fill="${fill}" onclick="showPopup(event,'${esc(g.name)}','${info}')"/>`);
      const cx=g.polygon.reduce((s,p)=>s+p[0],0)/g.polygon.length;
      const cy=g.polygon.reduce((s,p)=>s+p[1],0)/g.polygon.length;
      h.push(`<text class="city-label" x="${sx(cx)}" y="${sy(cy)}" text-anchor="middle">${esc(g.name)}</text>`);
    }
  }

  // Continents
  if(L.continents) {
    for(const c of data.continents||[]) {
      for(const lm of c.landmasses||[]) {
        const d=polyPath(lm); if(!d) continue;
        h.push(`<path class="continent" d="${d}" fill="#c8b97a"/>`);
      }
    }
  }

  // Regions (colored by country)
  if(L.regions) {
    const cmap={};
    for(const c of data.countries||[]) cmap[c.id]=c;
    for(const r of data.regions||[]) {
      const d=polyPath(r.polygon); if(!d) continue;
      const co=cmap[r.country];
      const fill=hexRgba(co?co.color:'#aaa',0.72);
      const info=`Pays: ${esc(co?co.name:r.country)}`;
      h.push(`<path class="region" d="${d}" fill="${fill}" onclick="showPopup(event,'${esc(r.name)}','${info}')"/>`);
    }
  }

  // Railways
  if(L.railways) {
    for(const rw of data.railways||[]) {
      const d=linePath(rw.nodes); if(!d) continue;
      h.push(`<path class="railway" d="${d}"/>`);
    }
  }

  // Roads
  if(L.roads) {
    for(const rd of data.roads||[]) {
      const d=linePath(rd.nodes); if(!d) continue;
      h.push(`<path class="road" d="${d}"/>`);
    }
  }

  // Conflicts
  if(L.conflicts) {
    const src=adminMode?conflicts:(data.occupied_zones_public||[]);
    for(const c of (adminMode?conflicts:[])) {
      for(const z of c.occupied_zones||[]) {
        const d=polyPath(z.polygon); if(!d) continue;
        h.push(`<path class="occ-zone" d="${d}"/>`);
      }
      if(adminMode) {
        for(const fl of c.frontlines||[]) {
          const d=linePath(fl.nodes); if(!d) continue;
          h.push(`<path class="frontline" d="${d}"/>`);
        }
        for(const bp of c.battleplans||[]) {
          const d=linePath(bp.nodes); if(!d) continue;
          h.push(`<path class="battle-plan" d="${d}"/>`);
        }
        for(const u of c.units||[]) {
          const ux=sx(u.position[0]),uy=sy(u.position[1]);
          const info=`Pays: ${esc(u.country)}<br>Type: ${esc(u.unit_type)}`;
          h.push(`<rect class="unit-rect" x="${ux-5}" y="${uy-5}" width="10" height="10" onclick="showPopup(event,'${esc(u.name)}','${info}')"/>`);
          h.push(`<text class="unit-label" x="${ux+7}" y="${uy+3}">${esc(u.name)}</text>`);
        }
      }
    }
  }

  // Ports
  if(L.ports) {
    for(const p of data.ports||[]) {
      const px=sx(p.position[0]),py=sy(p.position[1]);
      const info=`Port<br>Pays: ${esc(p.country)}`;
      h.push(`<rect class="port-icon" x="${px-3}" y="${py-3}" width="6" height="6" onclick="showPopup(event,'${esc(p.name)}','${info}')"/>`);
      h.push(`<text class="infra-label" x="${px+5}" y="${py+2}">${esc(p.name)}</text>`);
    }
  }

  // Airports
  if(L.airports) {
    for(const a of data.airports||[]) {
      const ax=sx(a.position[0]),ay=sy(a.position[1]),s2=6;
      h.push(`<line class="airport-line" x1="${ax-s2}" y1="${ay}" x2="${ax+s2}" y2="${ay}"/>`);
      h.push(`<line class="airport-line" x1="${ax}" y1="${ay-s2}" x2="${ax}" y2="${ay+s2}"/>`);
      h.push(`<text class="infra-label" x="${ax+s2+2}" y="${ay+2}">${esc(a.name)}</text>`);
    }
  }

  // Cities
  if(L.cities) {
    for(const city of data.cities||[]) {
      const cx=sx(city.position[0]),cy=sy(city.position[1]);
      const pop=city.population?`<br>Pop: ${Number(city.population).toLocaleString()}`:'';
      const info=`Pays: ${esc(city.country)}${pop}${city.capital?'<br>🏛 Capitale':''}`;
      if(city.capital) {
        h.push(`<path class="capital" d="${starPath(cx,cy,6)}" onclick="showPopup(event,'${esc(city.name)}','${info}')"/>`);
      } else {
        h.push(`<circle class="city-dot" cx="${cx}" cy="${cy}" r="3" onclick="showPopup(event,'${esc(city.name)}','${info}')"/>`);
      }
      h.push(`<text class="city-label" x="${cx+5}" y="${cy+2}">${esc(city.name)}</text>`);
    }
  }

  svg.innerHTML=h.join('\n');
}

function setupControls() {
  const el=document.getElementById('map-container');
  el.addEventListener('wheel',e=>{
    e.preventDefault();
    const f=e.deltaY<0?1.15:1/1.15;
    const r=el.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
    vx=mx-(mx-vx)*f; vy=my-(my-vy)*f; vs*=f; render();
  },{passive:false});
  el.addEventListener('mousedown',e=>{ drag=true; dx0=e.clientX; dy0=e.clientY; vx0=vx; vy0=vy; });
  window.addEventListener('mousemove',e=>{
    if(drag){ vx=vx0+(e.clientX-dx0); vy=vy0+(e.clientY-dy0); render(); }
    const r=el.getBoundingClientRect();
    const wx=(e.clientX-r.left-vx)/vs, wy=MAP_H-(e.clientY-r.top-vy)/vs;
    const cb=document.getElementById('coords');
    if(cb) cb.textContent=`(${Math.round(wx)}, ${Math.round(wy)})`;
  });
  window.addEventListener('mouseup',()=>{ drag=false; });
  window.addEventListener('resize',()=>{ fitView(); render(); });
}

function buildLayerPanel() {
  const panel=document.getElementById('layer-list'); if(!panel) return;
  const items=[
    ['continents','🌍 Continents'],['regions','🗺 Régions'],
    ['geography','🗻 Géographie'],['cities','🏙 Villes'],
    ['roads','🛣 Routes'],['railways','🚆 Voies ferrées'],
    ['ports','⚓ Ports'],['airports','✈ Aéroports'],['conflicts','⚔ Conflits'],
  ];
  panel.innerHTML=items.map(([k,lbl])=>`
    <label class="layer-item">
      <input type="checkbox" ${L[k]?'checked':''} onchange="L['${k}']=this.checked;render()">
      ${lbl}
    </label>`).join('');
}

function showPopup(event,title,body) {
  event.stopPropagation();
  const p=document.getElementById('popup');
  p.querySelector('h3').textContent=title;
  p.querySelector('.pb').innerHTML=body;
  const x=Math.min(event.clientX+10,window.innerWidth-300);
  const y=Math.min(event.clientY+10,window.innerHeight-160);
  p.style.left=x+'px'; p.style.top=y+'px';
  p.classList.add('visible');
}
function closePopup(){ document.getElementById('popup').classList.remove('visible'); }
document.addEventListener('click',e=>{ if(!e.target.closest('#popup')) closePopup(); });

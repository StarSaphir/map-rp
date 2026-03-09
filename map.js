
'use strict';
const MAP_W=10000,MAP_H=10000;
let world=null,conflicts=[],adminMode=false;
let vx=0,vy=0,vs=1;
let drag=false,dx0=0,dy0=0,vx0=0,vy0=0;
let activeCountryId=null;

// Zoom thresholds (vs = scale)
const Z_LOW=0.04, Z_MED=0.09, Z_HIGH=0.16;

const L={continents:true,territories:true,regions:false,geography:false,
         cities:true,roads:true,railways:true,ports:false,airports:false,conflicts:true};

async function init(isAdmin){
  adminMode=isAdmin;
  world=await fetch('data/world.json').then(r=>r.json());
  // Load conflicts for all users — public sees occ zones + frontlines only (spec point 4)
  conflicts=await fetch('data/conflicts.json').then(r=>r.json()).catch(()=>[]);
  fitView(); render(); setupControls(); buildLayerPanel();
}

function sx(x){return x*vs+vx;}
function sy(y){return (MAP_H-y)*vs+vy;}

function polyPath(pts){
  if(!pts||pts.length<3)return'';
  return 'M '+pts.map(p=>`${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' L ')+' Z';
}
function linePath(pts){
  if(!pts||pts.length<2)return'';
  return 'M '+pts.map(p=>`${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' L ');
}

function fitView(){
  const el=document.getElementById('map-container');
  const w=el.clientWidth,h=el.clientHeight;
  vs=Math.min(w/MAP_W,h/MAP_H)*0.92;
  vx=(w-MAP_W*vs)/2; vy=(h-MAP_H*vs)/2;
}

function hexRgba(hex,a){
  if(!hex||hex.length<6)return`rgba(150,150,150,${a})`;
  const h=hex.replace('#','');
  return`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function starPath(cx,cy,r){
  let d='';
  for(let i=0;i<5;i++){
    const ao=Math.PI*(i*2/5-0.5),ai=Math.PI*(i*2/5+0.2-0.5);
    d+=(i===0?'M':'L')+`${cx+r*Math.cos(ao)} ${cy+r*Math.sin(ao)} L${cx+r*0.4*Math.cos(ai)} ${cy+r*0.4*Math.sin(ai)} `;
  }return d+'Z';
}

function countryMap(){
  const m={};
  for(const c of world.countries||[])m[c.id]=c;
  return m;
}

function render(){
  const svg=document.getElementById('map-svg');
  const el=document.getElementById('map-container');
  svg.setAttribute('width',el.clientWidth);
  svg.setAttribute('height',el.clientHeight);
  const cmap=countryMap();
  let h=[];

  // Ocean
  h.push(`<rect width="${el.clientWidth}" height="${el.clientHeight}" fill="#1a3a5c"/>`);

  // Continents base
  if(L.continents){
    for(const c of world.continents||[]){
      for(const lm of c.landmasses||[]){
        const d=polyPath(lm);if(!d)continue;
        h.push(`<path class="continent" d="${d}" fill="#c8b97a"/>`);
      }
    }
  }

  // Territories (country land)
  if(L.territories){
    for(const t of world.territories||[]){
      const d=polyPath(t.polygon);if(!d)continue;
      const co=cmap[t.country_id];
      const fill=hexRgba(co?co.color:'#aaa',0.78);
      const active=t.country_id===activeCountryId?' active':'';
      h.push(`<path class="territory${active}" data-cid="${esc(t.country_id)}" d="${d}" fill="${fill}"
        onclick="selectCountry('${esc(t.country_id)}',event)"/>`);
      // country name label — always show at low zoom+
      if(co && vs>=Z_LOW){
        const cx=t.polygon.reduce((s,p)=>s+p[0],0)/t.polygon.length;
        const cy=t.polygon.reduce((s,p)=>s+p[1],0)/t.polygon.length;
        const fs=Math.max(8,Math.min(22,vs*120));
        h.push(`<text class="city-lbl" x="${sx(cx)}" y="${sy(cy)}" text-anchor="middle"
          font-size="${fs}px">${esc(co.name)}</text>`);
      }
    }
  }

  // Regions (optional layer) — semi-transparent overlay + dashed border + name
  if(L.regions){
    for(const r of world.regions||[]){
      const d=polyPath(r.polygon);if(!d)continue;
      const co=cmap[r.country_id];
      const fill=hexRgba(co?co.color:'#aaa',0.25);
      // dashed border darker than fill
      const stroke=co?co.color:'#888';
      // Regions: low pointer-events so territory click still works,
      // but label text is clickable to show region+country info (spec point 3)
      h.push(`<path class="region" d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="0.5" stroke-dasharray="4 2" pointer-events="none"/>`);
      // region name label at medium zoom+
      if(vs>=Z_MED && r.polygon.length>0){
        const cx=r.polygon.reduce((s,p)=>s+p[0],0)/r.polygon.length;
        const cy=r.polygon.reduce((s,p)=>s+p[1],0)/r.polygon.length;
        const fs=Math.max(6,Math.min(13,vs*75));
        const rCountry=cmap[r.country_id];
        const rInfo=`Pays: ${esc(rCountry?rCountry.name:r.country_id)}`;
        h.push(`<text class="city-lbl" x="${sx(cx)}" y="${sy(cy)}" text-anchor="middle"
          font-size="${fs}px" opacity="0.9" style="cursor:pointer"
          onclick="selectRegion(event,'${esc(r.country_id)}','${esc(r.name)}')">${esc(r.name)}</text>`);
      }
    }
  }

  // Geography — drawn OVER territories/regions so always visible (spec point 6)
  if(L.geography){
    const GC={
      terrain:'rgba(200,160,80,0.25)',
      climate:'rgba(80,200,120,0.25)',
      biome:'rgba(60,150,220,0.25)'
    };
    const GS={terrain:'rgba(180,130,40,0.7)',climate:'rgba(40,170,80,0.7)',biome:'rgba(30,100,200,0.7)'};
    for(const g of world.geography||[]){
      const d=polyPath(g.polygon);if(!d)continue;
      h.push(`<path class="geo-zone" d="${d}" fill="${GC[g.type]||GC.terrain}"
        stroke="${GS[g.type]||GS.terrain}" stroke-width="0.6" stroke-dasharray="5 3"
        pointer-events="all"
        onclick="showPopup(event,'${esc(g.name)}','Type: ${esc(g.type)}<br>Tags: ${esc((g.tags||[]).join(', ')||'—')}')"/>`);
      if(vs>=Z_LOW){
        const cx=g.polygon.reduce((s,p)=>s+p[0],0)/g.polygon.length;
        const cy=g.polygon.reduce((s,p)=>s+p[1],0)/g.polygon.length;
        const fs=Math.max(6,Math.min(12,vs*70));
        h.push(`<text class="infra-lbl" x="${sx(cx)}" y="${sy(cy)}" text-anchor="middle" font-size="${fs}px" opacity="0.85" pointer-events="none">${esc(g.name)}</text>`);
      }
    }
  }

  // Railways
  if(L.railways){
    for(const rw of world.railways||[]){
      const d=linePath(rw.nodes);if(!d)continue;
      h.push(`<path class="railway" d="${d}"/>`);
    }
  }

  // Roads
  if(L.roads){
    for(const rd of world.roads||[]){
      const d=linePath(rd.nodes);if(!d)continue;
      h.push(`<path class="road" d="${d}"/>`);
    }
  }

  // Conflicts: public sees occ-zones + frontlines; admin also sees battleplans+units
  if(L.conflicts){
    for(const c of conflicts){
      // Occupied zones — visible to all (spec point 4)
      for(const z of c.occupied_zones||[]){
        const d=polyPath(z.polygon);if(!d)continue;
        h.push(`<path class="occ-zone" d="${d}"
          onclick="showPopup(event,'Zone occupée','Occupant: ${esc(z.occupier||'—')}<br>Propriétaire: ${esc(z.original_owner||'—')}')"/>`);
      }
      // Frontlines — visible to all (spec point 4)
      for(const fl of c.frontlines||[]){
        const d=linePath(fl.nodes);if(!d)continue;
        h.push(`<path class="frontline" d="${d}"/>`);
      }
      if(adminMode){
        for(const bp of c.battleplans||[]){
          const d=linePath(bp.nodes);if(!d)continue;
          h.push(`<path class="battle-plan" d="${d}"/>`);
        }
        for(const u of c.units||[]){
          const ux=sx(u.position[0]),uy=sy(u.position[1]),us=6;
          h.push(`<rect class="unit-rect" x="${ux-us}" y="${uy-us}" width="${us*2}" height="${us*2}"
            onclick="showPopup(event,'${esc(u.name)}','Pays: ${esc(u.country_id)}<br>Type: ${esc(u.unit_type)}')"/>`);
          if(vs>=Z_MED) h.push(`<text class="unit-lbl" x="${ux+us+2}" y="${uy+3}" font-size="${Math.max(6,vs*80)}px">${esc(u.name)}</text>`);
        }
      }
    }
  }

  // Ports (high zoom or layer enabled)
  if(L.ports || vs>=Z_HIGH){
    for(const p of world.ports||[]){
      const px=sx(p.position[0]),py=sy(p.position[1]),s=5;
      h.push(`<rect class="port-icon" x="${px-s/2}" y="${py-s/2}" width="${s}" height="${s}"
        onclick="showPopup(event,'${esc(p.name)}','⚓ Port<br>Pays: ${esc(p.country_id)}')"/>`);
      if(vs>=Z_HIGH){
        const fs=Math.max(6,Math.min(12,vs*80));
        h.push(`<text class="infra-lbl" x="${px+s+2}" y="${py+3}" font-size="${fs}px">${esc(p.name)}</text>`);
      }
    }
  }

  // Airports (high zoom or layer enabled)
  if(L.airports || vs>=Z_HIGH){
    for(const a of world.airports||[]){
      const ax=sx(a.position[0]),ay=sy(a.position[1]),s=6;
      h.push(`<line class="ap-line" x1="${ax-s}" y1="${ay}" x2="${ax+s}" y2="${ay}"/>`);
      h.push(`<line class="ap-line" x1="${ax}" y1="${ay-s}" x2="${ax}" y2="${ay+s}"/>`);
      if(vs>=Z_HIGH){
        const fs=Math.max(6,Math.min(12,vs*80));
        h.push(`<text class="infra-lbl" x="${ax+s+2}" y="${ay+3}" font-size="${fs}px">${esc(a.name)}</text>`);
      }
    }
  }

  // Cities — adaptive by zoom
  if(L.cities){
    for(const city of world.cities||[]){
      const cxs=sx(city.position[0]),cys=sy(city.position[1]);
      const pop=city.population?`<br>Pop: ${Number(city.population).toLocaleString()}`:'';
      const info=`Pays: ${esc(city.country_id)}${pop}${city.capital?'<br>🏛 Capitale':''}`;
      if(city.capital){
        if(vs<Z_LOW)continue;
        const r=Math.max(4,vs*70);
        h.push(`<path class="capital" d="${starPath(cxs,cys,r)}"
          onclick="showPopup(event,'${esc(city.name)}','${info}')"/>`);
        const fs=Math.max(7,Math.min(18,vs*100));
        h.push(`<text class="city-lbl" x="${cxs+r+2}" y="${cys+3}" font-size="${fs}px">${esc(city.name)}</text>`);
      } else {
        if(vs<Z_MED)continue;
        const r=Math.max(3,vs*50);
        h.push(`<circle class="city-dot" cx="${cxs}" cy="${cys}" r="${r}"
          onclick="showPopup(event,'${esc(city.name)}','${info}')"/>`);
        if(vs>=Z_HIGH){
          const fs=Math.max(6,Math.min(14,vs*90));
          h.push(`<text class="city-lbl" x="${cxs+r+2}" y="${cys+3}" font-size="${fs}px">${esc(city.name)}</text>`);
        }
      }
    }
  }

  svg.innerHTML=h.join('\n');
}

// ── Country detail panel ───────────────────────────────────────────────────
function selectCountry(cid, event){
  event.stopPropagation();
  activeCountryId=cid;
  const cmap=countryMap();
  const co=cmap[cid];
  if(!co){activeCountryId=null;return;}

  const panel=document.getElementById('detail');
  document.getElementById('detail-name').textContent=co.name;

  // gather details
  const cities=(world.cities||[]).filter(c=>c.country_id===cid);
  const capitals=cities.filter(c=>c.capital);
  const ports=(world.ports||[]).filter(p=>p.country_id===cid);
  const airports=(world.airports||[]).filter(a=>a.country_id===cid);
  const roads=(world.roads||[]).filter(r=>r.continent_id);
  const regions=(world.regions||[]).filter(r=>r.country_id===cid);

  let body='';
  if(capitals.length) body+=`<div><strong>🏛 Capitale(s) :</strong> ${capitals.map(c=>esc(c.name)).join(', ')}</div>`;
  if(cities.length)   body+=`<div><strong>🏙 Villes :</strong> ${cities.length}</div>`;
  if(regions.length)  body+=`<div><strong>📐 Régions :</strong> ${regions.map(r=>esc(r.name)).join(', ')}</div>`;
  if(ports.length)    body+=`<div><strong>⚓ Ports :</strong> ${ports.map(p=>esc(p.name)).join(', ')}</div>`;
  if(airports.length) body+=`<div><strong>✈ Aéroports :</strong> ${airports.map(a=>esc(a.name)).join(', ')}</div>`;
  if(!body)           body='<em style="color:#6b7280">Aucune information disponible.</em>';

  document.getElementById('detail-body').innerHTML=body;
  panel.classList.add('open');
  render();
}

function closeDetail(){
  activeCountryId=null;
  document.getElementById('detail').classList.remove('open');
  render();
}

// ── Region detail (shows region name + opens country panel) ──────────────
function selectRegion(event, countryId, regionName){
  event.stopPropagation();
  // Show region popup then open country detail
  const cmap2=countryMap();
  const co=cmap2[countryId];
  const popInfo=`Région de : ${esc(co?co.name:countryId)}`;
  showPopup(event, regionName, popInfo);
  // Also open country detail panel
  selectCountry(countryId, event);
}

// ── Popup ──────────────────────────────────────────────────────────────────
function showPopup(event,title,body){
  event.stopPropagation();
  const p=document.getElementById('popup');
  p.querySelector('h3').textContent=title;
  p.querySelector('.pb').innerHTML=body;
  const x=Math.min(event.clientX+10,window.innerWidth-280);
  const y=Math.min(event.clientY+10,window.innerHeight-160);
  p.style.left=x+'px'; p.style.top=y+'px';
  p.classList.add('visible');
}
function closePopup(){document.getElementById('popup').classList.remove('visible');}
document.addEventListener('click',e=>{
  if(!e.target.closest('#popup'))closePopup();
  if(!e.target.closest('#detail')&&!e.target.closest('.territory'))closeDetail();
});

// ── Controls ──────────────────────────────────────────────────────────────
function setupControls(){
  const el=document.getElementById('map-container');
  el.addEventListener('wheel',e=>{
    e.preventDefault();
    const f=e.deltaY<0?1.15:1/1.15;
    const r=el.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
    vx=mx-(mx-vx)*f; vy=my-(my-vy)*f; vs*=f; render();
  },{passive:false});
  el.addEventListener('mousedown',e=>{drag=true;dx0=e.clientX;dy0=e.clientY;vx0=vx;vy0=vy;});
  window.addEventListener('mousemove',e=>{
    if(drag){vx=vx0+(e.clientX-dx0);vy=vy0+(e.clientY-dy0);render();}
    const r=el.getBoundingClientRect();
    const wx=(e.clientX-r.left-vx)/vs,wy=MAP_H-(e.clientY-r.top-vy)/vs;
    const cb=document.getElementById('coords');
    if(cb)cb.textContent=`(${Math.round(wx)}, ${Math.round(wy)})  zoom:${vs.toFixed(3)}`;
  });
  window.addEventListener('mouseup',()=>{drag=false;});
  window.addEventListener('resize',()=>{fitView();render();});
  // keyboard
  document.addEventListener('keydown',e=>{
    if(e.key==='f'||e.key==='F'){fitView();render();}
    if(e.key==='Escape'){closeDetail();closePopup();}
  });
}

// ── Layer panel ────────────────────────────────────────────────────────────
function buildLayerPanel(){
  const panel=document.getElementById('layer-list');if(!panel)return;
  const items=[
    ['continents','🌍 Continents'],['territories','🗺 Territoires'],
    ['regions','📐 Régions'],['geography','🗻 Géographie'],
    ['cities','🏙 Villes'],['roads','🛣 Routes'],['railways','🚆 Voies ferrées'],
    ['ports','⚓ Ports'],['airports','✈ Aéroports'],['conflicts','⚔ Conflits'],
  ];
  panel.innerHTML=items.map(([k,lbl])=>`
    <label class="layer-item">
      <input type="checkbox" ${L[k]?'checked':''} onchange="L['${k}']=this.checked;render()">
      ${lbl}
    </label>`).join('');
}

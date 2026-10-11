'use strict';
(() => {
const W=960,H=660,S=6,COLS=W/S,ROWS=H/S,N=COLS*ROWS;
const canvas=document.querySelector('#map'),ctx=canvas.getContext('2d');
const ground=document.createElement('canvas');ground.width=W;ground.height=H;const bg=ground.getContext('2d');
const $=s=>document.querySelector(s);
// Timers count active seconds; physical simulation uses 90% speed.
const PACE=.9, RESCUE_WINDOW=4, FIRE_RATE=.8;
const specs={clear:{name:'移除樹木',cool:5,maxLength:130,radius:8,unlock:0,hint:'只能移除完整綠色森林；燃燒或焦化區域無法施作。放開後沿路線逐段施工，每次最多 130 公尺，冷卻 5 秒。'},drone:{name:'無人機灑水',cool:2.5,radius:29,unlock:2,speed:150,hint:'點選目標，無人機由場外飛入，抵達後灑水。冷卻 2.5 秒。'},heli:{name:'直升機灑水',cool:15,radius:58,unlock:25,speed:115,hint:'點選目標，直升機由場外飛入，抵達後灑水。冷卻 15 秒。'}};
let cells,selected='clear',cooldowns={},effects=[],flights=[],clearJobs=[],weather,path=[],pointer=null,drag=false,activePointer=null,mode='ready',elapsed=0,simTime=0,last=0,acc=0,toastUntil=0,seed=47,initialFuel=0,restoreAfterHelp=false;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const lockedFor=k=>Math.max(0,specs[k].unlock-elapsed);
const available=k=>lockedFor(k)<=0&&cooldowns[k]<=0;
const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
function tell(text){$('#hint').textContent=text;toastUntil=elapsed+3;}
function init(){seed=47;elapsed=0;simTime=0;acc=0;effects=[];flights=[];clearJobs=[];path=[];drag=false;activePointer=null;pointer=null;selected='clear';cooldowns={clear:0,drone:0,heli:0};initialFuel=0;cells=Array.from({length:N},(_,i)=>{const x=(i%COLS+.5)*S,y=(Math.floor(i/COLS)+.5)*S,fuel=1;initialFuel+=fuel;return{x,y,fuel,fire:0,wet:0,burn:0,burningFor:0,rescued:0,clear:false};});
const ignitionDistance=c=>Math.hypot(c.x-633,c.y-265);
const initialCount=Math.round(cells.filter(c=>ignitionDistance(c)<21&&c.fuel).length*1.2);
for(const c of cells.filter(c=>c.fuel).sort((a,b)=>ignitionDistance(a)-ignitionDistance(b)).slice(0,initialCount))c.fire=.8;
paintGround();const direction=Math.random()*360,speed=4+Math.random()*12;weather={direction,speed,targetDirection:direction,targetSpeed:speed,nextChange:8+Math.random()*5,changes:0};mode='ready';$('#overlay-title').textContent='每一條防線，都能守住森林。';$('#overlay-copy').textContent='無人機於 2 秒後待命，直升機於 25 秒後支援。留意右上角風況，及時救回仍可復原的樹林。';$('#start').textContent='開始滅火行動 →';$('.briefing').hidden=false;$('#overlay').classList.remove('hidden');$('#pause').textContent='Ⅱ';toastUntil=0;updateUI();}
// A wooded mountain hollow: broad valley floor, enclosing slopes and a northern headwall.
function terrainHeight(x,y){
  const center=470+62*Math.sin(y/185)+18*Math.sin(y/79);
  const side=Math.pow(Math.abs(x-center)/425,1.7);
  const headwall=.5*Math.exp(-Math.pow((y+30)/175,2));
  const ridges=.045*Math.sin(x/78+y/110)+.028*Math.cos(x/44-y/97);
  return Math.max(0,side+headwall+ridges);
}
function paintGround(){
  bg.fillStyle='#36583a';bg.fillRect(0,0,W,H);
  for(let y=0;y<H;y+=4)for(let x=0;x<W;x+=4){
    const h=terrainHeight(x,y),dx=terrainHeight(x+3,y)-terrainHeight(x-3,y),dy=terrainHeight(x,y+3)-terrainHeight(x,y-3);
    const light=clamp(31+h*9-dx*330-dy*180+random()*2,22,47);
    const hue=111-Math.min(h,1)*17;
    bg.fillStyle=`hsl(${hue} 26% ${light}%)`;bg.fillRect(x,y,4,4);
  }
  // Contours sampled from the same relief, rather than decorative road-like strokes.
  const grid=12;
  for(const level of [.1,.2,.3,.4,.55,.7,.85,1,1.2]){
    bg.strokeStyle=level===.4||level===.85?'#d1d7ac35':'#c0cda521';bg.lineWidth=level===.4||level===.85?1:.65;bg.beginPath();
    for(let y=0;y<H;y+=grid)for(let x=0;x<W;x+=grid){
      const corners=[{x,y},{x:x+grid,y},{x:x+grid,y:y+grid},{x,y:y+grid}],hits=[];
      for(let i=0;i<4;i++){
        const a=corners[i],b=corners[(i+1)%4],ha=terrainHeight(a.x,a.y),hb=terrainHeight(b.x,b.y);
        if((ha<level)!==(hb<level)){const t=(level-ha)/(hb-ha);hits.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
      }
      for(let i=0;i+1<hits.length;i+=2){bg.moveTo(hits[i].x,hits[i].y);bg.lineTo(hits[i+1].x,hits[i+1].y);}
    }
    bg.stroke();
  }
  for(let k=0;k<4200;k++){
    const x=random()*W,y=random()*H,h=terrainHeight(x,y),size=3+random()*4.5;
    bg.fillStyle='#122d2259';bg.beginPath();bg.ellipse(x+2,y+4,size,size*.55,.3,0,7);bg.fill();
    const lum=clamp(24+h*7+random()*11,24,43);
    bg.fillStyle=`hsl(${115-Math.min(h,1)*13} 30% ${lum}%)`;
    bg.beginPath();bg.moveTo(x,y-size);bg.lineTo(x-size*.7,y+size*.55);bg.lineTo(x+size*.7,y+size*.55);bg.closePath();bg.fill();
    bg.strokeStyle='#b1c88929';bg.lineWidth=.7;bg.beginPath();bg.moveTo(x,y-size);bg.lineTo(x-size*.6,y+size*.45);bg.stroke();
  }
}
function nearPath(c,points,r){for(let i=0;i<points.length;i++){const a=points[i],b=points[i+1]||a,dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((c.x-a.x)*dx+(c.y-a.y)*dy)/(dx*dx+dy*dy||1)));if((c.x-a.x-t*dx)**2+(c.y-a.y-t*dy)**2<=r*r)return true;}return false;}
function inArea(points,r,fn){const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x0=clamp(Math.floor((Math.min(...xs)-r)/S),0,COLS-1),x1=clamp(Math.floor((Math.max(...xs)+r)/S),0,COLS-1),y0=clamp(Math.floor((Math.min(...ys)-r)/S),0,ROWS-1),y1=clamp(Math.floor((Math.max(...ys)+r)/S),0,ROWS-1);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const c=cells[y*COLS+x];if(nearPath(c,points,r))fn(c);}}
function water(points,r,strength=2){inArea(points,r,c=>{if(c.fire>0){c.fire=Math.max(0,c.fire-strength);if(c.fire===0){if(c.burningFor<RESCUE_WINDOW&&c.burn===0&&!c.clear){c.fuel=1;c.rescued=2.5;}c.burningFor=0;}}c.wet=Math.max(c.wet,14);});}
function updateWeather(dt){weather.nextChange-=dt;if(weather.nextChange<=0){weather.targetDirection=weather.direction+(Math.random()<.5?-1:1)*(35+Math.random()*65);let next=4+Math.random()*14;if(Math.abs(next-weather.speed)<2)next=weather.speed>11?5:17;weather.targetSpeed=next;weather.nextChange=10+Math.random()*8;weather.changes++;}const blend=1-Math.exp(-dt/2.5);weather.direction+=(weather.targetDirection-weather.direction)*blend;weather.speed+=(weather.targetSpeed-weather.speed)*blend;}
function dispatch(type,target){const entries=[{x:-55,y:target.y},{x:W+55,y:target.y},{x:target.x,y:-55},{x:target.x,y:H+55}],entry=entries.reduce((a,b)=>Math.hypot(a.x-target.x,a.y-target.y)<Math.hypot(b.x-target.x,b.y-target.y)?a:b),distance=Math.hypot(target.x-entry.x,target.y-entry.y);flights.push({type,x:entry.x,y:entry.y,target:{...target},dx:(target.x-entry.x)/distance,dy:(target.y-entry.y)/distance,phase:'inbound',drop:0});}
function updateFlights(dt){flights=flights.filter(f=>{const speed=specs[f.type].speed;if(f.phase==='inbound'){const distance=Math.hypot(f.target.x-f.x,f.target.y-f.y);if(distance<=speed*dt){f.x=f.target.x;f.y=f.target.y;f.phase='dropping';f.drop=1.4;water([f.target],specs[f.type].radius);effects.push({type:'water',x:f.x,y:f.y,r:specs[f.type].radius,life:2});tell(`${specs[f.type].name}已抵達目標，正在灑水。`);}else{f.x+=f.dx*speed*dt;f.y+=f.dy*speed*dt;}}else if(f.phase==='dropping'){water([f.target],specs[f.type].radius,1.5*dt);f.drop-=dt;if(f.drop<=0)f.phase='outbound';}else{f.x+=f.dx*speed*dt;f.y+=f.dy*speed*dt;}return f.x>=-70&&f.x<=W+70&&f.y>=-70&&f.y<=H+70;});}
// Spread declines over active time to a positive floor after 120 seconds.
function spreadMultiplier(seconds){return Math.max(.8,1.3-.5*Math.max(0,seconds)/120);}
function updateFire(dt,activeDt){
const spread=spreadMultiplier(elapsed);
const angle=weather.direction*Math.PI/180,wx=-Math.sin(angle),wy=Math.cos(angle),speed=weather.speed,ignite=[];
for(let i=0;i<N;i++){const c=cells[i];c.wet=Math.max(0,c.wet-dt);c.rescued=Math.max(0,c.rescued-dt);if(c.fire<=0)continue;const before=c.burningFor;c.burningFor+=activeDt;const damageDt=Math.max(0,c.burningFor-RESCUE_WINDOW)-Math.max(0,before-RESCUE_WINDOW);c.fuel=Math.max(0,c.fuel-damageDt*PACE*FIRE_RATE*.014);c.burn=Math.min(1,c.burn+damageDt*PACE*FIRE_RATE*.023);if(!c.fuel){c.fire=0;c.burningFor=0;continue;}c.fire=Math.min(1,c.fire+dt*FIRE_RATE*.13);const gx=i%COLS,gy=Math.floor(i/COLS);
for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){if(gx+dx<0||gx+dx>=COLS||gy+dy<0||gy+dy>=ROWS)continue;const j=i+dx+dy*COLS,t=cells[j];if(t.fuel<=0||t.fire||t.burn>0||t.wet>0||t.clear)continue;const wind=1+(dx*wx+dy*wy)/Math.hypot(dx,dy)*speed/25;if(random()<dt*FIRE_RATE*.14*spread*wind)ignite.push(j);}}
for(const i of ignite)if(!cells[i].fire&&cells[i].burn===0){cells[i].fire=.65;cells[i].burningFor=0;}}
function updateClearJobs(dt){
  clearJobs=clearJobs.filter(job=>{
    let distance=32*dt;
    while(distance>1e-8&&job.segment<job.route.length-1){
      const target=job.route[job.segment+1],dx=target.x-job.position.x,dy=target.y-job.position.y,length=Math.hypot(dx,dy);
      if(length<1e-8){job.segment++;continue;}
      const travel=Math.min(distance,length),next={x:job.position.x+dx*travel/length,y:job.position.y+dy*travel/length};
      inArea([job.position,next],specs.clear.radius,c=>{if(canClear(c)){c.fuel=0;c.clear=true;job.removed++;}});
      job.position=next;distance-=travel;
      if(travel>=length-1e-8)job.segment++;
    }
    if(job.segment>=job.route.length-1){tell(job.removed?'這段防火帶已完成。':'施工路線已走完，沿途沒有可移除的完整綠林。');return false;}
    return true;
  });
}
function simulate(activeDt){if(mode!=='running')return;const dt=activeDt*PACE;elapsed+=activeDt;simTime+=dt;for(const key in cooldowns)cooldowns[key]=Math.max(0,cooldowns[key]-activeDt);updateWeather(dt);updateFire(dt,activeDt);updateFlights(dt);updateClearJobs(dt);
effects=effects.filter(e=>(e.life-=dt)>0);
const loss=cells.reduce((s,c)=>s+c.burn,0)/initialFuel;
if(!cells.some(c=>c.fire>0))finish(true,loss);else if(loss>=.6)finish(false,loss);
updateUI();}
function finish(win,loss){mode='ended';cancelDraw();$('#overlay-title').textContent=win?'防線守住了，森林謝謝你。':'火勢已超出控制範圍';$('#overlay-copy').textContent=`行動 ${Math.floor(elapsed)} 秒 · 森林保留率 ${Math.round((1-loss)*100)}%。${win?'及時撲滅的樹林已恢復綠色。':'試著提前清出防火帶，等待航空支援抵達火場。'}`;$('#start').textContent='再挑戰一次 →';$('.briefing').hidden=true;$('#overlay').classList.remove('hidden');}
function updateUI(){const loss=cells.reduce((s,c)=>s+c.burn,0)/initialFuel,saved=Math.max(0,100-loss*100);$('#saved').innerHTML=`${saved.toFixed(0)}<span>%</span>`;$('#saved-bar').style.width=saved+'%';const seconds=Math.floor(elapsed+1e-7);$('#time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('#fire-count').textContent=`${cells.filter(c=>c.fire>0).length} 個燃燒格`;
const names=['北','東北','東','東南','南','西南','西','西北'],bearing=(weather.direction%360+360)%360,from=names[Math.round(bearing/45)%8],to=names[Math.round((bearing+180)/45)%8];$('#wind-value').textContent=`${weather.speed.toFixed(1)} km/h`;$('#wind-direction').textContent=`${from}風 · 吹向${to}`;$('#wind-arrow').style.transform=`rotate(${weather.direction+180}deg)`;
if(elapsed>=toastUntil)$('#hint').textContent=specs[selected].hint;document.querySelectorAll('.tool').forEach(b=>{const k=b.dataset.tool,left=cooldowns[k],opening=lockedFor(k);b.classList.toggle('selected',k===selected);b.classList.toggle('cooling',!available(k));b.classList.toggle('locked',opening>0);b.setAttribute('aria-pressed',String(k===selected));b.querySelector('.cooldown-label').textContent=opening>0?`開場待命 ${Math.ceil(opening)} 秒`:left>0?`冷卻中 ${left.toFixed(1)} 秒`:`就緒 · 冷卻 ${specs[k].cool} 秒`;b.querySelector('i').style.width=(opening>0?1-opening/specs[k].unlock:1-left/specs[k].cool)*100+'%';});}
function drawLine(points,color,width,dash=[]){if(!points.length)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash(dash);ctx.beginPath();points.forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);}
function drawAircraft(f){ctx.save();ctx.translate(f.x,f.y);ctx.rotate(Math.atan2(f.dy,f.dx)+Math.PI/2);ctx.shadowColor='#001b27aa';ctx.shadowBlur=7;ctx.shadowOffsetY=5;if(f.type==='drone'){ctx.strokeStyle='#dcecef';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-10,-10);ctx.lineTo(10,10);ctx.moveTo(-10,10);ctx.lineTo(10,-10);ctx.stroke();ctx.fillStyle='#d9ebea';ctx.fillRect(-5,-8,10,16);ctx.strokeStyle='#aaf2ee';ctx.lineWidth=2;for(const x of [-12,12])for(const y of [-12,12]){ctx.beginPath();ctx.arc(x,y,7,simTime*25,simTime*25+5.4);ctx.stroke();}ctx.fillStyle='#42bfb0';ctx.fillRect(-3,-6,6,5);}else{ctx.strokeStyle='#d5dfd9';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,29);ctx.moveTo(-8,26);ctx.lineTo(8,26);ctx.stroke();ctx.fillStyle='#ecded0';ctx.beginPath();ctx.ellipse(0,-1,9,18,0,0,7);ctx.fill();ctx.fillStyle='#d9674b';ctx.fillRect(-9,-1,18,7);ctx.fillStyle='#315b64';ctx.beginPath();ctx.ellipse(0,-9,6,7,0,0,7);ctx.fill();ctx.rotate(simTime*24);ctx.strokeStyle='#e5f2ebcc';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-28,0);ctx.lineTo(28,0);ctx.moveTo(0,-28);ctx.lineTo(0,28);ctx.stroke();}ctx.restore();}
function render(){ctx.drawImage(ground,0,0);for(const c of cells){if(c.burn>0){ctx.fillStyle=`rgba(30,27,24,${Math.min(.94,c.burn+.16)})`;ctx.fillRect(c.x-S/2,c.y-S/2,S,S);}if(c.clear){ctx.fillStyle='#baa17b';ctx.fillRect(c.x-S/2,c.y-S/2,S,S);}if(c.wet>0){ctx.fillStyle=`rgba(70,191,225,${Math.min(.16,c.wet/90)})`;ctx.fillRect(c.x-S/2,c.y-S/2,S,S);}if(c.rescued>0){ctx.fillStyle=`rgba(143,255,165,${c.rescued/8})`;ctx.fillRect(c.x-3,c.y-3,S,S);}if(c.fire>0){const f=Math.sin(simTime*6+c.x*.6+c.y*.4);ctx.fillStyle=f>.2?'#ffb442':f>-.5?'#f87931':'#db4726';ctx.fillRect(c.x-3,c.y-3,6,6);if(f>.6){ctx.fillStyle='#ffdf84';ctx.fillRect(c.x-1,c.y-5,2,5);}}}
for(const job of clearJobs){
  drawLine([job.position,...job.route.slice(job.segment+1)],'#f6d59399',2,[5,6]);
  const p=job.position,target=job.route[job.segment+1];
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(target.y-p.y,target.x-p.x));
  ctx.fillStyle='#172d29';ctx.fillRect(-10,-9,19,5);ctx.fillRect(-10,4,19,5);
  ctx.fillStyle='#eab557';ctx.fillRect(-8,-6,16,12);ctx.fillStyle='#477277';ctx.fillRect(-4,-4,6,8);
  ctx.fillStyle='#f3ddac';ctx.fillRect(9,-9,4,18);ctx.restore();
}
for(const e of effects){ctx.fillStyle=`rgba(144,225,255,${e.life*.13})`;ctx.strokeStyle=`rgba(172,238,255,${e.life/2})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,e.r*(1.2-e.life*.1),0,7);ctx.fill();ctx.stroke();}
for(const f of flights){if(f.phase==='inbound'){drawLine([{x:f.x,y:f.y},f.target],'#c7f3fa55',1,[4,7]);ctx.strokeStyle='#b0edf6';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(f.target.x,f.target.y,specs[f.type].radius,0,7);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e8ffff';ctx.font='11px Microsoft JhengHei';const eta=Math.ceil(Math.hypot(f.target.x-f.x,f.target.y-f.y)/specs[f.type].speed/PACE);ctx.fillText(`${f.type==='drone'?'無人機':'直升機'} · ${eta} 秒抵達`,clamp(f.target.x-35,8,W-115),clamp(f.target.y-specs[f.type].radius-10,18,H-18));}drawAircraft(f);}
if(path.length){inArea(path,8,c=>{ctx.fillStyle=canClear(c)?'#f0d4a599':'#ed6a5866';ctx.fillRect(c.x-3,c.y-3,S,S);});}
if(pointer&&mode==='running'){ctx.strokeStyle=available(selected)?'#cbffff':'#eead72';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.arc(pointer.x,pointer.y,specs[selected].radius,0,7);ctx.stroke();ctx.setLineDash([]);}
ctx.fillStyle='#d4e3d3';ctx.font='10px Segoe UI';ctx.fillText('0                 100 m',W-123,H-23);ctx.fillRect(W-123,H-16,100,2);
}
function position(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(W,(e.clientX-r.left)*W/r.width)),y:Math.max(0,Math.min(H,(e.clientY-r.top)*H/r.height))};}
function cancelDraw(){drag=false;activePointer=null;path=[];}
function select(k){selected=k;cancelDraw();toastUntil=0;updateUI();}
function down(e){if(mode!=='running'||drag||(e.button!==undefined&&e.button!==0))return;pointer=position(e);if(!available(selected)){tell(lockedFor(selected)>0?`${specs[selected].name}尚在整備，${Math.ceil(lockedFor(selected))} 秒後開放。先部署地面防線。`:`${specs[selected].name}冷卻中，還需 ${Math.ceil(cooldowns[selected])} 秒。`);return;}canvas.setPointerCapture(e.pointerId);activePointer=e.pointerId;drag=true;path=[pointer];}
function move(e){if(drag&&e.pointerId!==activePointer)return;pointer=position(e);if(!drag)return;if(selected==='clear'){const last=path[path.length-1],distance=Math.hypot(pointer.x-last.x,pointer.y-last.y);if(distance<4)return;let length=0;for(let i=1;i<path.length;i++)length+=Math.hypot(path[i].x-path[i-1].x,path[i].y-path[i-1].y);const limit=specs[selected].maxLength;if(length+distance>limit){const remaining=limit-length;if(remaining>0.5)path.push({x:last.x+(pointer.x-last.x)*remaining/distance,y:last.y+(pointer.y-last.y)*remaining/distance});return;}path.push(pointer);}}
function canClear(c){return !c.clear&&c.fire===0&&c.burn===0&&c.fuel>=1;}
function up(e){
  if(!drag||e.pointerId!==activePointer)return;
  move(e);drag=false;activePointer=null;
  if(mode!=='running'||!available(selected)){path=[];return;}
  const s=specs[selected];
  if(selected==='clear'){
    if(path.length<2){tell('請按住並拖曳畫出一條線。');path=[];return;}
    let valid=0;
    inArea(path,8,c=>{if(canClear(c))valid++;});
    if(!valid){tell('只能移除完整綠色森林；燃燒中、焦化或已移除的區域無法施作。');path=[];updateUI();return;}
    const route=path.map(p=>({...p}));
    clearJobs.push({route,position:{...route[0]},segment:0,removed:0});
    tell('施工隊已出發，正沿你畫出的路線逐段移除樹木。');
  }else{dispatch(selected,position(e));tell(`${s.name}已出動！抵達目標後開始灑水。`);}
  cooldowns[selected]=s.cool;path=[];updateUI();
}
function pause(){if(mode==='running'){mode='paused';cancelDraw();$('#pause').textContent='▶';$('#overlay-title').textContent='行動暫停';$('#overlay-copy').textContent='火勢、風況、施工隊、航空器與所有倒數皆已暫停。';$('#start').textContent='繼續行動 →';$('.briefing').hidden=true;$('#overlay').classList.remove('hidden');}else if(mode==='paused')start();}
function start(){if(mode==='ended')init();mode='running';$('#overlay').classList.add('hidden');$('#pause').textContent='Ⅱ';acc=0;}
canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancelDraw);canvas.addEventListener('lostpointercapture',cancelDraw);canvas.addEventListener('pointerleave',()=>{if(!drag)pointer=null;});document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>select(b.dataset.tool)));$('#start').onclick=start;$('#pause').onclick=pause;$('#reset').onclick=init;$('#help').onclick=()=>{restoreAfterHelp=mode==='running';if(restoreAfterHelp)pause();$('#help-dialog').showModal();};$('#close-help').onclick=()=>$('#help-dialog').close();$('#help-dialog').addEventListener('close',()=>{if(restoreAfterHelp&&mode==='paused')start();restoreAfterHelp=false;});document.addEventListener('keydown',e=>{if($('#help-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(['1','2','3'].includes(e.key))select(Object.keys(specs)[Number(e.key)-1]);if(e.code==='Space'&&document.activeElement.tagName!=='BUTTON'){e.preventDefault();pause();}if(e.key==='Escape')cancelDraw();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='running')pause();});
function frame(now){const dt=Math.min(.1,(now-last)/1000||0);last=now;if(mode==='running'){acc+=dt;while(acc>=.1&&mode==='running'){simulate(.1);acc-=.1;}}render(now);requestAnimationFrame(frame);}init();requestAnimationFrame(frame);
})();

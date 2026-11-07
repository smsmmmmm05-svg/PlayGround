(() => {
  'use strict';
  const canvas = document.getElementById('ocean');
  const ctx = canvas.getContext('2d', { alpha: false });
  const ui = {
    score: document.getElementById('score'), timer: document.getElementById('timer'), best: document.getElementById('best'),
    timerStat: document.querySelector('.timer-stat'), growth: document.querySelector('.growth-card'), growthCount: document.getElementById('growth-count'),
    growthFill: document.getElementById('growth-fill'), size: document.getElementById('size-label'), welcome: document.getElementById('welcome-screen'),
    end: document.getElementById('end-screen'), start: document.getElementById('start-button'), restart: document.getElementById('restart-button'),
    bottomHint: document.getElementById('bottom-hint'), toast: document.getElementById('toast'), sound: document.getElementById('sound-button'),
    soundIcon: document.getElementById('sound-icon'), finalScore: document.getElementById('final-score'), finalBest: document.getElementById('final-best'),
    endTitle: document.getElementById('end-title'), endMessage: document.getElementById('end-message'), endEyebrow: document.getElementById('end-eyebrow'), endMedal: document.getElementById('end-medal')
  };
  const TAU = Math.PI * 2;
  let width = 0, height = 0, dpr = 1, lastTime = 0, elapsed = 0, score = 0, eaten = 0, stage = 0, lastTimerSecond = 60;
  let best = Number(localStorage.getItem('tinyTideBest') || 0), playing = false, gameEnded = false, soundOn = false;
  let player = { x: 0, y: 0, r: 17, vx: 0, vy: 0, angle: 0, targetX: 0, targetY: 0, blink: 0 };
  let fishes = [], bubbles = [], particles = [], pointer = { active: false, x: 0, y: 0 }, toastTimer = 0, spawnTimer = 0, audioCtx = null;
  ui.best.textContent = pad(best);

  function pad(n) { return String(Math.floor(n)).padStart(3, '0'); }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize, { passive: true }); resize();

  function random(min, max) { return min + Math.random() * (max - min); }
  function makeFish(x, y, forcedType) {
    const palette = ['#ffb16e', '#f0827c', '#9cdbad', '#e7d77f', '#c4a4e8', '#64cbd0', '#f49dbc'];
    const predator = forcedType === 'predator' || (!forcedType && Math.random() < .18);
    const r = predator ? random(25, 34) + stage * 1.1 : random(9, 15) + Math.min(stage * .35, 3);
    const direction = Math.random() < .5 ? -1 : 1;
    return { x, y, r, predator, color: palette[Math.floor(Math.random() * palette.length)], vx: direction * random(18, 42), vy: random(-12, 12), phase: random(0, TAU), turn: random(.4, 2), facing: direction, stripe: Math.random() > .5, spots: Math.random() > .58, speed: predator ? random(22, 38) : random(15, 30) };
  }
  function populate() {
    fishes = [];
    const count = Math.max(17, Math.min(31, Math.round(width * height / 35000)));
    for (let i = 0; i < count; i++) {
      const a = random(0, TAU), dist = random(Math.min(width, height) * .28, Math.max(width, height) * .7);
      fishes.push(makeFish(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist));
    }
  }
  function resetGame() {
    score = 0; elapsed = 0; eaten = 0; stage = 0; gameEnded = false; playing = true;
    player = { x: 0, y: 0, r: 17, vx: 0, vy: 0, angle: 0, targetX: 0, targetY: 0, blink: 0 };
    pointer.active = false; particles = []; spawnTimer = 0;
    populate(); updateHud();
    ui.welcome.classList.add('hidden'); ui.end.classList.add('hidden'); ui.growth.classList.add('active'); ui.bottomHint.classList.add('active');
    lastTime = performance.now();
  }
  function updateHud() {
    ui.score.textContent = pad(score); ui.best.textContent = pad(best);
    lastTimerSecond = Math.max(0, Math.ceil(60 - elapsed));
    ui.timer.textContent = lastTimerSecond;
    ui.timerStat.classList.toggle('urgent', 60 - elapsed <= 10);
    ui.growthCount.textContent = `${eaten % 5} / 5`;
    ui.growthFill.style.width = `${(eaten % 5) * 20}%`;
    const names = ['LITTLE GUPPY', 'TINY TUNA', 'REEF RUNNER', 'OCEAN STAR', 'SEA LEGEND'];
    ui.size.textContent = names[Math.min(stage, names.length - 1)];
  }
  function endGame(reason) {
    if (gameEnded) return;
    gameEnded = true; playing = false; pointer.active = false;
    const isBest = score > best;
    if (isBest) { best = score; localStorage.setItem('tinyTideBest', best); }
    updateHud(); ui.finalScore.textContent = pad(score); ui.finalBest.textContent = pad(best);
    if (reason === 'time') {
      ui.endEyebrow.textContent = 'TIME FOR A TIDAL BREATH'; ui.endTitle.innerHTML = 'What a<br><em>lovely swim.</em>';
      ui.endMessage.textContent = isBest ? 'A brand-new best! The ocean is cheering.' : 'The sea will save you a sunny spot.'; ui.endMedal.textContent = '◷';
    } else {
      ui.endEyebrow.textContent = isBest ? 'A NEW PERSONAL BEST!' : 'THE OCEAN IS FULL OF SURPRISES';
      ui.endTitle.innerHTML = isBest ? 'Sea star<br><em>status.</em>' : 'A bigger fish<br><em>today.</em>';
      ui.endMessage.textContent = isBest ? 'You made quite the splash out there.' : 'Every great swimmer learns the currents.'; ui.endMedal.textContent = isBest ? '♛' : '✦';
    }
    ui.end.classList.remove('hidden'); ui.bottomHint.classList.remove('active'); ui.growth.classList.remove('active'); playTone(reason === 'time' ? 510 : 180, .2, 'sine');
  }

  function screenToWorld(sx, sy) { return { x: sx + player.x - width / 2, y: sy + player.y - height / 2 }; }
  function setTarget(sx, sy) {
    const p = screenToWorld(sx, sy); player.targetX = p.x; player.targetY = p.y; pointer.x = sx; pointer.y = sy; pointer.active = true;
  }
  canvas.addEventListener('pointerdown', e => {
    if (!playing) return;
    canvas.setPointerCapture?.(e.pointerId); setTarget(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', e => { if (playing && (e.buttons || e.pointerType === 'touch')) setTarget(e.clientX, e.clientY); });
  canvas.addEventListener('pointerup', () => { pointer.active = false; });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; });
  window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !playing) resetGame();
    const dirs = { ArrowUp: [0,-1], w: [0,-1], ArrowDown: [0,1], s: [0,1], ArrowLeft: [-1,0], a: [-1,0], ArrowRight: [1,0], d: [1,0] };
    if (playing && dirs[e.key]) { e.preventDefault(); player.targetX += dirs[e.key][0] * 130; player.targetY += dirs[e.key][1] * 130; pointer.active = true; }
  });
  ui.start.addEventListener('click', () => { unlockAudio(); resetGame(); });
  ui.restart.addEventListener('click', () => { unlockAudio(); resetGame(); });
  ui.sound.addEventListener('click', () => { soundOn = !soundOn; ui.soundIcon.textContent = soundOn ? '♫' : '♪'; ui.sound.classList.toggle('sound-on', soundOn); if (soundOn) { unlockAudio(); playTone(680, .09, 'sine'); } });

  function unlockAudio() {
    if (!soundOn) return;
    try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (_) {}
  }
  function playTone(freq, duration, type = 'sine') {
    if (!soundOn) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator(), gain = audioCtx.createGain();
      oscillator.type = type; oscillator.frequency.value = freq; gain.gain.setValueAtTime(.055, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
      oscillator.connect(gain); gain.connect(audioCtx.destination); oscillator.start(); oscillator.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function update(dt) {
    if (playing) {
      elapsed += dt;
      const remaining = Math.max(0, Math.ceil(60 - elapsed));
      if (remaining !== lastTimerSecond) {
        lastTimerSecond = remaining; ui.timer.textContent = remaining;
        ui.timerStat.classList.toggle('urgent', remaining <= 10);
      }
      if (elapsed >= 60) { elapsed = 60; updateHud(); endGame('time'); return; }
      if (pointer.active) {
        const dx = player.targetX - player.x, dy = player.targetY - player.y;
        const dist = Math.hypot(dx, dy), speed = 230 + stage * 12;
        const desired = Math.min(speed, dist * 3.2);
        const ax = dist ? dx / dist * desired : 0, ay = dist ? dy / dist * desired : 0;
        player.vx += (ax - player.vx) * Math.min(1, dt * 3.3); player.vy += (ay - player.vy) * Math.min(1, dt * 3.3);
      } else { player.vx *= Math.pow(.06, dt); player.vy *= Math.pow(.06, dt); }
      player.x += player.vx * dt; player.y += player.vy * dt;
      if (Math.hypot(player.vx, player.vy) > 5) player.angle = Math.atan2(player.vy, player.vx);
      player.blink -= dt;
      if (player.blink <= 0) player.blink = random(2.2, 5);
      spawnTimer += dt;
      if (spawnTimer > 1.25 && fishes.length < 36) {
        spawnTimer = 0; const a = random(0, TAU), d = Math.max(width, height) * .72;
        fishes.push(makeFish(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d));
      }
      for (let i = fishes.length - 1; i >= 0; i--) {
        const f = fishes[i]; f.phase += dt * 4; f.turn -= dt;
        const dx = player.x - f.x, dy = player.y - f.y, dist = Math.hypot(dx, dy);
        if (f.predator && dist < 280 && f.r > player.r * 1.14) {
          const chase = Math.min(1, (280 - dist) / 160) * .65;
          f.vx += (dx / (dist || 1) * f.speed * chase - f.vx) * dt * .7;
          f.vy += (dy / (dist || 1) * f.speed * chase - f.vy) * dt * .7;
        } else if (f.turn <= 0) { f.turn = random(.7, 2.4); f.vy += random(-18, 18); f.vx += (Math.sign(f.vx || 1) * f.speed - f.vx) * .4; }
        f.vy += Math.sin(f.phase * .45) * 4 * dt;
        f.vx = Math.max(-f.speed, Math.min(f.speed, f.vx)); f.vy = Math.max(-f.speed * .7, Math.min(f.speed * .7, f.vy));
        f.x += f.vx * dt; f.y += f.vy * dt; if (Math.abs(f.vx) > 2) f.facing = Math.sign(f.vx);
        if (dist < player.r + f.r * .75) {
          if (player.r > f.r * 1.12) {
            fishes.splice(i, 1); score += Math.round(10 + f.r); eaten++; spawnParticles(f.x, f.y, f.color, 9); playTone(490 + Math.random() * 260, .1);
            if (eaten % 5 === 0) { stage++; player.r += 2.5; spawnParticles(player.x, player.y, '#ffe4a0', 22); showToast(); playTone(760, .24, 'triangle'); }
            updateHud();
          } else if (f.r > player.r * 1.12) { endGame('predator'); return; }
        }
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .97; p.vy *= .97; if (p.life <= 0) particles.splice(i, 1); }
    for (const b of bubbles) { b.y -= b.speed * dt; b.x += Math.sin(b.phase += dt) * 5 * dt; if (b.y < -15) { b.y = height + 12; b.x = random(0,width); } }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }
  }
  function showToast() { ui.toast.classList.add('show'); toastTimer = 1.6; }
  function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) { const a = random(0, TAU), s = random(25, 130); particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: random(.35,.8), max: .8, color, r: random(2,5) }); }
  }
  function ensureBubbles() {
    bubbles = Array.from({ length: Math.max(22, Math.min(50, Math.round(width / 24))) }, () => ({ x: random(0,width), y: random(0,height), r: random(1,4), speed: random(8,24), phase: random(0,TAU), alpha: random(.1,.34) }));
  }
  ensureBubbles();
  window.addEventListener('resize', ensureBubbles, { passive: true });

  function drawBackground(t) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#0b6687'); grad.addColorStop(.47, '#08718e'); grad.addColorStop(1, '#06415f');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width*.52, height*.27, 8, width*.52, height*.27, Math.max(width,height)*.72);
    glow.addColorStop(0, 'rgba(116,224,202,.21)'); glow.addColorStop(.58, 'rgba(28,154,177,.08)'); glow.addColorStop(1, 'rgba(1,42,69,0)');
    ctx.fillStyle = glow; ctx.fillRect(0,0,width,height);
    ctx.save(); ctx.globalAlpha = .055; ctx.fillStyle = '#d6ffe2';
    const drift = (t*.012) % 120;
    for (let i=0;i<5;i++) { const x = width*(.09+i*.22)+Math.sin(t*.0003+i)*24; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x+35+drift,0); ctx.lineTo(x+width*.13+drift,height*.78); ctx.lineTo(x+width*.1,height*.78); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    for (const b of bubbles) {
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.strokeStyle=`rgba(190,246,225,${b.alpha})`; ctx.lineWidth=1; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x-b.r*.25,b.y-b.r*.28,Math.max(.5,b.r*.2),0,TAU); ctx.fillStyle=`rgba(234,255,235,${b.alpha*.85})`; ctx.fill();
    }
    // Soft distant reef silhouettes.
    drawReefLayer(height*.91, .16, '#07526b', t, 0);
    drawReefLayer(height*.965, .22, '#06485f', t, 1);
    drawSeaweed(t);
    ctx.save();
    for (let i=0;i<18;i++) { const x = (i*83 + (t*.004)%83) % width; const y = height*.82 + Math.sin(i*7.7)*height*.13; ctx.fillStyle=`rgba(195,239,196,${.12 + (i%3)*.035})`; ctx.beginPath(); ctx.ellipse(x,y,1.2+(i%3)*.45,2.5+(i%4)*.5,-.3,0,TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawReefLayer(base, alpha, color, t, offset) {
    ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(0,height);
    for(let x=0;x<=width+20;x+=20) { const y=base + Math.sin((x+offset*73)*.014)*12 + Math.sin(x*.035+offset)*5; ctx.lineTo(x,y); }
    ctx.lineTo(width,height); ctx.closePath(); ctx.fill();
    // coral towers tucked into the sand
    for(let i=0;i<Math.ceil(width/170)+2;i++) {
      const x=((i*193 + offset*97 - (t*.003)%193 + width)% (width+130))-40;
      const y=base+8; const h=35+(i*29%39); ctx.globalAlpha=alpha*.9; ctx.fillStyle=i%2?'#e98c7b':'#edae78';
      ctx.beginPath(); ctx.moveTo(x-15,y+20); ctx.quadraticCurveTo(x-13,y-8,x-7,y-h*.55); ctx.quadraticCurveTo(x-5,y-h,x,y-h); ctx.quadraticCurveTo(x+5,y-h,x+6,y-h*.5); ctx.quadraticCurveTo(x+14,y-6,x+16,y+20); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x-7,y-h*.55,4,0,TAU); ctx.arc(x+5,y-h*.5,4,0,TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawSeaweed(t) {
    ctx.save();
    for(let i=0;i<Math.ceil(width/240)+1;i++) {
      const x=(i*257+33)%width, base=height+6, sway=Math.sin(t*.001+i*2)*8;
      for(let j=0;j<3;j++) {
        ctx.beginPath(); ctx.moveTo(x+j*7,base); ctx.quadraticCurveTo(x-17+sway+j*8,base-37,x-8+sway+j*8,base-77-(j%2)*17);
        ctx.strokeStyle=j%2?'rgba(75,181,143,.55)':'rgba(95,197,151,.55)';ctx.lineWidth=4;ctx.lineCap='round';ctx.stroke();
        ctx.beginPath();ctx.ellipse(x-9+sway+j*8,base-62-(j%2)*17,3.8,10,-.3,0,TAU);ctx.fillStyle='rgba(99,203,157,.55)';ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawFish(f, sx, sy, isPlayer=false, t=0) {
    const r=f.r, swim=Math.sin((f.phase||0))* .09;
    ctx.save(); ctx.translate(sx,sy); ctx.rotate(isPlayer ? f.angle : 0); ctx.scale(isPlayer?1:(f.facing||1),1);
    // shadow and tail flick
    ctx.globalAlpha=.16;ctx.fillStyle='#06384d';ctx.beginPath();ctx.ellipse(0,r*.72,r*1.03,r*.28,0,0,TAU);ctx.fill();ctx.globalAlpha=1;
    const tailSwing=Math.sin((f.phase||t)*2.2)*.22;
    ctx.save();ctx.translate(-r*.64,0);ctx.rotate(tailSwing);
    ctx.fillStyle=isPlayer?'#f68c70':f.color;ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(-r*.4,-r*.48,-r*.73,-r*.45);ctx.quadraticCurveTo(-r*.58,0,-r*.73,r*.45);ctx.quadraticCurveTo(-r*.32,r*.32,0,0);ctx.fill();
    ctx.fillStyle='rgba(255,244,208,.42)';ctx.beginPath();ctx.moveTo(-r*.15,0);ctx.quadraticCurveTo(-r*.4,-r*.3,-r*.65,-r*.38);ctx.quadraticCurveTo(-r*.49,-r*.08,-r*.15,0);ctx.fill();ctx.restore();
    // body
    ctx.save();ctx.rotate(swim);
    const body=ctx.createLinearGradient(0,-r,0,r);body.addColorStop(0,isPlayer?'#ffd18a':lighten(f.color,22));body.addColorStop(.55,isPlayer?'#ffad72':f.color);body.addColorStop(1,isPlayer?'#f07870':darken(f.color,18));
    ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,0,r*.83,r*.59,0,0,TAU);ctx.fill();
    ctx.strokeStyle='rgba(255,249,217,.5)';ctx.lineWidth=Math.max(1,r*.055);ctx.stroke();
    // fins
    ctx.fillStyle=isPlayer?'#ef8b79':lighten(f.color,5);ctx.beginPath();ctx.moveTo(-r*.08,r*.2);ctx.quadraticCurveTo(r*.16,r*.36,r*.36,r*.52);ctx.quadraticCurveTo(r*.3,r*.13,-r*.08,r*.2);ctx.fill();
    if (f.stripe || isPlayer) {
      ctx.save();ctx.beginPath();ctx.ellipse(0,0,r*.78,r*.56,0,0,TAU);ctx.clip();ctx.fillStyle=isPlayer?'rgba(255,241,191,.58)':'rgba(255,250,218,.38)';
      for(let k=-1;k<=1;k++){ctx.beginPath();ctx.ellipse(-r*.04+k*r*.27,0,r*.055,r*.65,0,0,TAU);ctx.fill();}ctx.restore();
    }
    if(f.spots && !isPlayer){ctx.fillStyle='rgba(255,248,218,.55)';for(let k=0;k<3;k++){ctx.beginPath();ctx.arc(-r*.23+k*r*.2,-r*.2,r*.055,0,TAU);ctx.fill();}}
    ctx.restore();
    // eye, cheek and smile. Predators stay cute, but their eye is a little sharper.
    const ex=r*.43, ey=-r*.1;ctx.fillStyle='#fff9df';ctx.beginPath();ctx.arc(ex,ey,r*.15,0,TAU);ctx.fill();ctx.fillStyle='#174c5c';ctx.beginPath();ctx.arc(ex+r*.035,ey+r*.015,r*.083,0,TAU);ctx.fill();
    ctx.fillStyle='rgba(242,112,106,.62)';ctx.beginPath();ctx.ellipse(r*.59,r*.18,r*.105,r*.06,0,0,TAU);ctx.fill();
    ctx.strokeStyle='#744b46';ctx.lineWidth=Math.max(1,r*.045);ctx.beginPath();ctx.arc(r*.59,r*.06,r*.11,.25,1.35);ctx.stroke();
    if(f.predator && !isPlayer) {ctx.fillStyle='rgba(254,247,205,.7)';ctx.beginPath();ctx.moveTo(r*.12,-r*.46);ctx.lineTo(r*.2,-r*.61);ctx.lineTo(r*.26,-r*.43);ctx.fill();}
    if(isPlayer && f.blink<.12) {ctx.strokeStyle='#174c5c';ctx.lineWidth=Math.max(1.5,r*.08);ctx.beginPath();ctx.moveTo(ex-r*.11,ey);ctx.quadraticCurveTo(ex,ey-r*.07,ex+r*.11,ey);ctx.stroke();}
    ctx.restore();
  }
  function lighten(hex, amount) { return shade(hex, amount); }
  function darken(hex, amount) { return shade(hex, -amount); }
  function shade(hex, amount) {
    const n=parseInt(hex.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+amount)),g=Math.max(0,Math.min(255,((n>>8)&255)+amount)),b=Math.max(0,Math.min(255,(n&255)+amount));return `rgb(${r},${g},${b})`;
  }
  function draw(t) {
    drawBackground(t);
    const cameraX=player.x-width/2, cameraY=player.y-height/2;
    for (const f of fishes) {
      const x=f.x-cameraX, y=f.y-cameraY;
      if(x>-80&&x<width+80&&y>-80&&y<height+80) drawFish(f,x,y,false,t);
    }
    for(const p of particles){const x=p.x-cameraX,y=p.y-cameraY;ctx.globalAlpha=Math.max(0,p.life/p.max);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(x,y,p.r*Math.max(.35,p.life/p.max),0,TAU);ctx.fill();}ctx.globalAlpha=1;
    const px=player.x-cameraX,py=player.y-cameraY;
    // soft little halo around the hero fish
    const halo=ctx.createRadialGradient(px,py,player.r*.2,px,py,player.r*2.7);halo.addColorStop(0,'rgba(255,213,150,.17)');halo.addColorStop(1,'rgba(255,213,150,0)');ctx.fillStyle=halo;ctx.beginPath();ctx.arc(px,py,player.r*2.7,0,TAU);ctx.fill();
    const displayPlayer={...player,angle: playing ? player.angle : Math.sin(t*.0006)*.13, phase:t*.006};drawFish(displayPlayer,px,py,true,t);
    if(pointer.active&&playing){const target=screenToWorld(pointer.x,pointer.y);const tx=target.x-cameraX,ty=target.y-cameraY;ctx.beginPath();ctx.arc(tx,ty,9+Math.sin(t*.008)*2,0,TAU);ctx.strokeStyle='rgba(232,255,225,.32)';ctx.lineWidth=1.5;ctx.stroke();ctx.beginPath();ctx.arc(tx,ty,2,0,TAU);ctx.fillStyle='rgba(245,255,221,.55)';ctx.fill();}
  }
  function frame(now) {
    const dt=Math.min(.04,Math.max(0,(now-lastTime)/1000||0));lastTime=now;
    update(dt);draw(now);requestAnimationFrame(frame);
  }
  // A small welcoming school is already swimming behind the title card.
  fishes = [makeFish(-width*.31, height*.28), makeFish(width*.28,height*.2), makeFish(width*.37,height*.68), makeFish(-width*.35,height*.67)];
  fishes[1].predator=false;fishes[1].r=12;fishes[2].predator=false;fishes[2].r=14;
  player.x=0;player.y=0;player.targetX=0;player.targetY=0;
  lastTime=performance.now();requestAnimationFrame(frame);
})();

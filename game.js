// ============================================================
// ESCAPE - 인터넷 중독 탈출기 (3레인 원근 러너)
// ============================================================

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// ---------- 원근(3D 느낌) 도로 상수 ----------
const HORIZON_Y = 130;
const ROAD_BOTTOM_Y = H;
const CENTER_X = W / 2;
const ROAD_BOTTOM_HALF = 330;
const ROAD_TOP_HALF = 16;
const PLAYER_Z = 0.16;

function depthHalfWidth(z) {
  const t = Math.min(1, Math.max(0, z));
  return ROAD_BOTTOM_HALF + (ROAD_TOP_HALF - ROAD_BOTTOM_HALF) * t;
}
function depthY(z) {
  const t = Math.min(1, Math.max(0, z));
  return ROAD_BOTTOM_Y - (ROAD_BOTTOM_Y - HORIZON_Y) * t;
}
function depthScale(z) {
  const t = Math.min(1, Math.max(0, z));
  return 1 - t * 0.87;
}
function laneX(lane, z) {
  return CENTER_X + lane * (depthHalfWidth(z) * 0.62);
}

// ---------- DOM ----------
const introScreen = document.getElementById('intro-screen');
const gameScreen = document.getElementById('game-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const winScreen = document.getElementById('win-screen');
const dialogueBox = document.getElementById('dialogue-box');
const dialogueText = document.getElementById('dialogue-text');
const dialogueHint = document.getElementById('dialogue-next-hint');
const retryBtn = document.getElementById('retry-btn');
const winRetryBtn = document.getElementById('win-retry-btn');
const livesEl = document.getElementById('lives');
const phaseLabelEl = document.getElementById('phase-label');
const scoreEl = document.getElementById('score');
const progressInner = document.getElementById('progress-bar-inner');
const progressText = document.getElementById('progress-text');
const statusBanner = document.getElementById('status-banner');
const gameoverScoreEl = document.getElementById('gameover-score');
const btnJumpTouch = document.getElementById('btn-jump');
const btnSlideTouch = document.getElementById('btn-slide');
const btnLeftTouch = document.getElementById('btn-left');
const btnRightTouch = document.getElementById('btn-right');

// ---------- 스토리 대사 ----------
const dialogueLines = [
  "새벽 3시... \"딱 5분만 더 보고 자야지...\"",
  "정신을 차려보니 창밖이 환해져 있었다.",
  "핸드폰 속으로 정신이 빨려 들어가는 것 같아...",
  "이렇게 살 순 없어!! 오늘 시험에서\n100점을 맞아서 인터넷 중독에서 벗어나자!",
  "책(골드)을 모으고 좌/우로 피하면서\n디지털 세상을 지나 현실 세계로 탈출하라!"
];
let dialogueIndex = 0;
let introLocked = false;

function showDialogue(i) {
  dialogueText.textContent = dialogueLines[i];
  dialogueHint.textContent = (i === dialogueLines.length - 1) ? '▶ 클릭해서 시작하기' : '▶ 클릭해서 계속';
}
showDialogue(0);

dialogueBox.addEventListener('click', () => {
  if (introLocked) return;
  if (dialogueIndex < dialogueLines.length - 1) {
    dialogueIndex++;
    showDialogue(dialogueIndex);
  } else {
    introLocked = true;
    playPhoneTransition();
  }
});

const phoneIcon = document.getElementById('phone-icon');
const introRunner = document.getElementById('intro-runner');
const titleLogo = document.getElementById('title-logo');
const transitionFlashEl = document.getElementById('transition-flash');

function playPhoneTransition() {
  dialogueBox.classList.add('fading');
  titleLogo.classList.add('fading');
  phoneIcon.classList.add('grow');
  introRunner.classList.add('enter-phone');

  setTimeout(() => { transitionFlashEl.classList.add('active'); }, 1400);
  setTimeout(() => {
    startGame();
    transitionFlashEl.classList.remove('active');
  }, 1900);
}

// ============================================================
// 게임 상수
// ============================================================
const WIN_SCORE = 100000;
const PHASE_SWITCH_SCORE = 50000;
const GRAVITY = 0.85;
const JUMP_FORCE = -15.5;
const SLIDE_HEIGHT_RATIO = 0.5;
const LANES = [-1, 0, 1];

// ============================================================
// 상태
// ============================================================
let state = null;

function freshState() {
  const footY = depthY(PLAYER_Z);
  return {
    running: false,
    phase: 'digital', // 'digital' | 'real'
    score: 0,
    lives: 3,
    baseSpeed: 6.5,
    frame: 0,
    nextSpawnAt: 50,
    entities: [],
    zombies: [],
    particles: [],
    bgScrollX: 0,
    transitionFlash: 0,
    bannerTimer: 0,
    ended: false,
    player: {
      lane: 0,
      visualX: laneX(0, PLAYER_Z),
      w: 46,
      h: 66,
      footY,
      vy: 0,
      onGround: true,
      mode: 'run', // run | jump | slide
      trappedTimer: 0,
      trapMash: 0,
      confuseTimer: 0,
      slowTimer: 0,
      invulnTimer: 0,
      phoneZombieTimer: 0,
      tilt: 0,
    },
  };
}

// ============================================================
// 장애물 / 아이템 정의
// kind: good(이득) / bad_item(점수감소) / obstacle(생명감소+스좀비) /
//       hazard_zone(감속, 전차선) / pit(폰좀비화+스좀비무리, 전차선) / trap(붙잡힘) / confuse(조작반전)
// type: ground(점프로 회피) / air(슬라이드로 회피) / zone(전차선, 점프로 회피)
// ============================================================
const DIGITAL_OBSTACLES = [
  { id: 'popup', name: '팝업 광고', emoji: '🪟', type: 'ground', kind: 'obstacle', size: 58 },
  { id: 'notice', name: '알림창 스패머', emoji: '🔔', type: 'air', kind: 'obstacle', size: 50 },
  { id: 'like_terror', name: '좋아요 테러', emoji: '👎', type: 'ground', kind: 'obstacle', size: 54 },
  { id: 'wifi_lag', name: '끊기는 와이파이', emoji: '📶', type: 'zone', kind: 'hazard_zone', size: 50 },
];
const REAL_OBSTACLES = [
  { id: 'bed', name: '포근한 침대', emoji: '🛏️', type: 'ground', kind: 'trap', size: 62 },
  { id: 'noise', name: '소음 유발자', emoji: '📢', type: 'air', kind: 'confuse', size: 52 },
  { id: 'junk', name: '빈둥거리기 템', emoji: '🎮', type: 'ground', kind: 'obstacle', size: 50 },
  { id: 'worksheet', name: '밀린 학습지', emoji: '📄', type: 'ground', kind: 'obstacle', size: 50 },
  { id: 'sleepy', name: '잠귀신', emoji: '💤', type: 'air', kind: 'obstacle', size: 50 },
  { id: 'clock', name: '째깍거리는 시계', emoji: '⏰', type: 'ground', kind: 'obstacle', size: 54 },
];
const SPECIAL_OBSTACLES = [
  { id: 'blackhole', name: '무한 스크롤 블랙홀', emoji: '🌀', type: 'zone', kind: 'pit', size: 55 },
  { id: 'charger_vine', name: '충전선 덩굴', emoji: '🔌', type: 'air', kind: 'trap', size: 52 },
];
const ITEMS = [
  { id: 'book', name: '책', emoji: '📖', kind: 'good', score: 200, size: 42 },
  { id: 'drink', name: '음료', emoji: '🥤', kind: 'good', score: 800, size: 42 },
  { id: 'choco', name: '초콜릿', emoji: '🍫', kind: 'good', score: 800, size: 40 },
  { id: 'phone', name: '핸드폰', emoji: '📱', kind: 'bad_item', score: -600, size: 38 },
];

function currentObstaclePool() {
  return state.phase === 'digital'
    ? DIGITAL_OBSTACLES.concat(SPECIAL_OBSTACLES.slice(0, 1))
    : REAL_OBSTACLES.concat(SPECIAL_OBSTACLES.slice(1, 2));
}

// ============================================================
// 입력
// ============================================================
function changeLane(dir) {
  const p = state.player;
  if (!state.running || p.trappedTimer > 0) return;
  const wantsDir = p.confuseTimer > 0 ? -dir : dir; // 혼란 상태: 좌우 반전
  p.lane = Math.max(-1, Math.min(1, p.lane + wantsDir));
}

function requestJump() {
  const p = state.player;
  if (!state.running) return;
  if (p.trappedTimer > 0) { p.trapMash += 1; return; }
  if (p.onGround) {
    p.vy = JUMP_FORCE;
    p.onGround = false;
    p.mode = 'jump';
  }
}
function requestSlide(down) {
  const p = state.player;
  if (!state.running) return;
  if (p.trappedTimer > 0) { if (down) p.trapMash += 1; return; }
  if (down && p.onGround) p.mode = 'slide';
  else if (!down && p.mode === 'slide') p.mode = 'run';
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) {
    if (['Space', 'ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(e.code)) e.preventDefault();
    return;
  }
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); requestJump(); }
  if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); requestSlide(true); }
  if (['ArrowLeft', 'KeyA'].includes(e.code)) { e.preventDefault(); changeLane(-1); }
  if (['ArrowRight', 'KeyD'].includes(e.code)) { e.preventDefault(); changeLane(1); }
});
window.addEventListener('keyup', (e) => {
  if (['ArrowDown', 'KeyS'].includes(e.code)) requestSlide(false);
});
btnJumpTouch.addEventListener('touchstart', (e) => { e.preventDefault(); requestJump(); });
btnJumpTouch.addEventListener('mousedown', () => requestJump());
btnSlideTouch.addEventListener('touchstart', (e) => { e.preventDefault(); requestSlide(true); });
btnSlideTouch.addEventListener('touchend', (e) => { e.preventDefault(); requestSlide(false); });
btnSlideTouch.addEventListener('mousedown', () => requestSlide(true));
btnSlideTouch.addEventListener('mouseup', () => requestSlide(false));
btnLeftTouch.addEventListener('touchstart', (e) => { e.preventDefault(); changeLane(-1); });
btnLeftTouch.addEventListener('mousedown', () => changeLane(-1));
btnRightTouch.addEventListener('touchstart', (e) => { e.preventDefault(); changeLane(1); });
btnRightTouch.addEventListener('mousedown', () => changeLane(1));

// 캔버스 스와이프 지원 (모바일)
let touchStartX = null, touchStartY = null;
canvas.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
});
canvas.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
    changeLane(dx > 0 ? 1 : -1);
  } else if (dy < -30) {
    requestJump();
  } else if (dy > 30) {
    requestSlide(true);
    setTimeout(() => requestSlide(false), 220);
  }
  touchStartX = null; touchStartY = null;
});

// ============================================================
// 스폰
// ============================================================
function spawnEntity() {
  const pool = currentObstaclePool();
  const roll = Math.random();
  let def;
  if (roll < 0.4) def = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  else def = pool[Math.floor(Math.random() * pool.length)];

  const lane = (def.type === 'zone') ? 'all' : LANES[Math.floor(Math.random() * LANES.length)];

  state.entities.push({
    def,
    lane,
    z: 1.08,
    resolved: false,
  });
}

function spawnZombies(count) {
  const p = state.player;
  for (let i = 0; i < count; i++) {
    state.zombies.push({
      lane: LANES[Math.floor(Math.random() * LANES.length)],
      z: 0.78 + i * 0.08,
      life: 240 + i * 20,
      caught: false,
      chaseTick: 0,
    });
  }
}

// ============================================================
// 상태 표시 배너
// ============================================================
function banner(msg, duration = 90) {
  statusBanner.textContent = msg;
  state.bannerTimer = duration;
}

// ============================================================
// 생명 관리
// ============================================================
function loseLife() {
  const p = state.player;
  if (p.invulnTimer > 0) return;
  state.lives -= 1;
  p.invulnTimer = 90;
  updateLivesUI();
  if (state.lives <= 0) endGame(false);
}

// ============================================================
// 업데이트
// ============================================================
function update() {
  if (!state.running) return;
  const p = state.player;
  state.frame++;

  let speed = state.baseSpeed + Math.min(state.score / 9000, 6.5);
  if (p.slowTimer > 0) { speed *= 0.35; p.slowTimer--; }
  if (p.phoneZombieTimer > 0) speed *= 0.55;
  const dz = speed * 0.0016;

  // --- 트랩 처리 ---
  if (p.trappedTimer > 0) {
    p.trappedTimer--;
    if (p.trapMash >= 8) {
      p.trappedTimer = 0; p.trapMash = 0;
      banner('버둥거려서 탈출 성공!', 60);
    }
    if (p.trappedTimer <= 0) p.trapMash = 0;
  } else if (!p.onGround) {
    p.vy += GRAVITY;
    p.footY += p.vy;
    if (p.footY >= depthY(PLAYER_Z)) {
      p.footY = depthY(PLAYER_Z);
      p.vy = 0;
      p.onGround = true;
      p.mode = 'run';
    }
  }

  if (p.confuseTimer > 0) p.confuseTimer--;
  if (p.phoneZombieTimer > 0) p.phoneZombieTimer--;
  if (p.invulnTimer > 0) p.invulnTimer--;
  if (state.bannerTimer > 0) { state.bannerTimer--; if (state.bannerTimer <= 0) statusBanner.textContent = ''; }
  if (state.transitionFlash > 0) state.transitionFlash--;

  // --- 좌우 이동 보간 + 기울기 ---
  const targetX = laneX(p.lane, PLAYER_Z);
  const diff = targetX - p.visualX;
  p.visualX += diff * 0.28;
  p.tilt = Math.max(-0.22, Math.min(0.22, diff * 0.01));

  state.bgScrollX -= speed * 0.6;

  // --- 스폰 ---
  state.nextSpawnAt -= 1;
  if (state.nextSpawnAt <= 0) {
    spawnEntity();
    const gap = Math.max(34, 62 - speed * 2.1);
    state.nextSpawnAt = gap + Math.random() * 26;
  }

  // --- 엔티티 이동 & 충돌 ---
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    e.z -= dz;
    if (e.z < -0.25) { state.entities.splice(i, 1); continue; }

    if (!e.resolved && e.z <= PLAYER_Z + 0.05) {
      e.resolved = true;
      const laneMatches = e.lane === 'all' || e.lane === p.lane;
      if (laneMatches) resolveEntity(e);
    }
    if (e.collected) state.entities.splice(i, 1);
  }

  // --- 스좀비 이동 & 추격 ---
  const zSpeedFactor = dz * 2.05;
  for (let i = state.zombies.length - 1; i >= 0; i--) {
    const z = state.zombies[i];
    z.chaseTick++;
    if (z.chaseTick % 18 === 0 && Math.random() < 0.75) {
      if (z.lane < p.lane) z.lane++;
      else if (z.lane > p.lane) z.lane--;
    }
    z.z -= zSpeedFactor;
    z.life--;
    if (!z.caught && z.z <= PLAYER_Z + 0.02 && z.lane === p.lane) {
      z.caught = true;
      loseLife();
      banner('🧟 스좀비에게 붙잡혔다!', 90);
      state.zombies.splice(i, 1);
      continue;
    }
    if (z.z < -0.25 || z.life <= 0) state.zombies.splice(i, 1);
  }

  // --- 파티클 ---
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.y -= 1.2; pt.life -= 1;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }

  addScore(Math.round(speed * 3.2));
  updateScoreUI();
  checkPhase();
  checkWin();

  render(speed);
  requestAnimationFrame(update);
}

function resolveEntity(e) {
  const p = state.player;
  const def = e.def;
  const ex = laneX(e.lane === 'all' ? 0 : e.lane, e.z);
  const ey = depthY(e.z);

  if (def.kind === 'good') {
    e.collected = true;
    addScore(def.score);
    spawnParticle(ex, ey, `+${def.score}`, '#8effa1');
  } else if (def.kind === 'bad_item') {
    e.collected = true;
    addScore(def.score);
    spawnParticle(ex, ey, `${def.score}`, '#ff6b6b');
  } else if (def.kind === 'hazard_zone') {
    if (p.onGround) { p.slowTimer = 70; banner('📶 와이파이가 끊겨서 느려졌다...', 70); }
  } else if (def.kind === 'pit') {
    if (p.onGround) {
      p.phoneZombieTimer = 160;
      banner('🌀 무한 스크롤에 빠져 폰좀비가 되어버렸다!!', 130);
      loseLife();
      spawnZombies(3);
    }
  } else if (def.kind === 'trap') {
    const avoided = def.type === 'air' ? p.mode === 'slide' : !p.onGround;
    if (!avoided) {
      p.trappedTimer = 100; p.trapMash = 0; p.onGround = true; p.mode = 'run';
      banner(def.id === 'bed' ? '🛏️ "5분만 더 누워있을까..." (연타로 탈출!)' : '🔌 충전선에 걸렸다! (연타로 탈출!)', 130);
      loseLife();
      spawnZombies(1);
    }
  } else if (def.kind === 'confuse') {
    const avoided = p.mode === 'slide';
    if (!avoided) {
      p.confuseTimer = 240;
      banner('📢 시끄러운 소음! 조작이 반대가 됐다!', 100);
      loseLife();
    }
  } else if (def.kind === 'obstacle') {
    const avoided = def.type === 'air' ? p.mode === 'slide' : !p.onGround;
    if (!avoided) {
      banner(`💥 ${def.name}에 부딪혔다! 스좀비 출몰!`, 100);
      loseLife();
      spawnZombies(1);
    }
  }
  updateScoreUI();
}

function spawnParticle(x, y, text, color) {
  state.particles.push({ x, y, text, color, life: 40 });
}
function addScore(n) { state.score = Math.max(0, state.score + n); }

function checkPhase() {
  if (state.phase === 'digital' && state.score >= PHASE_SWITCH_SCORE) {
    state.phase = 'real';
    state.transitionFlash = 40;
    banner('✨ 디지털 세상을 벗어나 현실 세계로 진입했다!', 160);
    phaseLabelEl.textContent = '🏠 현실 세계';
    phaseLabelEl.classList.add('real');
  }
}
function checkWin() { if (state.score >= WIN_SCORE) endGame(true); }

// ============================================================
// 이모지 픽셀화 (디지털 세상 / 스좀비 전용)
// ============================================================
const pixelEmojiCache = new Map();
function getPixelatedEmoji(emoji, size) {
  const key = emoji + '_' + size;
  if (pixelEmojiCache.has(key)) return pixelEmojiCache.get(key);
  const small = 14;
  const off1 = document.createElement('canvas');
  off1.width = small; off1.height = small;
  const c1 = off1.getContext('2d');
  c1.font = `${small}px serif`;
  c1.textAlign = 'center'; c1.textBaseline = 'middle';
  c1.fillText(emoji, small / 2, small / 2 + 1);
  const off2 = document.createElement('canvas');
  off2.width = Math.max(4, Math.round(size)); off2.height = off2.width;
  const c2 = off2.getContext('2d');
  c2.imageSmoothingEnabled = false;
  c2.drawImage(off1, 0, 0, off2.width, off2.height);
  pixelEmojiCache.set(key, off2);
  return off2;
}
function drawEmoji(emoji, cx, bottomY, size, pixelated) {
  if (size < 3) return;
  if (pixelated) {
    const img = getPixelatedEmoji(emoji, size);
    ctx.drawImage(img, cx - size / 2, bottomY - size, size, size);
  } else {
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(emoji, cx, bottomY);
  }
}

// ============================================================
// 픽셀 히어로 (디지털 세상)
// ============================================================
function rr(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function drawPixelHero(cx, bottom, w, h, mode, frame, speedFactor, confused) {
  const u = Math.max(3, Math.round(w / 9));
  const step = Math.floor(frame / Math.max(3, Math.round(9 / speedFactor))) % 4;
  const hoodie = '#3fd0ff', pants = '#171733', skin = '#ffd39b', hair = '#241708', shoe = '#ff5da2';
  const topY = bottom - h;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (mode === 'zombie') {
    const shuffle = (step % 2) * u * 0.6;
    rr(cx - u * 1.4, bottom - u * 3, u * 1.2, u * 3, '#5a7a52');
    rr(cx + u * 0.2, bottom - u * 3 + shuffle, u * 1.2, u * 3 - shuffle, '#5a7a52');
    rr(cx - u * 2, topY + u * 3, u * 4, u * 3.5, '#3f5c3a');
    rr(cx - u * 3.4, topY + u * 3, u * 1.6, u, '#7fae72');
    rr(cx + u * 1.8, topY + u * 3, u * 1.6, u, '#7fae72');
    rr(cx - u * 1.6, topY, u * 3.2, u * 3, '#8fc27f');
    rr(cx - u * 1.6, topY - u * 0.4, u * 3.2, u * 0.6, hair);
  } else if (mode === 'trapped') {
    const jit = Math.sin(frame * 0.9) * u * 0.6;
    rr(cx - u * 1.6 + jit, bottom - u * 2.2, u * 1.3, u * 2.2, pants);
    rr(cx + u * 0.3 + jit, bottom - u * 2.2, u * 1.3, u * 2.2, pants);
    rr(cx - u * 2 + jit, topY + u * 3, u * 4, u * 3, hoodie);
    rr(cx - u * 3 + jit, topY + u * 1.5, u * 1.4, u * 2, hoodie);
    rr(cx + u * 1.6 + jit, topY + u * 1.5, u * 1.4, u * 2, hoodie);
    rr(cx - u * 1.5 + jit, topY, u * 3, u * 3, skin);
    rr(cx - u * 1.6 + jit, topY - u * 0.6, u * 3.2, u, hair);
  } else if (mode === 'jump') {
    rr(cx - u * 1.8, bottom - u * 1.6, u * 1.5, u * 1.6, pants);
    rr(cx + u * 0.3, bottom - u * 2.2, u * 1.5, u * 1.6, pants);
    rr(cx - u * 2, topY + u * 2.6, u * 4, u * 3, hoodie);
    rr(cx - u * 3.2, topY + u * 1, u * 1.4, u * 2, hoodie);
    rr(cx + u * 1.8, topY + u * 0.4, u * 1.4, u * 2, hoodie);
    rr(cx - u * 1.5, topY - u * 0.2, u * 3, u * 3, skin);
    rr(cx - u * 1.6, topY - u * 0.8, u * 3.2, u, hair);
  } else if (mode === 'slide') {
    const sy = bottom - h * SLIDE_HEIGHT_RATIO;
    rr(cx - u * 2.6, bottom - u * 1.4, u * 2.2, u * 1.4, pants);
    rr(cx + u * 0.6, bottom - u * 1.4, u * 2.2, u * 1.4, pants);
    rr(cx - u * 2.4, sy + u * 0.4, u * 4.6, u * 2.2, hoodie);
    rr(cx + u * 2.2, sy, u * 1.6, u * 1.2, hoodie);
    rr(cx - u * 2.6, sy - u * 1.6, u * 2.6, u * 2, skin);
    rr(cx - u * 2.6, sy - u * 2.1, u * 2.6, u * 0.7, hair);
  } else {
    const bounce = (step === 1 || step === 3) ? -u * 0.5 : 0;
    const frontDX = step === 0 ? u * 1.6 : step === 2 ? -u * 1.6 : 0;
    const backDX = step === 0 ? -u * 1.6 : step === 2 ? u * 1.6 : 0;
    rr(cx - u * 0.6 + backDX, bottom - u * 2 + (backDX !== 0 ? -u * 0.8 : 0), u * 1.3, u * 2, shoe);
    rr(cx - u * 0.6 + backDX, bottom - u * 2.6 + (backDX !== 0 ? -u * 0.8 : 0), u * 1.3, u * 1.4, pants);
    rr(cx - u * 0.6 + frontDX, bottom - u * 2, u * 1.3, u * 2, shoe);
    rr(cx - u * 0.6 + frontDX, bottom - u * 2.6, u * 1.3, u * 1.4, pants);
    rr(cx - u * 2 + backDX * 0.3, topY + u * 2.6 + bounce, u * 4, u * 3, hoodie);
    rr(cx - u * 3.2 - backDX * 0.4, topY + u * 2.8 + bounce, u * 1.3, u * 1.8, hoodie);
    rr(cx + u * 1.9 + frontDX * 0.4, topY + u * 2.6 + bounce, u * 1.3, u * 1.8, hoodie);
    rr(cx - u * 1.5, topY + bounce, u * 3, u * 3, skin);
    rr(cx - u * 1.6, topY - u * 0.6 + bounce, u * 3.2, u, hair);
  }
  if (confused) drawConfuseStars(cx, topY - u);
  ctx.restore();
}

// ============================================================
// 일반 히어로 (현실 세계)
// ============================================================
function drawNormalHero(cx, bottom, w, h, mode, frame, speedFactor, confused) {
  const t = frame * 0.14 * speedFactor;
  const topY = bottom - h;
  const headR = w * 0.28;
  const bodyColor = '#ff8a4c', pantsColor = '#3a3a5c', skin = '#ffd8ad', hair = '#2b1a10';

  ctx.save();
  ctx.lineCap = 'round';

  if (mode === 'zombie') {
    ctx.strokeStyle = '#6f9a64'; ctx.lineWidth = w * 0.16;
    ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.55); ctx.lineTo(cx - w * 0.6, topY + h * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.55); ctx.lineTo(cx + w * 0.6, topY + h * 0.35); ctx.stroke();
    const shuffle = Math.sin(t) * 4;
    ctx.beginPath(); ctx.moveTo(cx - w * 0.15, bottom - h * 0.4); ctx.lineTo(cx - w * 0.15 + shuffle, bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + w * 0.15, bottom - h * 0.4); ctx.lineTo(cx + w * 0.15 - shuffle, bottom); ctx.stroke();
    ctx.fillStyle = pantsColor; ctx.fillRect(cx - w * 0.28, topY + h * 0.5, w * 0.56, h * 0.32);
    ctx.fillStyle = '#8fc27f'; ctx.beginPath(); ctx.arc(cx, topY + headR, headR, 0, Math.PI * 2); ctx.fill();
  } else if (mode === 'trapped') {
    const jit = Math.sin(frame * 0.9) * 4;
    drawBodyBase(cx + jit, topY, bottom, w, h, bodyColor, pantsColor, skin, hair);
    ctx.strokeStyle = skin; ctx.lineWidth = w * 0.14;
    ctx.beginPath(); ctx.moveTo(cx - w * 0.2 + jit, topY + h * 0.35); ctx.lineTo(cx - w * 0.55 + jit, topY + h * 0.05 + Math.sin(frame * 0.5) * 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + w * 0.2 + jit, topY + h * 0.35); ctx.lineTo(cx + w * 0.55 + jit, topY + h * 0.05 - Math.sin(frame * 0.5) * 6); ctx.stroke();
  } else if (mode === 'jump') {
    drawBodyBase(cx, topY, bottom, w, h, bodyColor, pantsColor, skin, hair, true);
  } else if (mode === 'slide') {
    const sy = bottom - h * SLIDE_HEIGHT_RATIO;
    ctx.fillStyle = bodyColor;
    ctx.beginPath(); ctx.ellipse(cx, sy + h * 0.15, w * 0.62, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(cx - w * 0.55, sy + h * 0.05, headR * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pantsColor; ctx.lineWidth = w * 0.16;
    ctx.beginPath(); ctx.moveTo(cx + w * 0.2, sy + h * 0.15); ctx.lineTo(cx + w * 0.75, sy + h * 0.1); ctx.stroke();
  } else {
    const legSwing = Math.sin(t) * (w * 0.5);
    const armSwing = Math.sin(t + Math.PI) * (w * 0.42);
    const bounce = Math.abs(Math.cos(t)) * h * 0.05;
    const cy = topY - bounce;

    ctx.strokeStyle = pantsColor; ctx.lineWidth = w * 0.2;
    ctx.beginPath(); ctx.moveTo(cx, cy + h * 0.62); ctx.lineTo(cx + legSwing, bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + h * 0.62); ctx.lineTo(cx - legSwing, bottom); ctx.stroke();

    ctx.strokeStyle = skin; ctx.lineWidth = w * 0.15;
    ctx.beginPath(); ctx.moveTo(cx, cy + h * 0.3); ctx.lineTo(cx + armSwing, cy + h * 0.58); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + h * 0.3); ctx.lineTo(cx - armSwing, cy + h * 0.58); ctx.stroke();

    ctx.fillStyle = bodyColor;
    ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.42, w * 0.36, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(cx, cy + headR * 0.9, headR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(cx, cy + headR * 0.55, headR * 1.02, Math.PI, Math.PI * 2); ctx.fill();
  }
  if (confused) drawConfuseStars(cx, topY - 10);
  ctx.restore();
}
function drawBodyBase(cx, topY, bottom, w, h, bodyColor, pantsColor, skin, hair, armsUp) {
  const headR = w * 0.28;
  ctx.strokeStyle = pantsColor; ctx.lineWidth = w * 0.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.62); ctx.lineTo(cx - w * 0.28, bottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.62); ctx.lineTo(cx + w * 0.05, bottom - h * 0.1); ctx.stroke();
  ctx.strokeStyle = skin; ctx.lineWidth = w * 0.15;
  const armY = armsUp ? topY + h * 0.05 : topY + h * 0.58;
  ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.3); ctx.lineTo(cx - w * 0.5, armY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, topY + h * 0.3); ctx.lineTo(cx + w * 0.5, armY); ctx.stroke();
  ctx.fillStyle = bodyColor;
  ctx.beginPath(); ctx.ellipse(cx, topY + h * 0.42, w * 0.36, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(cx, topY + headR * 0.9, headR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(cx, topY + headR * 0.55, headR * 1.02, Math.PI, Math.PI * 2); ctx.fill();
}
function drawConfuseStars(cx, y) {
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.fillText('❓', cx, y);
}

function drawPlayer(speed) {
  const p = state.player;
  ctx.save();
  if (p.invulnTimer > 0 && Math.floor(state.frame / 4) % 2 === 0) ctx.globalAlpha = 0.4;

  const cx = p.visualX;
  const bottom = p.footY;
  const speedFactor = Math.max(0.6, speed / 6.5);
  let poseMode = p.mode;
  if (p.phoneZombieTimer > 0) poseMode = 'zombie';
  else if (p.trappedTimer > 0) poseMode = 'trapped';

  // 그림자
  ctx.save();
  ctx.globalAlpha *= 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, depthY(PLAYER_Z) + 6, p.w * 0.45, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.translate(cx, bottom);
  ctx.rotate(p.tilt);
  ctx.translate(-cx, -bottom);

  if (state.phase === 'digital') {
    drawPixelHero(cx, bottom, p.w, p.h, poseMode, state.frame, speedFactor, p.confuseTimer > 0);
  } else {
    drawNormalHero(cx, bottom, p.w, p.h, poseMode, state.frame, speedFactor, p.confuseTimer > 0);
  }
  ctx.restore();
}

// ============================================================
// 배경 (원근 도로)
// ============================================================
function roadPath(z0, z1) {
  ctx.beginPath();
  ctx.moveTo(laneX(-1.5, z0), depthY(z0));
  ctx.lineTo(laneX(1.5, z0), depthY(z0));
  ctx.lineTo(laneX(1.5, z1), depthY(z1));
  ctx.lineTo(laneX(-1.5, z1), depthY(z1));
  ctx.closePath();
}

function drawSideScenery(colorSet, speed) {
  const cycleSpeed = 0.006 + speed * 0.0006;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 6; i++) {
      let z = 1 - ((state.frame * cycleSpeed + i * 0.17) % 1);
      const half = depthHalfWidth(z);
      const x = CENTER_X + side * (half * 1.15 + 20 * depthScale(z));
      const y = depthY(z);
      const scale = depthScale(z);
      const height = 90 * scale;
      const width = 34 * scale;
      const c = colorSet[i % colorSet.length];
      ctx.globalAlpha = 0.55 + 0.35 * scale;
      ctx.fillStyle = c;
      ctx.fillRect(x - width / 2, y - height, width, height);
      ctx.globalAlpha = 1;
    }
  }
}

function drawBackgroundDigital(speed) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b0326');
  grad.addColorStop(1, '#1a0b3d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 지평선 네온 글로우
  ctx.save();
  const hg = ctx.createRadialGradient(CENTER_X, HORIZON_Y, 0, CENTER_X, HORIZON_Y, 260);
  hg.addColorStop(0, 'rgba(0,245,255,0.35)');
  hg.addColorStop(1, 'rgba(0,245,255,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, HORIZON_Y + 40);
  ctx.restore();

  drawSideScenery(['#ff00e5', '#00f5ff', '#7d5fff'], speed);

  // 도로
  roadPath(0, 1);
  ctx.fillStyle = '#150a35';
  ctx.fill();

  // 차선 경계선 (애니메이션 대시)
  ctx.strokeStyle = 'rgba(0,245,255,0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 14]);
  ctx.lineDashOffset = -(state.frame * 1.2) % 30;
  for (const edge of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(laneX(edge, 0), depthY(0));
    ctx.lineTo(laneX(edge, 1), depthY(1));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 도로 외곽 네온 라인
  ctx.strokeStyle = '#00f5ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(laneX(-1.5, 0), depthY(0)); ctx.lineTo(laneX(-1.5, 1), depthY(1)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(laneX(1.5, 0), depthY(0)); ctx.lineTo(laneX(1.5, 1), depthY(1)); ctx.stroke();

  // 글리치 효과
  if (Math.random() < 0.06) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,245,255' : '255,0,229'},0.12)`;
    const gy = Math.random() * H;
    ctx.fillRect(0, gy, W, 6 + Math.random() * 10);
  }
}

function drawBackgroundReal(speed) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3a2b4f');
  grad.addColorStop(1, '#5b4368');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(255,225,150,0.85)';
  ctx.beginPath(); ctx.arc(W - 100, 70, 26, 0, Math.PI * 2); ctx.fill();

  drawSideScenery(['#caa06b', '#e0b98a', '#b98a5a'], speed);

  roadPath(0, 1);
  ctx.fillStyle = '#7a5230';
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([16, 14]);
  ctx.lineDashOffset = -(state.frame * 1.2) % 30;
  for (const edge of [-0.5, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(laneX(edge, 0), depthY(0));
    ctx.lineTo(laneX(edge, 1), depthY(1));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.moveTo(laneX(-1.5, 0), depthY(0)); ctx.lineTo(laneX(-1.5, 1), depthY(1)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(laneX(1.5, 0), depthY(0)); ctx.lineTo(laneX(1.5, 1), depthY(1)); ctx.stroke();
}

// ============================================================
// 엔티티 / 좀비 렌더링
// ============================================================
function drawEntities() {
  const pixelated = state.phase === 'digital';
  const sorted = state.entities.slice().sort((a, b) => b.z - a.z);
  for (const e of sorted) {
    const def = e.def;
    const z = Math.max(0, e.z);
    const y = depthY(z);
    const scale = depthScale(z);

    if (e.lane === 'all') {
      const halfW = depthHalfWidth(z) * 0.95;
      if (def.kind === 'hazard_zone') {
        ctx.save();
        ctx.globalAlpha = 0.45 + 0.3 * Math.sin(state.frame * 0.3);
        ctx.fillStyle = '#00c8ff';
        ctx.beginPath();
        ctx.ellipse(CENTER_X, y, halfW, 10 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (def.kind === 'pit') {
        ctx.save();
        ctx.fillStyle = 'rgba(120,0,200,0.65)';
        ctx.beginPath();
        ctx.ellipse(CENTER_X, y, halfW, 14 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (const lane of LANES) {
        drawEmoji(def.emoji, laneX(lane, z), y, def.size * scale, pixelated);
      }
    } else {
      const x = laneX(e.lane, z);
      const extraLift = def.type === 'air' ? 55 * scale : 0;
      drawEmoji(def.emoji, x, y - extraLift, def.size * scale, pixelated);
    }
  }
}

function drawZombies() {
  const sorted = state.zombies.slice().sort((a, b) => b.z - a.z);
  for (const z of sorted) {
    const zz = Math.max(0, z.z);
    const x = laneX(z.lane, zz);
    const y = depthY(zz);
    const scale = depthScale(zz);
    drawEmoji('🧟', x, y, 60 * scale, true);
  }
}

function drawParticles() {
  for (const pt of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, pt.life / 40);
    ctx.fillStyle = pt.color;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pt.text, pt.x, pt.y);
    ctx.restore();
  }
}

function render(speed) {
  ctx.clearRect(0, 0, W, H);
  if (state.phase === 'digital') drawBackgroundDigital(speed);
  else drawBackgroundReal(speed);

  drawEntities();
  drawZombies();
  drawPlayer(speed);
  drawParticles();

  if (state.transitionFlash > 0) {
    ctx.save();
    ctx.globalAlpha = (state.transitionFlash / 40) * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// ============================================================
// UI 업데이트
// ============================================================
function updateLivesUI() {
  livesEl.textContent = '❤️'.repeat(Math.max(0, state.lives)) + '🖤'.repeat(Math.max(0, 3 - state.lives));
}
function updateScoreUI() {
  scoreEl.textContent = `SCORE: ${state.score.toLocaleString()}`;
  const pct = Math.min(100, (state.score / WIN_SCORE) * 100);
  progressInner.style.width = pct + '%';
  progressText.textContent = `${state.score.toLocaleString()} / ${WIN_SCORE.toLocaleString()}`;
}

// ============================================================
// 게임 흐름 제어
// ============================================================
function startGame() {
  state = freshState();
  introScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  winScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  phaseLabelEl.textContent = '🌐 디지털 세상';
  phaseLabelEl.classList.remove('real');
  statusBanner.textContent = '';
  updateLivesUI();
  updateScoreUI();
  state.running = true;
  requestAnimationFrame(update);
}

function endGame(won) {
  if (state.ended) return;
  state.ended = true;
  state.running = false;
  gameScreen.classList.add('hidden');
  if (won) {
    winScreen.classList.remove('hidden');
  } else {
    gameoverScoreEl.textContent = `최종 점수: ${state.score.toLocaleString()}`;
    gameoverScreen.classList.remove('hidden');
  }
}

retryBtn.addEventListener('click', startGame);
winRetryBtn.addEventListener('click', startGame);

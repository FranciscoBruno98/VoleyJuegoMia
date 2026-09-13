(() => {
  'use strict';

  // ---------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------
  const menuScreen = document.getElementById('menuScreen');
  const gameScreen = document.getElementById('gameScreen');
  const pauseScreen = document.getElementById('pauseScreen');
  const endScreen = document.getElementById('endScreen');

  const playBtn = document.getElementById('playBtn');
  const installBtn = document.getElementById('installBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const menuFromPauseBtn = document.getElementById('menuFromPauseBtn');
  const rematchBtn = document.getElementById('rematchBtn');
  const menuFromEndBtn = document.getElementById('menuFromEndBtn');

  const scoreLeftEl = document.getElementById('scoreLeft');
  const scoreRightEl = document.getElementById('scoreRight');
  const endTitleEl = document.getElementById('endTitle');
  const endScoreEl = document.getElementById('endScore');
  const pointBanner = document.getElementById('pointBanner');

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const moveZone = document.getElementById('moveZone');
  const jumpZone = document.getElementById('jumpZone');
  const jumpBtn = document.getElementById('jumpBtn');

  // ---------------------------------------------------------------
  // Settings state
  // ---------------------------------------------------------------
  let difficulty = 'normal';
  let winScore = 11;

  const DIFFICULTY = {
    facil:   { moveSpeed: 190, reactionDelay: 0.48, aimError: 150, jumpChance: 0.80, flightTime: [0.85, 1.15], hesitation: 0.35 },
    normal:  { moveSpeed: 290, reactionDelay: 0.22, aimError: 80,  jumpChance: 0.93, flightTime: [0.70, 0.95], hesitation: 0.12 },
    dificil: { moveSpeed: 390, reactionDelay: 0.07, aimError: 28,  jumpChance: 1.00, flightTime: [0.55, 0.80], hesitation: 0.0 },
  };

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      difficulty = btn.dataset.diff;
    });
  });

  document.querySelectorAll('.pts-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pts-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      winScore = parseInt(btn.dataset.pts, 10);
    });
  });

  // ---------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  let metrics = {};

  function resizeCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = gameScreen.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeMetrics();
  }

  function computeMetrics() {
    const groundY = H - Math.max(18, H * 0.05);
    const netHeight = H * 0.24;
    const playerRadius = Math.max(20, Math.min(46, Math.min(W, H) * 0.05));
    const ballRadius = playerRadius * 0.55;
    const leftBound = W * 0.04;
    const rightBound = W * 0.96;
    const netX = W / 2;
    const netThickness = Math.max(5, W * 0.008);

    metrics = {
      groundY,
      netTopY: groundY - netHeight,
      netX,
      netThickness,
      playerRadius,
      ballRadius,
      leftBound,
      rightBound,
      playerMinX: leftBound + playerRadius,
      playerMaxX: netX - netThickness / 2 - playerRadius,
      cpuMinX: netX + netThickness / 2 + playerRadius,
      cpuMaxX: rightBound - playerRadius,
      gravity: H * 1.85,
      jumpV: -H * 0.78,
    };
  }

  window.addEventListener('resize', () => {
    if (!gameScreen.hidden) resizeCanvas();
  });

  // ---------------------------------------------------------------
  // Game entities
  // ---------------------------------------------------------------
  const player = { x: 0, y: 0, vy: 0, vx: 0, grounded: true, color: '#2fb8ff', dark: '#1483c4', facing: 1 };
  const cpu = { x: 0, y: 0, vy: 0, grounded: true, color: '#ff6b57', dark: '#c8402e', facing: -1, aiTarget: 0, aiTimer: 0, aiJumpArmed: false };
  const ball = { x: 0, y: 0, vx: 0, vy: 0, lastHitBy: null, hitCooldown: 0, trail: [] };

  let scoreA = 0; // player
  let scoreB = 0; // cpu
  let server = 'player';
  let state = 'menu'; // menu | serving | live | point | gameover | paused
  let serveTimer = 0;
  let lastTime = 0;
  let rafId = null;

  function resetPositions() {
    player.x = clamp(metrics.playerMaxX - (metrics.playerMaxX - metrics.playerMinX) * 0.35, metrics.playerMinX, metrics.playerMaxX);
    player.y = metrics.groundY;
    player.vy = 0;
    player.grounded = true;

    cpu.x = clamp(metrics.cpuMinX + (metrics.cpuMaxX - metrics.cpuMinX) * 0.35, metrics.cpuMinX, metrics.cpuMaxX);
    cpu.y = metrics.groundY;
    cpu.vy = 0;
    cpu.grounded = true;
  }

  function startServe(who) {
    server = who;
    state = 'serving';
    serveTimer = 0.8;
    ball.vx = 0;
    ball.vy = 0;
    ball.lastHitBy = null;
    ball.trail.length = 0;
    if (who === 'player') {
      ball.x = player.x;
      ball.y = metrics.netTopY - metrics.playerRadius * 2;
    } else {
      ball.x = cpu.x;
      ball.y = metrics.netTopY - metrics.playerRadius * 2;
    }
  }

  function newMatch() {
    scoreA = 0;
    scoreB = 0;
    updateScoreUI();
    resizeCanvas();
    resetPositions();
    startServe(Math.random() < 0.5 ? 'player' : 'cpu');
  }

  function updateScoreUI() {
    scoreLeftEl.textContent = scoreA;
    scoreRightEl.textContent = scoreB;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------------------------------------------------------------
  // Input: movement (drag) + jump button
  // ---------------------------------------------------------------
  let dragActive = false;
  let dragLastX = 0;
  const MOVE_SENSITIVITY = 1.35;

  moveZone.addEventListener('touchstart', (e) => {
    dragActive = true;
    dragLastX = e.touches[0].clientX;
    e.preventDefault();
  }, { passive: false });

  moveZone.addEventListener('touchmove', (e) => {
    if (!dragActive) return;
    const x = e.touches[0].clientX;
    const dx = (x - dragLastX) * MOVE_SENSITIVITY;
    dragLastX = x;
    player.x = clamp(player.x + dx, metrics.playerMinX, metrics.playerMaxX);
    e.preventDefault();
  }, { passive: false });

  moveZone.addEventListener('touchend', () => { dragActive = false; });
  moveZone.addEventListener('touchcancel', () => { dragActive = false; });

  // mouse fallback (desktop testing)
  moveZone.addEventListener('mousedown', (e) => { dragActive = true; dragLastX = e.clientX; });
  window.addEventListener('mousemove', (e) => {
    if (!dragActive) return;
    const dx = (e.clientX - dragLastX) * MOVE_SENSITIVITY;
    dragLastX = e.clientX;
    player.x = clamp(player.x + dx, metrics.playerMinX, metrics.playerMaxX);
  });
  window.addEventListener('mouseup', () => { dragActive = false; });

  function doJump() {
    if (player.grounded && (state === 'live' || state === 'serving')) {
      player.vy = metrics.jumpV;
      player.grounded = false;
    }
  }

  jumpBtn.addEventListener('touchstart', (e) => { doJump(); jumpBtn.classList.add('active'); e.preventDefault(); }, { passive: false });
  jumpBtn.addEventListener('touchend', () => jumpBtn.classList.remove('active'));
  jumpBtn.addEventListener('mousedown', doJump);

  // keyboard fallback for desktop testing
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp') doJump();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  function handleKeyboardMove(dt) {
    const speed = W * 0.6;
    if (keys['ArrowLeft']) player.x = clamp(player.x - speed * dt, metrics.playerMinX, metrics.playerMaxX);
    if (keys['ArrowRight']) player.x = clamp(player.x + speed * dt, metrics.playerMinX, metrics.playerMaxX);
  }

  // ---------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------
  const MAX_BALL_SPEED_FACTOR = 1.95; // multiplied by H

  function updatePlayer(dt) {
    player.vy += metrics.gravity * dt;
    player.y += player.vy * dt;
    if (player.y >= metrics.groundY) {
      player.y = metrics.groundY;
      player.vy = 0;
      player.grounded = true;
    }
    handleKeyboardMove(dt);
  }

  function updateCpu(dt) {
    const diff = DIFFICULTY[difficulty];
    cpu.aiTimer -= dt;

    const hitHeightY = metrics.groundY - metrics.playerRadius * 1.5;

    if (cpu.aiTimer <= 0) {
      cpu.aiTimer = diff.reactionDelay;

      let targetX;
      const ballComingToCpu = ball.vx > -5 && (ball.x > metrics.netX - W * 0.08);

      if (state === 'live' && ballComingToCpu) {
        targetX = predictLandingX(hitHeightY);
      } else {
        // idle/ready position: center of own court, biased toward net
        targetX = metrics.cpuMinX + (metrics.cpuMaxX - metrics.cpuMinX) * 0.4;
      }
      cpu.aiTarget = clamp(targetX, metrics.cpuMinX, metrics.cpuMaxX);
    }

    const dx = cpu.aiTarget - cpu.x;
    const maxStep = diff.moveSpeed * dt;
    if (Math.abs(dx) <= maxStep) {
      cpu.x = cpu.aiTarget;
    } else {
      cpu.x += Math.sign(dx) * maxStep;
    }
    cpu.x = clamp(cpu.x, metrics.cpuMinX, metrics.cpuMaxX);

    // jump decision
    if (cpu.grounded && state === 'live' && ball.x > metrics.netX - W * 0.03) {
      const distToBall = Math.abs(ball.x - cpu.x);
      const ballAboveHitZone = ball.y < metrics.groundY - metrics.playerRadius * 0.9 && ball.y > metrics.netTopY - metrics.playerRadius;
      const closeEnough = distToBall < metrics.playerRadius * 1.6;
      if (closeEnough && ballAboveHitZone && Math.random() < diff.jumpChance) {
        cpu.vy = metrics.jumpV * (0.92 + Math.random() * 0.16);
        cpu.grounded = false;
      }
    }

    cpu.vy += metrics.gravity * dt;
    cpu.y += cpu.vy * dt;
    if (cpu.y >= metrics.groundY) {
      cpu.y = metrics.groundY;
      cpu.vy = 0;
      cpu.grounded = true;
    }
  }

  // Predict x position where the ball will reach a given height (simple projectile solve)
  function predictLandingX(targetY) {
    let px = ball.x, py = ball.y, vx = ball.vx, vy = ball.vy;
    const g = metrics.gravity;
    const dt = 1 / 60;
    let t = 0;
    while (py < targetY && t < 3) {
      vy += g * dt;
      py += vy * dt;
      px += vx * dt;
      t += dt;
      if (px < metrics.leftBound || px > metrics.rightBound) { vx = -vx; }
    }
    return px;
  }

  function resolveNetCollision() {
    const netLeft = metrics.netX - metrics.netThickness / 2;
    const netRight = metrics.netX + metrics.netThickness / 2;
    const r = metrics.ballRadius;

    const closestX = clamp(ball.x, netLeft, netRight);
    const closestY = clamp(ball.y, metrics.netTopY, metrics.groundY);

    const dx = ball.x - closestX;
    const dy = ball.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < r * r) {
      const dist = Math.sqrt(distSq);
      let nx, ny;
      if (dist > 0.0001) {
        nx = dx / dist;
        ny = dy / dist;
      } else {
        nx = 0;
        ny = -1;
      }

      const overlap = r - dist;
      ball.x += nx * overlap;
      ball.y += ny * overlap;

      const vDotN = ball.vx * nx + ball.vy * ny;
      ball.vx -= 2 * vDotN * nx;
      ball.vy -= 2 * vDotN * ny;
      ball.vx *= 0.55;
      ball.vy *= 0.55;
    }
  }

  function updateBall(dt) {
    if (state === 'serving') return;

    ball.vy += metrics.gravity * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // trail
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 8) ball.trail.shift();

    if (ball.hitCooldown > 0) ball.hitCooldown -= dt;

    // side walls (bounce back into play)
    if (ball.x - metrics.ballRadius < metrics.leftBound) {
      ball.x = metrics.leftBound + metrics.ballRadius;
      ball.vx = Math.abs(ball.vx) * 0.85;
    } else if (ball.x + metrics.ballRadius > metrics.rightBound) {
      ball.x = metrics.rightBound - metrics.ballRadius;
      ball.vx = -Math.abs(ball.vx) * 0.85;
    }

    // net collision (circle vs rect, closest-point method)
    resolveNetCollision();

    // ground collision -> point
    if (ball.y + metrics.ballRadius >= metrics.groundY) {
      ball.y = metrics.groundY - metrics.ballRadius;
      endRally(ball.x < metrics.netX ? 'cpu' : 'player');
      return;
    }

    // player / cpu collisions
    resolveCharacterCollision(player, 'player');
    resolveCharacterCollision(cpu, 'cpu');

    // clamp speed
    const speed = Math.hypot(ball.vx, ball.vy);
    const maxSpeed = H * MAX_BALL_SPEED_FACTOR;
    if (speed > maxSpeed) {
      ball.vx = (ball.vx / speed) * maxSpeed;
      ball.vy = (ball.vy / speed) * maxSpeed;
    }
  }

  function resolveCharacterCollision(entity, who) {
    if (ball.hitCooldown > 0 && ball.lastHitBy === who) return;

    const centerY = entity.y - metrics.playerRadius;
    const dx = ball.x - entity.x;
    const dy = ball.y - centerY;
    const dist = Math.hypot(dx, dy);
    const minDist = metrics.playerRadius + metrics.ballRadius;

    if (dist < minDist && dist > 0.001) {
      const nx = dx / dist;
      const ny = dy / dist;

      // push ball out of overlap
      const overlap = minDist - dist;
      ball.x += nx * overlap;
      ball.y += ny * overlap;

      if (who === 'player') {
        hitAsPlayer(nx, ny, entity);
      } else {
        hitAsCpu(nx, ny, entity);
      }

      ball.lastHitBy = who;
      ball.hitCooldown = 0.18;

      if (state === 'serving') {
        state = 'live';
      }
    }
  }

  function hitAsPlayer(nx, ny, entity) {
    const HIT_POWER = H * 1.35;
    let vx = nx * HIT_POWER + player.vx * 0.55;
    let vy = ny * HIT_POWER;

    // ensure a satisfying upward arc
    const minUp = -H * 0.6;
    if (vy > minUp) vy = minUp * 0.6 + vy * 0.4;

    // incorporate lateral drag movement for aiming
    vx += (moveVelocityHint()) * 0.6;

    // tiny nudge so a perfectly still, dead-center hit never repeats
    // into an endless straight-up-and-down bounce
    vx += (Math.random() - 0.5) * H * 0.04;

    ball.vx = vx;
    ball.vy = vy;
  }

  let lastPlayerX = 0, playerMoveVel = 0;
  function moveVelocityHint() {
    return playerMoveVel;
  }

  // Serves always land safely on the receiver's court in a clean arc over
  // the net (like an arcade volleyball serve) — the receiver must then
  // move in to return it. This avoids requiring the server to also "catch"
  // their own toss, which would otherwise stall the game if left untouched.
  function launchServe() {
    const receiverIsPlayer = server === 'cpu';
    const marginX = metrics.playerRadius * 1.4;
    let targetX;
    if (receiverIsPlayer) {
      targetX = metrics.playerMinX + Math.random() * (metrics.playerMaxX - metrics.playerMinX);
    } else {
      targetX = metrics.cpuMinX + Math.random() * (metrics.cpuMaxX - metrics.cpuMinX);
    }

    const flightTime = 0.85 + Math.random() * 0.35;
    const g = metrics.gravity;
    const targetY = metrics.groundY - metrics.ballRadius;

    let vx = (targetX - ball.x) / flightTime;
    let vy = (targetY - ball.y - 0.5 * g * flightTime * flightTime) / flightTime;

    const minUp = -H * 0.45;
    if (vy > minUp) vy = minUp;

    ball.vx = vx;
    ball.vy = vy;
  }

  function hitAsCpu(nx, ny, entity) {
    const diff = DIFFICULTY[difficulty];

    // occasional weak/mistimed hit on easy difficulty
    const shank = Math.random() < diff.hesitation;

    const marginX = metrics.playerRadius * 1.4;
    let targetX = clamp(
      metrics.playerMinX + Math.random() * (metrics.playerMaxX - metrics.playerMinX),
      metrics.leftBound + marginX,
      metrics.netX - metrics.netThickness - marginX
    );
    targetX += (Math.random() * 2 - 1) * diff.aimError;
    targetX = clamp(targetX, metrics.leftBound + marginX, metrics.netX - metrics.netThickness - marginX);

    const flightTime = diff.flightTime[0] + Math.random() * (diff.flightTime[1] - diff.flightTime[0]);
    const g = metrics.gravity;
    const targetY = metrics.groundY - metrics.ballRadius;

    let vx = (targetX - ball.x) / flightTime;
    let vy = (targetY - ball.y - 0.5 * g * flightTime * flightTime) / flightTime;

    const minUp = -H * 0.5;
    if (vy > minUp) vy = minUp;

    if (shank) {
      vx *= 0.55;
      vy *= 0.6;
    }

    const speed = Math.hypot(vx, vy);
    const maxSpeed = H * MAX_BALL_SPEED_FACTOR;
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }

    ball.vx = vx;
    ball.vy = vy;
  }

  function endRally(winner) {
    if (winner === 'player') { scoreA++; } else { scoreB++; }
    updateScoreUI();

    showBanner(winner === 'player' ? '¡Punto para vos!' : 'Punto CPU');

    state = 'point';
    serveTimer = 1.0;

    if ((scoreA >= winScore || scoreB >= winScore) && Math.abs(scoreA - scoreB) >= 2) {
      setTimeout(() => showGameOver(scoreA > scoreB), 900);
    } else {
      const nextServer = winner;
      setTimeout(() => {
        resetPositions();
        startServe(nextServer);
      }, 900);
    }
  }

  function showBanner(text) {
    pointBanner.textContent = text;
    pointBanner.hidden = false;
    pointBanner.style.animation = 'none';
    void pointBanner.offsetWidth;
    pointBanner.style.animation = '';
    setTimeout(() => { pointBanner.hidden = true; }, 1100);
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, metrics.groundY);
    sky.addColorStop(0, '#8fe0f5');
    sky.addColorStop(1, '#c9f2e0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, metrics.groundY);

    // sun
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.arc(W * 0.85, H * 0.15, Math.min(W, H) * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // sand
    const sand = ctx.createLinearGradient(0, metrics.groundY, 0, H);
    sand.addColorStop(0, '#f4d896');
    sand.addColorStop(1, '#e0b862');
    ctx.fillStyle = sand;
    ctx.fillRect(0, metrics.groundY, W, H - metrics.groundY);

    // court line
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(2, H * 0.006);
    ctx.beginPath();
    ctx.moveTo(metrics.leftBound, metrics.groundY);
    ctx.lineTo(metrics.rightBound, metrics.groundY);
    ctx.stroke();

    // net
    drawNet();

    // shadows
    drawShadow(player.x, metrics.groundY, metrics.playerRadius);
    drawShadow(cpu.x, metrics.groundY, metrics.playerRadius);
    drawShadow(ball.x, metrics.groundY, metrics.ballRadius, clamp((metrics.groundY - ball.y) / (H * 0.5), 0, 1));

    // trail
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const a = (i / ball.trail.length) * 0.25;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.arc(t.x, t.y, metrics.ballRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCharacter(player);
    drawCharacter(cpu);
    drawBall();
  }

  function drawShadow(x, groundY, r, heightFactor) {
    const scale = heightFactor === undefined ? 1 : 1 - heightFactor * 0.5;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.ellipse(x, groundY + 4, r * 0.9 * scale, r * 0.32 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawNet() {
    const netLeft = metrics.netX - metrics.netThickness / 2;
    const poleW = metrics.netThickness * 1.6;

    // poles
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(metrics.netX - poleW / 2, metrics.netTopY - 10, poleW, metrics.groundY - metrics.netTopY + 10);

    // mesh
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    const meshTop = metrics.netTopY;
    const meshBottom = metrics.groundY;
    const meshLeft = metrics.netX - metrics.netThickness * 3;
    const meshRight = metrics.netX + metrics.netThickness * 3;

    ctx.save();
    ctx.beginPath();
    ctx.rect(meshLeft, meshTop, meshRight - meshLeft, meshBottom - meshTop);
    ctx.clip();

    const step = Math.max(8, W * 0.018);
    for (let x = meshLeft; x <= meshRight; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, meshTop);
      ctx.lineTo(x, meshBottom);
      ctx.globalAlpha = 0.35;
      ctx.stroke();
    }
    for (let y = meshTop; y <= meshBottom; y += step) {
      ctx.beginPath();
      ctx.moveTo(meshLeft, y);
      ctx.lineTo(meshRight, y);
      ctx.globalAlpha = 0.35;
      ctx.stroke();
    }
    ctx.restore();

    // top band
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(meshLeft, meshTop - 4, meshRight - meshLeft, 8);
  }

  function drawCharacter(entity) {
    const r = metrics.playerRadius;
    const cy = entity.y - r;
    const squash = entity.grounded ? 1 : 1 - clamp(Math.abs(entity.vy) / (H * 1.2), 0, 0.18);

    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.scale(1, squash);
    ctx.translate(-entity.x, -entity.y);

    // body
    ctx.beginPath();
    ctx.fillStyle = entity.dark;
    ctx.roundRect(entity.x - r * 0.55, cy - r * 0.1, r * 1.1, r * 1.3, r * 0.3);
    ctx.fill();

    // head
    ctx.beginPath();
    ctx.fillStyle = entity.color;
    ctx.arc(entity.x, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // simple face
    const faceDir = entity.facing;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.arc(entity.x + faceDir * r * 0.35, cy - r * 0.05, r * 0.11, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate((ball.x + ball.y) * 0.01);

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(0, 0, metrics.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = Math.max(1.5, metrics.ballRadius * 0.14);
    ctx.beginPath();
    ctx.arc(0, 0, metrics.ballRadius, 0.3, 1.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, metrics.ballRadius, Math.PI + 0.3, Math.PI + 1.8);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(30,30,30,0.5)';
    ctx.lineWidth = Math.max(1, metrics.ballRadius * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, metrics.ballRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  function loop(ts) {
    if (state === 'paused' || state === 'menu' || state === 'gameover') { lastTime = ts; return; }

    let dt = (ts - lastTime) / 1000;
    if (!lastTime || dt > 0.05) dt = 1 / 60;
    lastTime = ts;

    playerMoveVel = (player.x - lastPlayerX) / Math.max(dt, 0.001);
    lastPlayerX = player.x;
    player.vx = playerMoveVel;
    if (Math.abs(playerMoveVel) > 4) player.facing = playerMoveVel > 0 ? 1 : -1;

    if (state === 'serving') {
      serveTimer -= dt;
      updatePlayer(dt);
      updateCpu(dt);
      // ball floats gently during toss
      ball.y += Math.sin(performance.now() / 220) * 0.15;
      if (serveTimer <= 0) {
        state = 'live';
        launchServe();
      }
    } else if (state === 'live') {
      updatePlayer(dt);
      updateCpu(dt);
      updateBall(dt);
    } else if (state === 'point') {
      updatePlayer(dt);
      updateCpu(dt);
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  function showGameOver(playerWon) {
    state = 'gameover';
    endTitleEl.textContent = playerWon ? '¡Ganaste! 🏆' : 'Perdiste 😅';
    endScoreEl.textContent = `${scoreA} - ${scoreB}`;
    showScreen(endScreen);
  }

  // ---------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------
  function showScreen(screen) {
    menuScreen.hidden = true;
    gameScreen.hidden = true;
    pauseScreen.hidden = true;
    endScreen.hidden = true;

    // pause/end are overlays drawn on top of the game screen
    if (screen === pauseScreen || screen === endScreen) {
      gameScreen.hidden = false;
    }
    screen.hidden = false;
  }

  playBtn.addEventListener('click', () => {
    showScreen(gameScreen);
    requestAnimationFrame(() => {
      newMatch();
      lastTime = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    });
  });

  pauseBtn.addEventListener('click', () => {
    if (state === 'live' || state === 'serving' || state === 'point') {
      state = 'paused';
      showScreen(pauseScreen);
    }
  });

  resumeBtn.addEventListener('click', () => {
    state = 'live';
    lastTime = 0;
    showScreen(gameScreen);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  });

  menuFromPauseBtn.addEventListener('click', () => {
    state = 'menu';
    showScreen(menuScreen);
  });

  rematchBtn.addEventListener('click', () => {
    showScreen(gameScreen);
    newMatch();
    lastTime = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  });

  menuFromEndBtn.addEventListener('click', () => {
    state = 'menu';
    showScreen(menuScreen);
  });

  // ---------------------------------------------------------------
  // PWA install prompt
  // ---------------------------------------------------------------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
  });

  // ---------------------------------------------------------------
  // Service worker registration
  // ---------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // initial size (in case game screen becomes visible later, resize runs again)
  resizeCanvas();
})();

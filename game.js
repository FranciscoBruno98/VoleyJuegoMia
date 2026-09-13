(() => {
  'use strict';

  // ---------------------------------------------------------------
  // World space
  // ---------------------------------------------------------------
  // X: -0.5 (left sideline) .. 0.5 (right sideline)
  // Z: 0 (far baseline, CPU team) .. 2 (near baseline, my team), net at Z=1
  // Y: height above ground (0 = ground), grows upward
  const NET_Z = 1;
  const COURT_X_MIN = -0.68;
  const COURT_X_MAX = 0.68;
  const MY_BASELINE_Z = 1.95;
  const CPU_BASELINE_Z = 0.05;
  const NET_HEIGHT = 0.26;
  const GRAVITY = 1.2;
  const JUMP_VY = 0.62;
  const COLLISION_RADIUS = 0.075;
  const BALL_RADIUS = 0.032;
  const REACH_HEIGHT = 0.20;
  const MAX_TOUCHES = 3;

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

  const touchCounterEl = document.getElementById('touchCounter');
  const touchCounterLabelEl = touchCounterEl.querySelector('.touch-counter-label');
  const touchDotEls = Array.from(touchCounterEl.querySelectorAll('.touch-dot'));

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
    facil:   { moveSpeed: 0.52, reactionDelay: 0.46, aimError: 0.17, jumpChance: 0.80, flightTime: [0.55, 0.80], hesitation: 0.30 },
    normal:  { moveSpeed: 0.78, reactionDelay: 0.24, aimError: 0.09, jumpChance: 0.92, flightTime: [0.48, 0.70], hesitation: 0.12 },
    dificil: { moveSpeed: 1.05, reactionDelay: 0.10, aimError: 0.03, jumpChance: 1.00, flightTime: [0.42, 0.62], hesitation: 0.0 },
  };

  // My AI teammates are a fixed, reasonably competent tier regardless of
  // the chosen opponent difficulty (difficulty only governs the CPU team).
  const TEAMMATE_AI = { moveSpeed: 0.80, reactionDelay: 0.16, aimError: 0.06, jumpChance: 0.95, flightTime: [0.5, 0.72], hesitation: 0.05 };

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

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------
  // Canvas / projection
  // ---------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  let proj = {};

  function resizeCanvas() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = gameScreen.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeProjection();
  }

  function computeProjection() {
    proj = {
      horizonY: H * 0.24,
      baseY: H - Math.max(16, H * 0.045),
      widthHalfPx: W * 0.335,
      heightPxPerUnit: H * 0.62,
      farScale: 0.42,
    };
  }

  function scaleAtZ(z) {
    // z=0 (far) -> farScale, z=2 (near) -> 1.0
    const t = clamp(z / 2, 0, 1);
    return lerp(proj.farScale, 1, t);
  }

  function groundScreenY(z) {
    const t = clamp(z / 2, 0, 1);
    return lerp(proj.horizonY, proj.baseY, t);
  }

  function screenX(x, z) {
    return W / 2 + x * proj.widthHalfPx * scaleAtZ(z);
  }

  function screenY(y, z) {
    return groundScreenY(z) - y * proj.heightPxPerUnit * scaleAtZ(z);
  }

  window.addEventListener('resize', () => {
    if (!gameScreen.hidden) resizeCanvas();
  });

  // ---------------------------------------------------------------
  // Teams & entities
  // ---------------------------------------------------------------
  function makeRoster(teamKey) {
    const isMy = teamKey === 'my';
    const frontZ = isMy ? 1.30 : 0.70;
    const backZ = isMy ? 1.80 : 0.20;
    const slots = [
      { x: -0.46, z: frontZ },
      { x: 0.03, z: frontZ - 0.03 },
      { x: 0.48, z: frontZ },
      { x: -0.56, z: backZ },
      { x: -0.04, z: backZ + 0.04 },
      { x: 0.54, z: backZ },
    ];
    return slots.map((s, i) => ({
      id: teamKey + i,
      team: teamKey,
      homeX: s.x,
      homeZ: s.z,
      x: s.x,
      z: s.z,
      y: 0,
      vy: 0,
      grounded: true,
      isPlayer: false,
      vx: 0,
      vz: 0,
    }));
  }

  const teams = {
    my: makeRoster('my'),
    cpu: makeRoster('cpu'),
  };

  // Player controls the front-mid slot of "my" team
  const playerChar = teams.my[1];
  playerChar.isPlayer = true;

  const TEAM_COLORS = {
    my: { color: '#2fb8ff', dark: '#1483c4' },
    cpu: { color: '#ff6b57', dark: '#c8402e' },
  };

  const ball = {
    x: 0, y: 0, z: NET_Z, vx: 0, vy: 0, vz: 0,
    lastHitEntity: null, hitCooldown: 0, trail: [],
  };

  const teamAI = {
    my: { timer: 0, targetX: 0, targetZ: 0, responderId: null },
    cpu: { timer: 0, targetX: 0, targetZ: 0, responderId: null },
  };

  const rally = { side: 'my', touches: { my: 0, cpu: 0 } };

  let scoreA = 0; // my team (VOS)
  let scoreB = 0; // cpu team
  let server = 'my';
  let state = 'menu'; // menu | serving | live | point | gameover | paused
  let serveTimer = 0;
  let lastTime = 0;
  let rafId = null;

  function resetFormation() {
    for (const key of ['my', 'cpu']) {
      for (const c of teams[key]) {
        c.x = c.homeX;
        c.z = c.homeZ;
        c.y = 0;
        c.vy = 0;
        c.grounded = true;
      }
    }
    teamAI.my.responderId = null;
    teamAI.cpu.responderId = null;
  }

  function startServe(who) {
    server = who;
    state = 'serving';
    serveTimer = 0.8;
    ball.vx = 0; ball.vy = 0; ball.vz = 0;
    ball.lastHitEntity = null;
    ball.hitCooldown = 0;
    ball.trail.length = 0;

    const serverChar = who === 'my' ? teams.my[5] : teams.cpu[5];
    ball.x = serverChar.x;
    ball.z = serverChar.z;
    ball.y = 0.55;
  }

  function newMatch() {
    scoreA = 0; scoreB = 0;
    updateScoreUI();
    resizeCanvas();
    resetFormation();
    startServe(Math.random() < 0.5 ? 'my' : 'cpu');
  }

  function updateScoreUI() {
    scoreLeftEl.textContent = scoreA;
    scoreRightEl.textContent = scoreB;
  }

  function updateTouchCounterUI() {
    if (state !== 'live') { touchCounterEl.hidden = true; return; }
    touchCounterEl.hidden = false;
    touchCounterLabelEl.textContent = rally.side === 'my' ? 'TUS TOQUES' : 'TOQUES CPU';
    const n = rally.touches[rally.side];
    touchDotEls.forEach((dot, i) => dot.classList.toggle('filled', i < n));
  }

  // ---------------------------------------------------------------
  // Input: 2D drag to move + jump button
  // ---------------------------------------------------------------
  let dragActive = false;
  let dragLastX = 0, dragLastY = 0;
  const MOVE_SENS = 1.25;

  function applyDrag(dx, dy) {
    const s = scaleAtZ(playerChar.z);
    const worldDX = (dx / (proj.widthHalfPx * s)) * MOVE_SENS;
    const worldDZ = (dy / (proj.heightPxPerUnit * s)) * MOVE_SENS;
    playerChar.x = clamp(playerChar.x + worldDX, COURT_X_MIN, COURT_X_MAX);
    playerChar.z = clamp(playerChar.z + worldDZ, NET_Z + 0.05, MY_BASELINE_Z);
  }

  moveZone.addEventListener('touchstart', (e) => {
    dragActive = true;
    dragLastX = e.touches[0].clientX;
    dragLastY = e.touches[0].clientY;
    e.preventDefault();
  }, { passive: false });

  moveZone.addEventListener('touchmove', (e) => {
    if (!dragActive) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    applyDrag(x - dragLastX, y - dragLastY);
    dragLastX = x; dragLastY = y;
    e.preventDefault();
  }, { passive: false });

  moveZone.addEventListener('touchend', () => { dragActive = false; });
  moveZone.addEventListener('touchcancel', () => { dragActive = false; });

  // mouse fallback (desktop testing)
  moveZone.addEventListener('mousedown', (e) => { dragActive = true; dragLastX = e.clientX; dragLastY = e.clientY; });
  window.addEventListener('mousemove', (e) => {
    if (!dragActive) return;
    applyDrag(e.clientX - dragLastX, e.clientY - dragLastY);
    dragLastX = e.clientX; dragLastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragActive = false; });

  function doJump() {
    if (playerChar.grounded && (state === 'live' || state === 'serving')) {
      playerChar.vy = JUMP_VY;
      playerChar.grounded = false;
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
    const speed = 0.9;
    let dx = 0, dz = 0;
    if (keys['ArrowLeft']) dx -= 1;
    if (keys['ArrowRight']) dx += 1;
    if (keys['KeyW']) dz -= 1;
    if (keys['KeyS']) dz += 1;
    if (dx || dz) {
      playerChar.x = clamp(playerChar.x + dx * speed * dt, COURT_X_MIN, COURT_X_MAX);
      playerChar.z = clamp(playerChar.z + dz * speed * dt, NET_Z + 0.05, MY_BASELINE_Z);
    }
  }

  // ---------------------------------------------------------------
  // Physics: characters
  // ---------------------------------------------------------------
  function updateCharacterVertical(c, dt) {
    c.vy -= GRAVITY * dt;
    c.y += c.vy * dt;
    if (c.y <= 0) { c.y = 0; c.vy = 0; c.grounded = true; }
  }

  function updatePlayer(dt) {
    handleKeyboardMove(dt);
    updateCharacterVertical(playerChar, dt);
  }

  function moveToward(c, tx, tz, maxStep) {
    const dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= maxStep || dist < 0.0001) {
      c.x = tx; c.z = tz;
    } else {
      c.x += (dx / dist) * maxStep;
      c.z += (dz / dist) * maxStep;
    }
  }

  function predictBallGroundPoint(thresholdY) {
    let x = ball.x, y = ball.y, z = ball.z, vx = ball.vx, vy = ball.vy, vz = ball.vz;
    const g = GRAVITY, dt = 1 / 60;
    let t = 0;
    while (y > thresholdY && t < 3) {
      vy -= g * dt;
      x += vx * dt; y += vy * dt; z += vz * dt;
      t += dt;
      if (x < COURT_X_MIN || x > COURT_X_MAX) vx = -vx;
    }
    return { x: clamp(x, COURT_X_MIN, COURT_X_MAX), z };
  }

  function updateTeamAI(teamKey, dt) {
    const roster = teams[teamKey];
    const aiChars = roster.filter(c => !c.isPlayer);
    const st = teamAI[teamKey];
    const isMy = teamKey === 'my';
    const diff = isMy ? TEAMMATE_AI : DIFFICULTY[difficulty];

    const onOurSide = isMy ? (ball.z > NET_Z) : (ball.z < NET_Z);

    st.timer -= dt;
    if (st.timer <= 0) {
      st.timer = diff.reactionDelay;
      if (onOurSide && (state === 'live')) {
        const pred = predictBallGroundPoint(0.10);
        const zMin = isMy ? NET_Z + 0.08 : 0.06;
        const zMax = isMy ? MY_BASELINE_Z : NET_Z - 0.08;
        st.targetX = clamp(pred.x, COURT_X_MIN + 0.05, COURT_X_MAX - 0.05);
        st.targetZ = clamp(pred.z, zMin, zMax);

        let best = null, bestD = Infinity;
        for (const c of aiChars) {
          const d = Math.hypot(c.x - st.targetX, c.z - st.targetZ);
          if (d < bestD) { bestD = d; best = c; }
        }
        st.responderId = best ? best.id : null;
      } else {
        st.responderId = null;
      }
    }

    for (const c of aiChars) {
      let tx = c.homeX, tz = c.homeZ;
      if (c.id === st.responderId) { tx = st.targetX; tz = st.targetZ; }
      moveToward(c, tx, tz, diff.moveSpeed * dt);

      if (c.grounded && c.id === st.responderId && onOurSide && state === 'live') {
        const dist = Math.hypot(ball.x - c.x, ball.z - c.z);
        const ballInReach = ball.y < 0.34 && ball.y > 0.02;
        if (dist < COLLISION_RADIUS * 1.9 && ballInReach && Math.random() < diff.jumpChance) {
          c.vy = JUMP_VY * (0.9 + Math.random() * 0.2);
          c.grounded = false;
        }
      }
      updateCharacterVertical(c, dt);
    }
  }

  // ---------------------------------------------------------------
  // Serve
  // ---------------------------------------------------------------
  function launchServe() {
    const receivingTeam = server === 'my' ? 'cpu' : 'my';
    const zMin = receivingTeam === 'my' ? NET_Z + 0.15 : 0.15;
    const zMax = receivingTeam === 'my' ? MY_BASELINE_Z - 0.1 : NET_Z - 0.15;
    const targetX = lerp(COURT_X_MIN + 0.08, COURT_X_MAX - 0.08, Math.random());
    const targetZ = lerp(zMin, zMax, Math.random());

    const flightTime = 0.95 + Math.random() * 0.35;
    const { vx, vy, vz } = solveShot(ball.x, ball.y, ball.z, targetX, 0, targetZ, flightTime, 0.32);
    ball.vx = vx; ball.vy = vy; ball.vz = vz;

    rally.side = receivingTeam;
    rally.touches.my = 0;
    rally.touches.cpu = 0;
  }

  function solveShot(x0, y0, z0, tx, ty, tz, T, minUp) {
    const g = GRAVITY;
    let vx = (tx - x0) / T;
    let vz = (tz - z0) / T;
    let vy = (ty - y0 + 0.5 * g * T * T) / T;
    if (vy < minUp) vy = minUp;
    return { vx, vy, vz };
  }

  // ---------------------------------------------------------------
  // Ball physics
  // ---------------------------------------------------------------
  const MAX_SPEED = 2.6;

  function resolveNetCollision() {
    const zDist = Math.abs(ball.z - NET_Z);
    if (zDist < BALL_RADIUS && ball.y < NET_HEIGHT + BALL_RADIUS) {
      const dir = ball.z >= NET_Z ? 1 : -1;
      ball.z = NET_Z + dir * (BALL_RADIUS + 0.002);
      ball.vz = -ball.vz * 0.5;
      ball.vy = Math.max(ball.vy * 0.35, 0.18);
    }
  }

  function updateBall(dt) {
    if (state === 'serving') return;

    ball.vy -= GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;

    ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
    if (ball.trail.length > 8) ball.trail.shift();

    if (ball.hitCooldown > 0) ball.hitCooldown -= dt;

    // side walls
    if (ball.x - BALL_RADIUS < COURT_X_MIN) {
      ball.x = COURT_X_MIN + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * 0.85;
    } else if (ball.x + BALL_RADIUS > COURT_X_MAX) {
      ball.x = COURT_X_MAX - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * 0.85;
    }

    resolveNetCollision();

    // update which side currently "owns" the rally
    const margin = BALL_RADIUS;
    if (ball.z > NET_Z + margin && rally.side !== 'my') {
      rally.side = 'my';
      rally.touches.my = 0;
    } else if (ball.z < NET_Z - margin && rally.side !== 'cpu') {
      rally.side = 'cpu';
      rally.touches.cpu = 0;
    }

    // ground -> point
    if (ball.y <= 0) {
      ball.y = 0;
      const landedOn = ball.z > NET_Z ? 'my' : 'cpu';
      endRally(landedOn === 'my' ? 'cpu' : 'my', 'ground');
      return;
    }

    for (const c of teams.my) resolveCharacterCollision(c);
    for (const c of teams.cpu) resolveCharacterCollision(c);

    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (speed > MAX_SPEED) {
      const k = MAX_SPEED / speed;
      ball.vx *= k; ball.vy *= k; ball.vz *= k;
    }
  }

  function resolveCharacterCollision(c) {
    if (ball.hitCooldown > 0 && ball.lastHitEntity === c.id) return;

    const dx = ball.x - c.x;
    const dz = ball.z - c.z;
    const horizDist = Math.hypot(dx, dz);
    const reach = COLLISION_RADIUS + BALL_RADIUS;
    if (horizDist >= reach) return;

    const bandLow = c.y - 0.03;
    const bandHigh = c.y + REACH_HEIGHT;
    if (ball.y < bandLow || ball.y > bandHigh) return;

    handleContact(c, dx, dz, horizDist || 0.0001);
  }

  function handleContact(c, dx, dz, horizDist) {
    const team = c.team;

    if (rally.touches[team] >= MAX_TOUCHES) {
      // illegal 4th touch on the same side
      endRally(team === 'my' ? 'cpu' : 'my', 'toques');
      return;
    }

    rally.touches[team] += 1;
    const touchNumber = rally.touches[team];

    if (touchNumber < MAX_TOUCHES) {
      // touches 1 (reception) and 2 (set) always stay on our own side -
      // every team must use its full bump-set-spike sequence before the
      // ball can cross back over the net, human player included.
      hitPass(c, team, touchNumber, dx, dz, horizDist);
    } else if (c.isPlayer) {
      hitAsPlayer(c, dx, dz, horizDist);
    } else {
      hitAsAiAttack(c, team);
    }

    ball.lastHitEntity = c.id;
    ball.hitCooldown = 0.16;

    if (state === 'serving') state = 'live';
  }

  function hitAsPlayer(c, dx, dz, horizDist) {
    const nx = dx / horizDist;
    const nz = dz / horizDist;
    const HIT_POWER = 1.55;

    let vx = nx * HIT_POWER + (playerChar.vx || 0) * 0.5;
    let vz = nz * HIT_POWER + (playerChar.vz || 0) * 0.5;
    let vy = 0.95 - horizDist * 0.6;
    if (vy < 0.55) vy = 0.55;

    // tiny nudge so a perfectly still, dead-center hit never repeats
    // into an endless straight up-and-down bounce
    vx += (Math.random() - 0.5) * 0.05;
    vz += (Math.random() - 0.5) * 0.05;

    ball.vx = vx; ball.vy = vy; ball.vz = vz;
  }

  function hitPass(c, team, touchNumber, dx, dz, horizDist) {
    // touch 1 (reception) or touch 2 (set) - keep the ball on our own side.
    // Works for both AI teammates/opponents and the human player.
    const nearNetZ = team === 'my' ? NET_Z + 0.20 : NET_Z - 0.20;
    let targetX;
    if (c.isPlayer) {
      // let the player steer the pass a little via contact angle + movement
      const nx = dx / horizDist;
      targetX = c.x + nx * 0.22 + (playerChar.vx || 0) * 0.15;
    } else {
      targetX = touchNumber === 1 ? c.x : (Math.random() * 2 - 1) * 0.45;
    }
    targetX = clamp(targetX, COURT_X_MIN + 0.12, COURT_X_MAX - 0.12);
    const targetZ = nearNetZ;
    const flightTime = 0.45 + Math.random() * 0.2;

    const { vx, vy, vz } = solveShot(ball.x, ball.y, ball.z, targetX, 0, targetZ, flightTime, 0.30);
    ball.vx = vx; ball.vy = vy; ball.vz = vz;
  }

  function hitAsAiAttack(c, team) {
    const diff = team === 'my' ? TEAMMATE_AI : DIFFICULTY[difficulty];
    const shank = Math.random() < diff.hesitation;

    const opponentZMin = team === 'my' ? 0.12 : NET_Z + 0.12;
    const opponentZMax = team === 'my' ? NET_Z - 0.12 : MY_BASELINE_Z - 0.1;

    let targetX = lerp(COURT_X_MIN + 0.08, COURT_X_MAX - 0.08, Math.random());
    let targetZ = lerp(opponentZMin, opponentZMax, Math.random());
    targetX += (Math.random() * 2 - 1) * diff.aimError;
    targetZ += (Math.random() * 2 - 1) * diff.aimError;
    targetX = clamp(targetX, COURT_X_MIN + 0.05, COURT_X_MAX - 0.05);
    targetZ = clamp(targetZ, opponentZMin - 0.1, opponentZMax + 0.1);

    const flightTime = diff.flightTime[0] + Math.random() * (diff.flightTime[1] - diff.flightTime[0]);
    let { vx, vy, vz } = solveShot(ball.x, ball.y, ball.z, targetX, 0, targetZ, flightTime, 0.28);

    if (shank) { vx *= 0.5; vy *= 0.6; vz *= 0.5; }

    const speed = Math.hypot(vx, vy, vz);
    if (speed > MAX_SPEED) {
      const k = MAX_SPEED / speed;
      vx *= k; vy *= k; vz *= k;
    }

    ball.vx = vx; ball.vy = vy; ball.vz = vz;
  }

  function endRally(winnerTeam, reason) {
    if (winnerTeam === 'my') scoreA++; else scoreB++;
    updateScoreUI();

    let text;
    if (reason === 'toques') {
      text = (winnerTeam === 'my') ? '¡4 toques rival!' : '¡4 toques! Punto CPU';
    } else {
      text = (winnerTeam === 'my') ? '¡Punto para vos!' : 'Punto CPU';
    }
    showBanner(text);

    state = 'point';
    serveTimer = 1.0;

    if ((scoreA >= winScore || scoreB >= winScore) && Math.abs(scoreA - scoreB) >= 2) {
      setTimeout(() => showGameOver(scoreA > scoreB), 900);
    } else {
      const nextServer = winnerTeam;
      setTimeout(() => {
        resetFormation();
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

    const sky = ctx.createLinearGradient(0, 0, 0, proj.baseY);
    sky.addColorStop(0, '#8fe0f5');
    sky.addColorStop(1, '#c9f2e0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, proj.baseY);

    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.arc(W * 0.85, H * 0.12, Math.min(W, H) * 0.06, 0, Math.PI * 2);
    ctx.fill();

    drawCourt();
    drawNet();

    // gather drawables (players + ball) and sort by depth (far to near)
    const drawables = [];
    for (const c of teams.my) drawables.push({ type: 'char', ref: c });
    for (const c of teams.cpu) drawables.push({ type: 'char', ref: c });
    drawables.push({ type: 'ball', ref: ball });
    drawables.sort((a, b) => a.ref.z - b.ref.z);

    for (const d of drawables) {
      if (d.type === 'char') drawCharacter(d.ref);
      else drawBall();
    }
  }

  function drawCourt() {
    const farL = screenX(COURT_X_MIN, 0), farR = screenX(COURT_X_MAX, 0);
    const nearL = screenX(COURT_X_MIN, 2), nearR = screenX(COURT_X_MAX, 2);
    const farY = groundScreenY(0), nearY = groundScreenY(2);

    ctx.beginPath();
    ctx.moveTo(farL, farY);
    ctx.lineTo(farR, farY);
    ctx.lineTo(nearR, nearY);
    ctx.lineTo(nearL, nearY);
    ctx.closePath();
    const sand = ctx.createLinearGradient(0, farY, 0, nearY);
    sand.addColorStop(0, '#f4d896');
    sand.addColorStop(1, '#e0b862');
    ctx.fillStyle = sand;
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = Math.max(1.5, H * 0.004);
    ctx.beginPath();
    ctx.moveTo(farL, farY); ctx.lineTo(nearL, nearY);
    ctx.moveTo(farR, farY); ctx.lineTo(nearR, nearY);
    ctx.stroke();

    // center (net) line on the ground
    const cL = screenX(COURT_X_MIN, NET_Z), cR = screenX(COURT_X_MAX, NET_Z), cY = groundScreenY(NET_Z);
    ctx.beginPath();
    ctx.moveTo(cL, cY); ctx.lineTo(cR, cY);
    ctx.stroke();
  }

  function drawNet() {
    const y0 = groundScreenY(NET_Z);
    const yTop = y0 - NET_HEIGHT * proj.heightPxPerUnit * scaleAtZ(NET_Z);
    const xL = screenX(COURT_X_MIN, NET_Z);
    const xR = screenX(COURT_X_MAX, NET_Z);

    // mesh
    ctx.save();
    ctx.beginPath();
    ctx.rect(xL, yTop, xR - xL, y0 - yTop);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    const step = Math.max(6, (xR - xL) * 0.045);
    for (let x = xL; x <= xR; x += step) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, y0); ctx.stroke();
    }
    const vstep = Math.max(6, (y0 - yTop) * 0.18);
    for (let y = yTop; y <= y0; y += vstep) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(xR, y); ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(xL, yTop - 3, xR - xL, 6);

    // posts
    ctx.fillStyle = '#5a4632';
    const postW = Math.max(3, (xR - xL) * 0.012);
    ctx.fillRect(xL - postW, yTop - 8, postW, y0 - yTop + 8);
    ctx.fillRect(xR, yTop - 8, postW, y0 - yTop + 8);
  }

  const LIMB_COLOR = '#3a4652';

  function drawCharacter(c) {
    const s = scaleAtZ(c.z);
    const r = COLLISION_RADIUS * proj.heightPxPerUnit * s; // head radius
    const cx = screenX(c.x, c.z);
    const groundY = groundScreenY(c.z);
    const feetY = groundY - c.y * proj.heightPxPerUnit * s;

    const teamColors = TEAM_COLORS[c.team];

    const legLen = r * 1.55;
    const torsoLen = r * 1.5;
    const torsoW = r * 1.05;
    const hipY = feetY - legLen;
    const shoulderY = hipY - torsoLen;
    const headCY = shoulderY - r * 0.92;

    // shadow (always at true ground contact point, not the airborne feet)
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.ellipse(cx, groundY + r * 0.12, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineCap = 'round';

    // legs
    ctx.strokeStyle = LIMB_COLOR;
    ctx.lineWidth = Math.max(1.8, r * 0.32);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.30, hipY + r * 0.1);
    ctx.lineTo(cx - r * 0.32, feetY);
    ctx.moveTo(cx + r * 0.30, hipY + r * 0.1);
    ctx.lineTo(cx + r * 0.32, feetY);
    ctx.stroke();

    // arms
    ctx.strokeStyle = teamColors.dark;
    ctx.lineWidth = Math.max(1.4, r * 0.24);
    ctx.beginPath();
    ctx.moveTo(cx - torsoW * 0.48, shoulderY + torsoLen * 0.1);
    ctx.lineTo(cx - torsoW * 0.9, shoulderY + torsoLen * 0.58);
    ctx.moveTo(cx + torsoW * 0.48, shoulderY + torsoLen * 0.1);
    ctx.lineTo(cx + torsoW * 0.9, shoulderY + torsoLen * 0.58);
    ctx.stroke();

    // shorts
    ctx.beginPath();
    ctx.fillStyle = LIMB_COLOR;
    ctx.roundRect(cx - torsoW * 0.5, hipY - torsoLen * 0.22, torsoW, torsoLen * 0.4, r * 0.16);
    ctx.fill();

    // jersey (torso)
    ctx.beginPath();
    ctx.fillStyle = teamColors.color;
    ctx.roundRect(cx - torsoW / 2, shoulderY, torsoW, torsoLen * 0.82, r * 0.22);
    ctx.fill();

    // head
    ctx.beginPath();
    ctx.fillStyle = teamColors.dark;
    ctx.arc(cx, headCY, r, 0, Math.PI * 2);
    ctx.fill();

    if (c.isPlayer) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, r * 0.16);
      ctx.arc(cx, headCY, r * 1.3, 0, Math.PI * 2);
      ctx.stroke();

      // marker below the controlled player
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.arc(cx, groundY - r * 0.1, Math.max(2.5, r * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBall() {
    const s = scaleAtZ(ball.z);
    const r = Math.max(3, BALL_RADIUS * proj.heightPxPerUnit * s);
    const cx = screenX(ball.x, ball.z);
    const groundY = groundScreenY(ball.z);
    const cy = groundY - ball.y * proj.heightPxPerUnit * s;

    // shadow (fades with height)
    const heightFactor = clamp(ball.y / 0.9, 0, 1);
    ctx.beginPath();
    ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - heightFactor * 0.6)})`;
    ctx.ellipse(cx, groundY, r * (1 - heightFactor * 0.35), r * 0.32 * (1 - heightFactor * 0.35), 0, 0, Math.PI * 2);
    ctx.fill();

    // trail
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const ts = scaleAtZ(t.z);
      const tr = Math.max(2, BALL_RADIUS * proj.heightPxPerUnit * ts * 0.7);
      const tx = screenX(t.x, t.z);
      const ty = groundScreenY(t.z) - t.y * proj.heightPxPerUnit * ts;
      const a = (i / ball.trail.length) * 0.22;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((cx + cy) * 0.02);

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ff9f1c';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath(); ctx.arc(0, 0, r, 0.3, 1.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI + 0.3, Math.PI + 1.8); ctx.stroke();

    ctx.strokeStyle = 'rgba(30,30,30,0.5)';
    ctx.lineWidth = Math.max(0.8, r * 0.08);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  let lastPlayerX = 0, lastPlayerZ = 0;

  function loop(ts) {
    if (state === 'paused' || state === 'menu' || state === 'gameover') { lastTime = ts; return; }

    let dt = (ts - lastTime) / 1000;
    if (!lastTime || dt > 0.05) dt = 1 / 60;
    lastTime = ts;

    playerChar.vx = (playerChar.x - lastPlayerX) / Math.max(dt, 0.001);
    playerChar.vz = (playerChar.z - lastPlayerZ) / Math.max(dt, 0.001);
    lastPlayerX = playerChar.x;
    lastPlayerZ = playerChar.z;

    if (state === 'serving') {
      serveTimer -= dt;
      updatePlayer(dt);
      updateTeamAI('my', dt);
      updateTeamAI('cpu', dt);
      ball.y = 0.55 + Math.sin(performance.now() / 220) * 0.02;
      if (serveTimer <= 0) {
        state = 'live';
        launchServe();
      }
    } else if (state === 'live') {
      updatePlayer(dt);
      updateTeamAI('my', dt);
      updateTeamAI('cpu', dt);
      updateBall(dt);
    } else if (state === 'point') {
      updatePlayer(dt);
      updateTeamAI('my', dt);
      updateTeamAI('cpu', dt);
    }

    updateTouchCounterUI();
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
      lastPlayerX = playerChar.x;
      lastPlayerZ = playerChar.z;
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
    lastPlayerX = playerChar.x;
    lastPlayerZ = playerChar.z;
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

  resizeCanvas();
})();

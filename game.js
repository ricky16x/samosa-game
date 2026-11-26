(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const Audio = window.SamosaAudio;

  const W = 360;
  const H = 640;
  const LANES = [102, 180, 258];

  // Geographically believable West -> Central Delhi route
  const LOCATIONS = [
    { min: 0, max: 500, name: "UTTAM NAGAR", short: "UN", road: "#47485b", kerb: "#6ec6ff", grass: "#3f6350" },
    { min: 500, max: 1000, name: "JANAKPURI", short: "JP", road: "#4d485d", kerb: "#ffd45a", grass: "#446c53" },
    { min: 1000, max: 1600, name: "RAJOURI GARDEN", short: "RG", road: "#4b455a", kerb: "#ff9d58", grass: "#486b4c" },
    { min: 1600, max: 2300, name: "KAROL BAGH", short: "KB", road: "#423e56", kerb: "#ff6b9d", grass: "#3c584e" },
    { min: 2300, max: 3200, name: "CONNAUGHT PLACE", short: "CP", road: "#4f4a5e", kerb: "#f0c96b", grass: "#467351" },
    { min: 3200, max: 5000, name: "INDIA GATE", short: "IG", road: "#4a4354", kerb: "#ffe38f", grass: "#4a784f" }
  ];

  // Cookie + localStorage persistence
  function setCookie(name, value, days = 365) {
    const exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
  }
  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  let state = "menu";
  let score = 0;
  let deliveries = 0;
  let best = Math.max(
    Number(localStorage.getItem("samosaBest") || 0),
    Number(getCookie("samosaBest") || 0)
  );
  $("best").textContent = String(best).padStart(6, "0");

  let player = {
    lane: 1,
    x: LANES[1],
    y: 522,
    vx: 0,
    tilt: 0,
    squash: 0,
    invuln: 0,
    mirchi: 0,
    vehicle: "scooter",
    vehicleDist: 0,
    slip: 0
  };

  let obstacles = [];
  let items = [];
  let particles = [];
  let popups = [];
  let bystanders = [];
  let dropoff = null;

  let roadOffset = 0;
  let spawnTimer = 0;
  let itemTimer = 0;
  let eventTimer = 14;
  let curSpeed = 240;
  let elapsed = 0;
  let nextDeliveryAt = 12;
  let heat = 100;
  let boostMeter = 100;
  let combo = 1;
  let comboTimer = 0;
  let toastTimer = 0;
  let shake = 0;
  let currentLocIndex = 0;

  let queuedMove = 0;
  let boostHeld = false;
  let brakeHeld = false;
  let keysDown = new Set();
  let musicOn = true;
  let sfxOn = true;

  const rand = (a, b) => Math.random() * (b - a) + a;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function ensureAudio() {
    if (Audio) Audio.init();
  }

  function clearToast() {
    toastTimer = 0;
    $("toast").classList.remove("show");
  }

  function toast(text) {
    if (state !== "playing") return;
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    toastTimer = 1.25;
  }

  function addPopup(x, y, text, color = "#ffd45a") {
    popups.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  function spawnParticles(x, y, color, count = 8, spreadX = 90, minVy = -120, maxVy = 40) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x,
        y,
        vx: rand(-spreadX, spreadX),
        vy: rand(minVy, maxVy),
        size: rand(3, 5),
        life: rand(0.25, 0.55),
        maxLife: 0.55,
        color
      });
    }
  }

  function initBystanders() {
    bystanders = [];
    const shirts = ["#ff793f", "#7ee0b5", "#ffd45a", "#ff6b9d", "#6ec6ff", "#e8d5b7"];
    const awnings = ["#c94a38", "#3b82f6", "#e09f3e", "#2a9d8f"];
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? "left" : "right";
      bystanders.push({
        side,
        x: side === "left" ? rand(10, 22) : rand(336, 348),
        y: i * 68 + rand(0, 24),
        shirt: pick(shirts),
        awning: pick(awnings),
        phase: rand(0, Math.PI * 2),
        prop: i % 3 === 0 ? "stall" : i % 3 === 1 ? "tree" : "lamp"
      });
    }
  }
  initBystanders();

  function getLocationForScore(sc) {
    for (let i = LOCATIONS.length - 1; i >= 0; i--) {
      if (sc >= LOCATIONS[i].min) return i;
    }
    return 0;
  }

  function updateHud() {
    $("score").textContent = String(Math.floor(score)).padStart(6, "0");
    $("deliveries").textContent = deliveries + " / 5";
    const tempEl = $("temp");
    tempEl.textContent = heat > 60 ? "HOT!" : heat > 25 ? "WARM" : "COLD!";
    tempEl.style.color = heat > 60 ? "#ffd45a" : heat > 25 ? "#ff9d58" : "#ff5c67";
  }

  function configureOverlay(mode) {
    const pauseActions = $("pauseActions");
    const contactRow = $("contactRow");
    const howtoBox = $("howtoBox");
    if (mode === "menu") {
      $("overlayMascot").textContent = "🛵";
      $("overlayEyebrow").textContent = "DELHI • PEAK TRAFFIC HOURS";
      $("overlayTitle").innerHTML = "THE GREAT<br><em>SAMOSA RUN</em>";
      $("overlayText").textContent = "Five hungry customers. One brave delivery rider. A whole city standing in your way.";
      $("startBtn").innerHTML = "START DELIVERY <span>➜</span>";
      howtoBox.classList.remove("hidden");
      pauseActions.classList.add("hidden");
      contactRow.classList.add("hidden");
    } else if (mode === "paused") {
      $("overlayMascot").textContent = "☕";
      $("overlayEyebrow").textContent = LOCATIONS[currentLocIndex].name;
      $("overlayTitle").innerHTML = "TAKE A<br><em>CHAI BREAK</em>";
      $("overlayText").textContent = "Traffic isn't going anywhere. Resume when you're ready.";
      $("startBtn").innerHTML = "RESUME RIDE <span>▶</span>";
      howtoBox.classList.add("hidden");
      pauseActions.classList.remove("hidden");
      contactRow.classList.remove("hidden");
    } else if (mode === "won" || mode === "lost") {
      $("overlayMascot").textContent = mode === "won" ? "🏆" : "💥";
      $("overlayEyebrow").textContent = `REACHED ${LOCATIONS[currentLocIndex].name}`;
      $("overlayTitle").innerHTML = mode === "won" ? "DELIVERY<br><em>DONE!</em>" : "OOPS!<br><em>SPILLED IT</em>";
      $("overlayText").textContent = mode === "won"
        ? "Five happy customers. Zero cold samosas. Delhi salutes you, legend!"
        : "Your samosas didn't make it. The streets of Delhi remain undefeated.";
      $("startBtn").innerHTML = "RIDE AGAIN <span>➜</span>";
      howtoBox.classList.add("hidden");
      pauseActions.classList.add("hidden");
      contactRow.classList.remove("hidden");
    }
  }

  function saveBestScore(finalScore) {
    best = Math.max(best, Math.floor(finalScore));
    localStorage.setItem("samosaBest", best);
    setCookie("samosaBest", best, 365);
    $("best").textContent = String(best).padStart(6, "0");
  }

  function start() {
    ensureAudio();
    clearToast();
    score = 0;
    deliveries = 0;
    heat = 100;
    boostMeter = 100;
    combo = 1;
    comboTimer = 0;
    elapsed = 0;
    nextDeliveryAt = 12;
    curSpeed = 240;
    roadOffset = 0;
    spawnTimer = 0.55;
    itemTimer = 1.5;
    eventTimer = 12;
    currentLocIndex = 0;
    obstacles = [];
    items = [];
    particles = [];
    popups = [];
    dropoff = null;
    queuedMove = 0;
    boostHeld = false;
    brakeHeld = false;
    player = {
      lane: 1,
      x: LANES[1],
      y: 522,
      vx: 0,
      tilt: 0,
      squash: 0,
      invuln: 0,
      mirchi: 0,
      vehicle: "scooter",
      vehicleDist: 0,
      slip: 0
    };
    initBystanders();
    state = "playing";
    $("overlay").classList.add("hidden");
    $("helpOverlay").classList.add("hidden");
    $("contactOverlay").classList.add("hidden");
    $("pauseBtn").textContent = "Ⅱ";
    updateHud();
    if (Audio) {
      Audio.setState(true, false);
      Audio.playRandomDelhiHorn(0.65);
    }
  }

  function finish(won = false) {
    state = "over";
    clearToast();
    boostHeld = false;
    brakeHeld = false;
    saveBestScore(score);

    fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: Math.floor(score), deliveries })
    }).catch(() => {});

    configureOverlay(won ? "won" : "lost");
    $("overlay").classList.remove("hidden");
    $("pauseBtn").textContent = "Ⅱ";
    if (Audio) {
      Audio.setState(false, false);
      Audio.playFinish(won);
    }
  }

  function pause() {
    if (state === "playing") {
      state = "paused";
      clearToast();
      boostHeld = false;
      brakeHeld = false;
      configureOverlay("paused");
      $("overlay").classList.remove("hidden");
      $("pauseBtn").textContent = "▶";
      if (Audio) Audio.setState(true, true);
    } else if (state === "paused") {
      state = "playing";
      $("overlay").classList.add("hidden");
      $("pauseBtn").textContent = "Ⅱ";
      if (Audio) Audio.setState(true, false);
    }
  }

  function move(dir) {
    if (state !== "playing") return;
    ensureAudio();
    const targetLane = clamp(player.lane + dir, 0, 2);
    if (targetLane === player.lane) {
      if (Math.abs(LANES[player.lane] - player.x) > 10) queuedMove = dir;
      return;
    }
    if (Math.abs(LANES[player.lane] - player.x) > 36) {
      queuedMove = dir;
      return;
    }
    player.lane = targetLane;
    player.squash = 0.28;
    player.tilt = dir * 0.34;
    spawnParticles(player.x, player.y + 18, "#c9bda8", 5, 45, 20, 75);
    if (Audio) Audio.playLaneSnap(dir);
  }

  // --- TOUCH + BUTTON CONTROLS ---
  function bindSteerButton(id, dir) {
    const btn = $(id);
    let repeatTimer = null;
    const stopRepeat = () => {
      btn.classList.remove("active");
      if (repeatTimer) {
        clearInterval(repeatTimer);
        repeatTimer = null;
      }
    };
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ensureAudio();
      btn.classList.add("active");
      move(dir);
      if (repeatTimer) clearInterval(repeatTimer);
      repeatTimer = setInterval(() => move(dir), 160);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      btn.addEventListener(ev, stopRepeat)
    );
  }
  bindSteerButton("leftBtn", -1);
  bindSteerButton("rightBtn", 1);

  const boostBtn = $("boostBtn");
  const setBoostUI = (on) => {
    boostHeld = on;
    boostBtn.classList.toggle("active", on);
  };
  boostBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ensureAudio();
    setBoostUI(true);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
    boostBtn.addEventListener(ev, () => setBoostUI(false))
  );

  let swipeStartX = null;
  let swipeMoved = false;
  canvas.addEventListener("pointerdown", (e) => {
    ensureAudio();
    swipeStartX = e.clientX;
    swipeMoved = false;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (swipeStartX === null || state !== "playing") return;
    const dx = e.clientX - swipeStartX;
    if (Math.abs(dx) >= 22) {
      move(dx > 0 ? 1 : -1);
      swipeStartX = e.clientX;
      swipeMoved = true;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (swipeStartX !== null && !swipeMoved && state === "playing") {
      const rect = canvas.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < 0.38) move(-1);
      else if (relX > 0.62) move(1);
    }
    swipeStartX = null;
    swipeMoved = false;
  });
  canvas.addEventListener("pointercancel", () => {
    swipeStartX = null;
    swipeMoved = false;
  });

  // --- KEYBOARD CONTROLS ---
  window.addEventListener("keydown", (e) => {
    const code = e.code;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) {
      e.preventDefault();
    }
    if (keysDown.has(code)) return;
    keysDown.add(code);
    ensureAudio();

    if (code === "ArrowLeft" || code === "KeyA") move(-1);
    else if (code === "ArrowRight" || code === "KeyD") move(1);
    else if (code === "ArrowUp" || code === "KeyW" || code === "Space") {
      if (state === "menu" || state === "over") start();
      else if (state === "playing") setBoostUI(true);
    } else if (code === "ArrowDown" || code === "KeyS") {
      brakeHeld = true;
    } else if (code === "KeyP" || code === "Escape") {
      if (!$("helpOverlay").classList.contains("hidden")) $("helpOverlay").classList.add("hidden");
      else if (!$("contactOverlay").classList.contains("hidden")) $("contactOverlay").classList.add("hidden");
      else if (state === "playing" || state === "paused") pause();
    } else if (code === "Enter") {
      if (state === "menu" || state === "over") start();
      else if (state === "paused") pause();
    } else if (code === "KeyM") {
      toggleSfx();
    }
  });

  window.addEventListener("keyup", (e) => {
    const code = e.code;
    keysDown.delete(code);
    if (code === "ArrowUp" || code === "KeyW" || code === "Space") {
      if (!keysDown.has("ArrowUp") && !keysDown.has("KeyW") && !keysDown.has("Space")) {
        setBoostUI(false);
      }
    }
    if (code === "ArrowDown" || code === "KeyS") {
      if (!keysDown.has("ArrowDown") && !keysDown.has("KeyS")) {
        brakeHeld = false;
      }
    }
  });

  // --- UI & MODAL HANDLERS ---
  $("startBtn").addEventListener("click", () => (state === "paused" ? pause() : start()));
  $("pauseBtn").addEventListener("click", pause);
  $("restartBtn").addEventListener("click", start);

  function openHelp() {
    clearToast();
    if (state === "playing") pause();
    renderHelpIcons();
    $("helpOverlay").classList.remove("hidden");
  }
  $("helpBtn").addEventListener("click", openHelp);
  $("pauseHelpBtn").addEventListener("click", openHelp);
  $("closeHelpBtn").addEventListener("click", () => $("helpOverlay").classList.add("hidden"));

  $("contactBtn").addEventListener("click", () => {
    clearToast();
    $("contactOverlay").classList.remove("hidden");
  });
  $("closeContactBtn").addEventListener("click", () => $("contactOverlay").classList.add("hidden"));
  $("copyContactBtn").addEventListener("click", () => {
    const info = `The Great Samosa Run (Delhi Edition) | Dev: dev@samosarun.local | Best: ${best}`;
    if (navigator.clipboard) navigator.clipboard.writeText(info).catch(() => {});
    $("copyContactBtn").textContent = "✓ COPIED!";
    setTimeout(() => { $("copyContactBtn").textContent = "📋 COPY INFO"; }, 1200);
  });

  function toggleMusic() {
    ensureAudio();
    musicOn = !musicOn;
    $("musicBtn").innerHTML = musicOn ? "🎵 <span>ON</span>" : "🎵 <span>OFF</span>";
    $("musicBtn").classList.toggle("muted", !musicOn);
    if (Audio) Audio.setMusic(musicOn);
  }
  function toggleSfx() {
    ensureAudio();
    sfxOn = !sfxOn;
    $("soundBtn").innerHTML = sfxOn ? "🔊 <span>ON</span>" : "🔊 <span>OFF</span>";
    $("soundBtn").classList.toggle("muted", !sfxOn);
    if (Audio) Audio.setSfx(sfxOn);
  }
  $("musicBtn").addEventListener("click", toggleMusic);
  $("soundBtn").addEventListener("click", toggleSfx);

  // --- SPAWNERS & EVENTS ---
  function spawnObstacle(forcedLane = null, forcedType = null) {
    const type = forcedType || pick(["auto", "auto", "cow", "pothole", "bus", "rickshaw", "barricade", "puddle"]);
    const lane = forcedLane !== null ? forcedLane : Math.floor(rand(0, 3));
    if (obstacles.some((o) => o.lane === lane && o.y < 80)) return;

    const specs = {
      bus: { w: 54, h: 74, speedFactor: 0.68 },
      auto: { w: 42, h: 44, speedFactor: 0.78 },
      rickshaw: { w: 36, h: 42, speedFactor: 0.84 },
      cow: { w: 42, h: 36, speedFactor: 0.96 },
      pothole: { w: 40, h: 22, speedFactor: 1.0 },
      barricade: { w: 44, h: 22, speedFactor: 1.0 },
      puddle: { w: 48, h: 28, speedFactor: 1.0 },
      baraat: { w: 50, h: 46, speedFactor: 0.9 }
    };
    const s = specs[type];
    obstacles.push({
      type,
      lane,
      x: LANES[lane],
      y: -75,
      w: s.w,
      h: s.h,
      speedFactor: s.speedFactor,
      passed: false,
      nearMissed: false,
      honked: false,
      swayPhase: rand(0, Math.PI * 2)
    });
  }

  function triggerRandomEvent() {
    if (Math.random() < 0.6) {
      const openLane = Math.floor(rand(0, 3));
      toast("BARAAT AHEAD! FIND THE GAP!");
      for (let l = 0; l < 3; l++) {
        if (l !== openLane) spawnObstacle(l, "baraat");
      }
      if (Audio) Audio.playRandomDelhiHorn(0.9);
    } else {
      toast("WATERLOGGED ROAD AHEAD!");
      const l1 = Math.floor(rand(0, 3));
      spawnObstacle(l1, "puddle");
      spawnObstacle((l1 + 1) % 3, "puddle");
    }
  }

  function spawnItem() {
    const r = Math.random();
    let type = "samosa";
    let lane = Math.floor(rand(0, 3));
    if (r < 0.14 && player.vehicle === "scooter") {
      type = Math.random() < 0.5 ? "bike" : "car";
      lane = 1;
    } else if (r < 0.24) {
      type = "mirchi";
    } else if (r < 0.52) {
      type = "chai";
    }
    items.push({ type, x: LANES[lane], y: -30, r: 15, bob: rand(0, 6) });
  }

  function crash(o) {
    if (o.type === "puddle") {
      if (player.vehicle === "car" || player.mirchi > 0) return;
      player.slip = 0.65;
      heat = Math.max(0, heat - 12);
      score = Math.max(0, score - 35);
      shake = 0.18;
      toast("SOGGY SAMOSA! CUSTOMER MAD 😡");
      addPopup(player.x, player.y - 34, "-12 HEAT • -35", "#6ec6ff");
      spawnParticles(player.x, player.y + 12, "#6ec6ff", 12, 85, -70, 60);
      if (Audio) Audio.playCrash();
      o.y = 900;
      if (heat <= 0) finish(false);
      return;
    }
    if (player.mirchi > 0 || player.vehicle === "car") {
      score += 45;
      shake = 0.16;
      addPopup(o.x, o.y, player.vehicle === "car" ? "CAR SMASH! +45" : "SMASH! +45", "#7ee0b5");
      spawnParticles(o.x, o.y, "#ffd45a", 12, 120, -140, 60);
      o.y = 900;
      if (Audio) Audio.playNearMiss(combo);
      return;
    }
    if (player.invuln > 0) return;
    player.invuln = 1.4;
    heat = Math.max(0, heat - 26);
    combo = 1;
    comboTimer = 0;
    shake = 0.32;
    toast("SAMOSA ALERT!");
    addPopup(player.x, player.y - 34, "-26 HEAT!", "#ff5c67");
    spawnParticles(player.x, player.y, "#ffb64d", 14, 110, -150, 50);
    if (Audio) Audio.playCrash();
    if (heat <= 0) finish(false);
  }

  // --- UPDATE LOOP ---
  function update(dt) {
    if (state !== "playing") return;

    elapsed += dt;

    const scoreSpeedBonus = Math.min(310, score * 0.085);
    const baseSpeed = 240 + scoreSpeedBonus;

    const newLoc = getLocationForScore(score);
    if (newLoc !== currentLocIndex) {
      currentLocIndex = newLoc;
      toast(`ENTERING ${LOCATIONS[currentLocIndex].name}!`);
      addPopup(W / 2, 180, LOCATIONS[currentLocIndex].name, "#7ee0b5");
      if (Audio) Audio.playDeliver();
    }

    if (player.vehicle !== "scooter") {
      player.vehicleDist -= curSpeed * dt * 0.095;
      if (player.vehicleDist <= 0) {
        player.vehicle = "scooter";
        player.vehicleDist = 0;
        player.invuln = 1.1;
        toast("BACK ON SCOOTER!");
      }
    }

    const isMirchi = player.mirchi > 0;
    const isVehicleBoost = player.vehicle === "bike" || player.vehicle === "car";
    const isBoosting = (boostHeld && boostMeter > 2) || isMirchi || isVehicleBoost;
    const isBraking = brakeHeld && !isBoosting;

    if (isMirchi) {
      player.mirchi = Math.max(0, player.mirchi - dt);
    } else if (boostHeld && !isVehicleBoost) {
      boostMeter = Math.max(0, boostMeter - dt * 36);
      if (boostMeter <= 1) boostHeld = false;
    } else {
      boostMeter = Math.min(100, boostMeter + dt * 13);
    }

    const speedMult = player.vehicle === "bike" ? 1.55 : isBoosting ? 1.42 : isBraking ? 0.68 : 1.0;
    curSpeed += (baseSpeed * speedMult - curSpeed) * Math.min(1, dt * 12);

    if (Audio) Audio.updateEngine((curSpeed - 180) / 400, isBoosting);

    score += dt * (isBoosting ? 26 : 12) * (1 + (combo - 1) * 0.2);
    roadOffset = (roadOffset + curSpeed * dt) % 80;
    heat = Math.max(0, heat - dt * (isBoosting ? 0.65 : 1.05));

    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) combo = 1;
    }

    for (const b of bystanders) {
      b.y += curSpeed * dt;
      if (b.y > H + 48) {
        b.y = -48;
      }
    }

    if (deliveries < 5 && !dropoff && elapsed >= nextDeliveryAt) {
      dropoff = {
        y: -70,
        delivered: false,
        customer: pick(["🙋", "🙋‍♀️", "🧔", "👵"])
      };
    }
    if (dropoff) {
      dropoff.y += curSpeed * dt;
      if (!dropoff.delivered && dropoff.y >= player.y - 25) {
        dropoff.delivered = true;
        deliveries++;
        const kerbBonus = player.lane === 2 ? 50 : 0;
        const pts = 150 + kerbBonus;
        score += pts;
        heat = Math.min(100, heat + 14);
        nextDeliveryAt = elapsed + 12.5;
        toast(kerbBonus ? "CURBSIDE DELIVERY! +200" : "ORDER DELIVERED! +150");
        addPopup(player.x, player.y - 36, `+${pts}`, "#7ee0b5");
        spawnParticles(310, dropoff.y, "#ffd45a", 14, 80, -140, 20);
        if (Audio) Audio.playDeliver();
        if (deliveries >= 5) {
          finish(true);
          return;
        }
      }
      if (dropoff.y > H + 80) dropoff = null;
    }

    const targetX = LANES[player.lane];
    const diffX = targetX - player.x;
    player.vx += (diffX * 285 - player.vx * 24) * dt;
    player.x += player.vx * dt;

    if (player.slip > 0) {
      player.slip -= dt;
      player.tilt = Math.sin(elapsed * 26) * 0.35;
    } else {
      const targetTilt = clamp(player.vx * 0.0014, -0.34, 0.34);
      player.tilt += (targetTilt - player.tilt) * Math.min(1, dt * 18);
    }

    if (Math.abs(diffX) < 3 && Math.abs(player.vx) < 18) {
      player.x = targetX;
      player.vx = 0;
      if (queuedMove !== 0) {
        const nextDir = queuedMove;
        queuedMove = 0;
        move(nextDir);
      }
    }

    player.squash = Math.max(0, player.squash - dt * 2.4);
    const targetY = isBoosting ? 492 : isBraking ? 542 : 522;
    player.y += (targetY - player.y) * Math.min(1, dt * 10);
    player.invuln = Math.max(0, player.invuln - dt);

    if (isBoosting && Math.random() < 0.78) {
      particles.push({
        x: player.x + rand(-5, 5),
        y: player.y + 22,
        vx: rand(-18, 18),
        vy: rand(75, 145),
        size: rand(3, 6),
        life: 0.22,
        maxLife: 0.22,
        color: isMirchi ? "#7ee0b5" : player.vehicle === "bike" ? "#6ec6ff" : pick(["#ff793f", "#ffd45a"])
      });
    }

    spawnTimer -= dt * (isBoosting ? 1.25 : 1);
    if (spawnTimer <= 0) {
      spawnObstacle();
      if (score > 650 && Math.random() < 0.28) {
        spawnObstacle();
      }
      spawnTimer = Math.max(0.32, rand(0.92, 1.32) - score * 0.00022);
    }

    eventTimer -= dt;
    if (eventTimer <= 0) {
      triggerRandomEvent();
      eventTimer = rand(11, 17);
    }

    itemTimer -= dt;
    if (itemTimer <= 0) {
      spawnItem();
      itemTimer = rand(1.5, 2.5);
    }

    for (const o of obstacles) {
      o.y += curSpeed * o.speedFactor * dt;
      if (o.type === "rickshaw") {
        o.x = LANES[o.lane] + Math.sin(elapsed * 4 + o.swayPhase) * 4;
      }
      if (!o.honked && (o.type === "auto" || o.type === "bus") && o.lane === player.lane && o.y > player.y - 160 && o.y < player.y - 55) {
        o.honked = true;
        if (Audio && Math.random() < 0.7) Audio.playRandomDelhiHorn(0.85);
      }

      const riderHalfW = player.vehicle === "car" ? 16 : player.vehicle === "bike" ? 9 : 11;
      const hitW = o.w * 0.5 + riderHalfW;
      const hitH = o.h * 0.5 + 15;
      if (Math.abs(o.y - player.y) < hitH && Math.abs(o.x - player.x) < hitW) {
        if (player.mirchi > 0 || player.vehicle === "car" || o.type === "puddle") {
          crash(o);
        } else {
          o.y = 900;
          crash(o);
        }
      } else if (!o.nearMissed && o.type !== "puddle" && o.y > player.y - 12 && o.y < player.y + 34 && Math.abs(o.x - player.x) < hitW + 28) {
        o.nearMissed = true;
        combo = Math.min(8, combo + 1);
        comboTimer = 3.2;
        const pts = 25 * combo;
        score += pts;
        boostMeter = Math.min(100, boostMeter + 12);
        addPopup(player.x, player.y - 34, `CLOSE CALL x${combo}! +${pts}`, "#ffd45a");
        if (Audio) Audio.playNearMiss(combo);
      }

      if (!o.passed && o.y > player.y + 38) {
        o.passed = true;
        score += 12;
      }
    }
    obstacles = obstacles.filter((o) => o.y < H + 95);

    for (const it of items) {
      it.y += curSpeed * dt;
      it.bob += dt * 6;
      if (Math.abs(player.x - it.x) < 28 && Math.abs(player.y - it.y) < 32) {
        it.y = 900;
        if (it.type === "chai") {
          heat = Math.min(100, heat + 30);
          boostMeter = Math.min(100, boostMeter + 35);
          score += 50;
          toast("CHAI POWER! +50");
          addPopup(player.x, player.y - 32, "+30 HEAT & BOOST", "#ffd45a");
        } else if (it.type === "mirchi") {
          player.mirchi = 4.2;
          score += 80;
          toast("MIRCHI TURBO!");
          addPopup(player.x, player.y - 34, "TURBO SMASH!", "#7ee0b5");
        } else if (it.type === "bike") {
          player.vehicle = "bike";
          player.vehicleDist = 100;
          score += 60;
          toast("100m SPORTS BIKE!");
          addPopup(player.x, player.y - 34, "100m SPEED!", "#6ec6ff");
        } else if (it.type === "car") {
          player.vehicle = "car";
          player.vehicleDist = 100;
          score += 60;
          toast("100m TURBO CAR!");
          addPopup(player.x, player.y - 34, "100m ARMOR!", "#7ee0b5");
        } else {
          const pts = 30 * combo;
          score += pts;
          addPopup(player.x, player.y - 30, `SAMOSA +${pts}`, "#ffb64d");
        }
        spawnParticles(player.x, player.y, "#fff0c9", 8, 75, -95, 30);
        if (Audio) Audio.playPickup(it.type);
      }
    }
    items = items.filter((i) => i.y < H + 35);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const pop of popups) {
      pop.y -= 42 * dt;
      pop.life -= dt;
    }
    popups = popups.filter((p) => p.life > 0);

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) $("toast").classList.remove("show");
    }
    if (shake > 0) shake -= dt;
    if (heat <= 0) finish(false);

    updateHud();
  }

  // --- DETAILED GRAPHICS & SPRITE HELPERS ---
  function drawRoad() {
    const loc = LOCATIONS[currentLocIndex];
    // Grass & paved sidewalks
    ctx.fillStyle = loc.grass;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#3c354c";
    ctx.fillRect(24, 0, 12, H);
    ctx.fillRect(324, 0, 12, H);

    // Sidewalk paving stone lines
    ctx.fillStyle = "#2b2538";
    for (let y = -40 + roadOffset; y < H; y += 20) {
      ctx.fillRect(24, y, 12, 2);
      ctx.fillRect(324, y, 12, 2);
    }

    // Road base & asphalt
    ctx.fillStyle = "#2b283a";
    ctx.fillRect(36, 0, 288, H);
    ctx.fillStyle = loc.road;
    ctx.fillRect(42, 0, 276, H);

    // Subtle asphalt texture
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let y = -40 + roadOffset; y < H; y += 40) {
      ctx.fillRect(70, y, 4, 4);
      ctx.fillRect(160, y + 12, 3, 3);
      ctx.fillRect(284, y + 22, 4, 4);
    }

    // Kerb stripes
    ctx.fillStyle = loc.kerb;
    ctx.fillRect(35, 0, 5, H);
    ctx.fillRect(320, 0, 5, H);

    // Dashed lane dividers
    ctx.fillStyle = "#ded4be";
    for (let y = -80 + roadOffset; y < H; y += 80) {
      ctx.fillRect(139, y, 4, 38);
      ctx.fillRect(217, y, 4, 38);
    }

    // Surroundings: Stalls, Trees, Streetlamps & Bystanders
    for (const b of bystanders) {
      const bob = Math.sin(elapsed * 6 + b.phase) * 2;
      if (b.prop === "stall") {
        const sx = b.side === "left" ? 1 : 335;
        ctx.fillStyle = "#4b362b";
        ctx.fillRect(sx, b.y - 16, 24, 30);
        ctx.fillStyle = b.awning;
        ctx.fillRect(sx, b.y - 18, 24, 8);
        ctx.fillStyle = "#fff0c9";
        ctx.fillRect(sx + 2, b.y - 18, 5, 8);
        ctx.fillRect(sx + 13, b.y - 18, 5, 8);
      } else if (b.prop === "tree") {
        const tx = b.side === "left" ? 12 : 348;
        ctx.fillStyle = "rgba(10,8,16,0.35)";
        ctx.beginPath();
        ctx.arc(tx + 2, b.y + 4, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2b593c";
        ctx.beginPath();
        ctx.arc(tx, b.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#53915a";
        ctx.beginPath();
        ctx.arc(tx - 2, b.y - 3, 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Streetlamp with warm glow pool on road
        const lx = b.side === "left" ? 30 : 330;
        const glowX = b.side === "left" ? 56 : 304;
        ctx.fillStyle = "rgba(255, 224, 130, 0.08)";
        ctx.beginPath();
        ctx.arc(glowX, b.y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#7a708c";
        ctx.fillRect(lx - 2, b.y - 3, 4, 6);
        ctx.fillStyle = "#ffe58f";
        ctx.fillRect(b.side === "left" ? lx : lx - 6, b.y - 2, 6, 4);
      }

      // Bystander person
      ctx.fillStyle = "#151322";
      ctx.fillRect(b.x - 4, b.y + 4, 8, 5);
      ctx.fillStyle = b.shirt;
      ctx.fillRect(b.x - 4, b.y - 4 + bob * 0.4, 8, 9);
      ctx.fillStyle = "#f0b984";
      ctx.fillRect(b.x - 3, b.y - 10 + bob * 0.4, 6, 6);
      ctx.fillStyle = "#201b2e";
      ctx.fillRect(b.x - 3, b.y - 11 + bob * 0.4, 6, 2);
      ctx.fillStyle = "#f0b984";
      ctx.fillRect(b.side === "left" ? b.x + 4 : b.x - 6, b.y - 6 + bob, 3, 4);
    }

    if (boostHeld || player.mirchi > 0 || player.vehicle !== "scooter") {
      ctx.strokeStyle = "rgba(255, 240, 201, 0.28)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const lx = i < 3 ? 46 + i * 10 : 284 + (i - 3) * 10;
        const ly = ((elapsed * 900 + i * 117) % (H + 80)) - 60;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx, ly + 42);
        ctx.stroke();
      }
    }
  }

  function drawDropoff() {
    if (!dropoff) return;
    const y = dropoff.y;
    ctx.fillStyle = dropoff.delivered ? "#7ee0b5" : "#ffd45a";
    ctx.fillRect(298, y - 34, 24, 68);
    ctx.fillStyle = "#171426";
    ctx.fillRect(302, y - 28, 16, 56);
    ctx.font = "22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(dropoff.customer, 338, y + 8);
    ctx.fillStyle = "#fff0c9";
    ctx.font = "bold 8px monospace";
    ctx.fillText(dropoff.delivered ? "✓" : "DROP", 310, y + 4);
  }

  function drawCarSprite(c, x, y) {
    c.save();
    c.translate(x, y);
    // Shadow + 4 tires
    c.fillStyle = "rgba(12,10,20,0.5)";
    c.fillRect(-19, -27, 38, 56);
    c.fillStyle = "#151322";
    c.fillRect(-19, -20, 4, 10);
    c.fillRect(15, -20, 4, 10);
    c.fillRect(-19, 10, 4, 10);
    c.fillRect(15, 10, 4, 10);
    // Body + racing stripe
    c.fillStyle = "#3b9ae1";
    c.fillRect(-16, -26, 32, 52);
    c.fillStyle = "#70c1ff";
    c.fillRect(-13, -24, 26, 48);
    c.fillStyle = "#fff0c9";
    c.fillRect(-2, -26, 4, 52);
    // Windshield & rear glass
    c.fillStyle = "#1f1a33";
    c.fillRect(-12, -14, 24, 11);
    c.fillRect(-12, 8, 24, 8);
    c.fillStyle = "#9ad8ff";
    c.fillRect(-10, -13, 8, 3);
    // Side mirrors
    c.fillStyle = "#2b7bb8";
    c.fillRect(-19, -12, 3, 5);
    c.fillRect(16, -12, 3, 5);
    // Headlights & taillights
    c.fillStyle = "#fff5b8";
    c.fillRect(-14, -26, 6, 4);
    c.fillRect(8, -26, 6, 4);
    c.fillStyle = "#ff4d5a";
    c.fillRect(-14, 22, 7, 4);
    c.fillRect(7, 22, 7, 4);
    c.restore();
  }

  function drawBikeSprite(c, x, y) {
    c.save();
    c.translate(x, y);
    c.fillStyle = "rgba(12,10,20,0.45)";
    c.fillRect(-11, -26, 22, 52);
    // Tires
    c.fillStyle = "#151322";
    c.fillRect(-3, -27, 6, 12);
    c.fillRect(-4, 14, 8, 12);
    // Fairing
    c.fillStyle = "#e63946";
    c.fillRect(-9, -20, 18, 36);
    c.fillStyle = "#ffd45a";
    c.fillRect(-4, -18, 8, 12);
    // Rider + helmet
    c.fillStyle = "#231d36";
    c.fillRect(-7, -10, 14, 14);
    c.fillStyle = "#6ec6ff";
    c.fillRect(-5, -8, 10, 4);
    // Handlebars
    c.fillStyle = "#d5d5d5";
    c.fillRect(-13, -12, 26, 3);
    c.restore();
  }

  function drawScooterSprite(c, x, y, braking = false) {
    c.save();
    c.translate(x, y);
    c.fillStyle = "rgba(15, 12, 24, 0.48)";
    c.fillRect(-16, -24, 32, 50);
    c.fillStyle = "#151322";
    c.fillRect(-17, 12, 34, 9);
    c.fillStyle = "#d5d5d5";
    c.fillRect(-14, 14, 8, 5);
    c.fillRect(7, 14, 8, 5);
    c.fillStyle = "#ff793f";
    c.fillRect(-12, -15, 24, 28);
    c.fillStyle = "#ffd45a";
    c.fillRect(-9, -20, 18, 9);
    c.fillStyle = "#f3c18d";
    c.fillRect(-8, -31, 16, 12);
    c.fillStyle = "#282139";
    c.fillRect(-10, -34, 20, 6);
    c.fillStyle = "#fff0c9";
    c.fillRect(-6, -9, 12, 7);
    c.fillStyle = "#6bd1ae";
    c.fillRect(-18, -3, 6, 7);
    c.fillRect(12, -3, 6, 7);
    c.fillStyle = braking ? "#ff3b4e" : "#ff6b6b";
    c.fillRect(-5, 19, 10, 4);
    c.restore();
  }

  function drawPlayer(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.tilt);
    const sx = 1 + player.squash * 0.35;
    const sy = 1 - player.squash * 0.2;
    ctx.scale(sx, sy);

    const grad = ctx.createLinearGradient(0, -24, 0, -115);
    grad.addColorStop(0, "rgba(255, 238, 168, 0.34)");
    grad.addColorStop(1, "rgba(255, 238, 168, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-8, -24);
    ctx.lineTo(8, -24);
    ctx.lineTo(26, -115);
    ctx.lineTo(-26, -115);
    ctx.closePath();
    ctx.fill();

    if (player.mirchi > 0) {
      ctx.strokeStyle = "#7ee0b5";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -4, 30, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (player.vehicle === "car") drawCarSprite(ctx, 0, 0);
    else if (player.vehicle === "bike") drawBikeSprite(ctx, 0, 0);
    else drawScooterSprite(ctx, 0, 0, brakeHeld);

    ctx.restore();
  }

  function drawObstacleOn(c, type, x, y) {
    c.save();
    c.translate(x, y);
    if (type === "cow") {
      // Detailed top-down spotted cow
      c.fillStyle = "rgba(15,12,24,0.35)";
      c.fillRect(-18, -14, 36, 30);
      // Legs
      c.fillStyle = "#d9cbb0";
      c.fillRect(-17, -14, 6, 8);
      c.fillRect(11, -14, 6, 8);
      c.fillRect(-17, 10, 6, 9);
      c.fillRect(11, 10, 6, 9);
      // Body
      c.fillStyle = "#f4ead5";
      c.fillRect(-18, -12, 36, 24);
      // Brown/black patches
      c.fillStyle = "#3b2c2a";
      c.fillRect(-13, -8, 11, 10);
      c.fillRect(4, -3, 10, 12);
      // Head + ears + snout + horns
      c.fillStyle = "#f4ead5";
      c.fillRect(-8, -21, 16, 12);
      c.fillStyle = "#d98f88";
      c.fillRect(-5, -23, 10, 5);
      c.fillStyle = "#ffd45a";
      c.fillRect(-13, -21, 5, 4);
      c.fillRect(8, -21, 5, 4);
      // Tail
      c.fillStyle = "#3b2c2a";
      c.fillRect(-1, 12, 3, 7);
    } else if (type === "auto") {
      // Classic Delhi Green-Yellow Auto-Rickshaw
      c.fillStyle = "rgba(15,12,24,0.45)";
      c.fillRect(-20, -21, 40, 44);
      // Wheels
      c.fillStyle = "#171426";
      c.fillRect(-3, -23, 6, 7);
      c.fillRect(-20, 10, 6, 10);
      c.fillRect(14, 10, 6, 10);
      // Yellow lower body + green canopy
      c.fillStyle = "#f6c94e";
      c.fillRect(-18, -17, 36, 36);
      c.fillStyle = "#2d8a68";
      c.fillRect(-16, -6, 32, 22);
      // Windshield
      c.fillStyle = "#a8e6cf";
      c.fillRect(-12, -14, 24, 7);
      // Headlight & taillights
      c.fillStyle = "#fff5b8";
      c.fillRect(-4, -19, 8, 4);
      c.fillStyle = "#ff4d5a";
      c.fillRect(-16, 16, 7, 4);
      c.fillRect(9, 16, 7, 4);
    } else if (type === "bus") {
      // Detailed Red DTC Bus
      c.fillStyle = "rgba(15,12,24,0.5)";
      c.fillRect(-26, -35, 52, 72);
      c.fillStyle = "#d6453a";
      c.fillRect(-24, -34, 48, 68);
      // Roof AC pods
      c.fillStyle = "#e8dfd5";
      c.fillRect(-14, -14, 28, 12);
      c.fillRect(-14, 6, 28, 12);
      // Front & rear windshields + LED board
      c.fillStyle = "#9ad8ff";
      c.fillRect(-20, -30, 40, 11);
      c.fillStyle = "#171426";
      c.fillRect(-14, -34, 28, 5);
      c.fillStyle = "#ffd45a";
      c.fillRect(-10, -33, 20, 3);
      // Headlights & taillights
      c.fillStyle = "#fff5b8";
      c.fillRect(-20, -35, 8, 4);
      c.fillRect(12, -35, 8, 4);
      c.fillStyle = "#ff4d5a";
      c.fillRect(-20, 30, 9, 4);
      c.fillRect(11, 30, 9, 4);
    } else if (type === "rickshaw") {
      c.fillStyle = "#243b55";
      c.fillRect(-16, -18, 32, 34);
      c.fillStyle = "#4f9da6";
      c.fillRect(-13, -14, 26, 18);
      c.fillStyle = "#ffd45a";
      c.fillRect(-4, 8, 8, 10);
    } else if (type === "barricade") {
      c.fillStyle = "#ff793f";
      c.fillRect(-21, -9, 42, 18);
      c.fillStyle = "#fff0c9";
      c.fillRect(-14, -6, 8, 12);
      c.fillRect(6, -6, 8, 12);
    } else if (type === "puddle") {
      c.fillStyle = "#296894";
      c.beginPath();
      c.ellipse(0, 0, 23, 13, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#4da6db";
      c.beginPath();
      c.ellipse(-3, -2, 16, 8, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#9ce6ff";
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(-5, -3, 8, 4, 0, 0, Math.PI);
      c.stroke();
    } else if (type === "baraat") {
      c.fillStyle = "#ff6b9d";
      c.fillRect(-22, -16, 44, 32);
      c.fillStyle = "#ffd45a";
      c.fillRect(-18, -12, 12, 12);
      c.fillRect(6, -12, 12, 12);
      c.font = "18px sans-serif";
      c.textAlign = "center";
      c.fillText("🥁", 0, 10);
    } else {
      c.fillStyle = "#171426";
      c.fillRect(-20, -10, 40, 20);
      c.fillStyle = "#777184";
      c.fillRect(-13, -4, 26, 8);
    }
    c.restore();
  }

  function drawItemOn(c, type, x, y) {
    const bgMap = {
      chai: "#d18b4b",
      mirchi: "#42a876",
      bike: "#3b82f6",
      car: "#10b981",
      samosa: "#e6a33d"
    };
    c.fillStyle = bgMap[type] || "#e6a33d";
    c.beginPath();
    c.arc(x, y, 14, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#fff0c9";
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = "#fff0c9";
    c.font = "14px sans-serif";
    c.textAlign = "center";
    const icon = type === "chai" ? "☕" : type === "mirchi" ? "🌶️" : type === "bike" ? "🏍️" : type === "car" ? "🚗" : "▲";
    c.fillText(icon, x, y + 5);
  }

  function renderHelpIcons() {
    document.querySelectorAll(".legend-icon").forEach((el) => {
      const iconType = el.dataset.icon;
      const ic = el.getContext("2d");
      ic.clearRect(0, 0, 32, 32);
      ic.save();
      if (["chai", "samosa", "mirchi", "bike", "car"].includes(iconType)) {
        drawItemOn(ic, iconType, 16, 16);
      } else {
        ic.translate(16, 16);
        const sc = iconType === "bus" ? 0.38 : 0.52;
        ic.scale(sc, sc);
        drawObstacleOn(ic, iconType, 0, 0);
      }
      ic.restore();
    });
  }

  function drawLocationMapAndBars() {
    const loc = LOCATIONS[currentLocIndex];
    ctx.fillStyle = "#171426";
    ctx.fillRect(0, 0, W, 38);
    ctx.fillStyle = loc.kerb;
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${loc.name} (${Math.floor(score)}m)`, W / 2, 14);

    const mapX = 24;
    const mapW = W - 48;
    ctx.fillStyle = "#2d2542";
    ctx.fillRect(mapX, 24, mapW, 4);
    const prog = clamp(score / 3600, 0, 1);
    ctx.fillStyle = "#ffd45a";
    ctx.fillRect(mapX, 24, mapW * prog, 4);

    LOCATIONS.forEach((l, i) => {
      const lx = mapX + (i / (LOCATIONS.length - 1)) * mapW;
      ctx.fillStyle = i <= currentLocIndex ? "#7ee0b5" : "#665578";
      ctx.beginPath();
      ctx.arc(lx, 26, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = i === currentLocIndex ? "#fff0c9" : "#9c8ba8";
      ctx.font = "7px monospace";
      ctx.fillText(l.short, lx, 36);
    });

    if (state === "playing" || state === "paused") {
      ctx.fillStyle = "rgba(23, 20, 38, 0.85)";
      ctx.fillRect(10, H - 18, 158, 10);
      ctx.fillRect(192, H - 18, 158, 10);

      ctx.fillStyle = heat > 60 ? "#ffd45a" : heat > 25 ? "#ff9d58" : "#ff5c67";
      ctx.fillRect(12, H - 16, Math.max(0, (heat / 100) * 154), 6);

      if (player.vehicle !== "scooter") {
        ctx.fillStyle = "#6ec6ff";
        ctx.fillRect(194, H - 16, Math.max(0, (player.vehicleDist / 100) * 154), 6);
      } else {
        ctx.fillStyle = player.mirchi > 0 ? "#7ee0b5" : "#ff793f";
        ctx.fillRect(194, H - 16, Math.max(0, (boostMeter / 100) * 154), 6);
      }

      ctx.fillStyle = "#fff0c9";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("HEAT", 12, H - 22);
      ctx.textAlign = "right";
      const rightLabel = player.vehicle !== "scooter"
        ? `${player.vehicle.toUpperCase()} ${Math.ceil(player.vehicleDist)}m`
        : player.mirchi > 0 ? "MIRCHI!" : "BOOST";
      ctx.fillText(rightLabel, 348, H - 22);
    }
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(rand(-4, 4), rand(-4, 4));
    drawRoad();
    drawDropoff();
    for (const it of items) drawItemOn(ctx, it.type, it.x, it.y + Math.sin(it.bob) * 3);
    for (const o of obstacles) drawObstacleOn(ctx, o.type, o.x, o.y);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (state !== "menu" && !(player.invuln > 0 && Math.floor(performance.now() / 80) % 2)) {
      drawPlayer(player.x, player.y);
    }

    for (const pop of popups) {
      ctx.globalAlpha = Math.max(0, pop.life / pop.maxLife);
      ctx.fillStyle = pop.color;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(pop.text, pop.x, pop.y);
    }
    ctx.globalAlpha = 1;

    drawLocationMapAndBars();
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.04, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  configureOverlay("menu");
  requestAnimationFrame(loop);
})();

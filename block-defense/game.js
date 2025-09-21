(() => {
  const GRID_COLS = 15;
  const GRID_ROWS = 10;
  const TILE_SIZE = 64;
  const BOARD_WIDTH = GRID_COLS * TILE_SIZE;
  const BOARD_HEIGHT = GRID_ROWS * TILE_SIZE;
  const BASE_LIFE = 3;
  const BASE_GOLD = 120;
  const ENEMY_RADIUS = 18;
  const BULLET_SPEED = 420;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const hudLife = document.getElementById('life');
  const hudGold = document.getElementById('gold');
  const hudWave = document.getElementById('wave');
  const messageEl = document.getElementById('message');
  const towerInfoEl = document.getElementById('tower-info');
  const toolbarEl = document.getElementById('toolbar');
  const mapModal = document.getElementById('map-modal');
  const bestiaModal = document.getElementById('bestia-modal');
  const helpModal = document.getElementById('help-modal');
  const bestiaListEl = document.getElementById('bestia-list');

  const state = {
    mapKey: null,
    grid: [],
    waypoints: [],
    buildable: new Set(),
    towers: [],
    enemies: [],
    bullets: [],
    lives: BASE_LIFE,
    gold: BASE_GOLD,
    wave: 0,
    running: false,
    phase: 'idle', // idle | spawning | fighting | cooldown | ended
    spawnQueue: [],
    spawnTimer: 0,
    waveCooldown: 0,
    messageTimer: 0,
    message: '',
    selectedTowerType: 'arrow',
    selectedTowerId: null,
    dpr: window.devicePixelRatio || 1,
    lastTime: 0,
  };

  let entitySeq = 0;
  function nextId() {
    entitySeq = (entitySeq + 1) % 1_000_000;
    return `id-${Date.now()}-${entitySeq}`;
  }

  const easing = (base, growth, level) => base * Math.pow(growth, level - 1);

  const TOWER_TYPES = {
    arrow: {
      key: 'arrow',
      name: '箭塔',
      description: '稳定的单体输出，适合对付多数敌人。',
      cost: 60,
      color: '#64d5ff',
      bulletColor: '#9fe8ff',
      baseDamage: 24,
      damageGrowth: 1.35,
      baseRange: 180,
      rangeGrowth: 1.08,
      baseFireRate: 1.1,
      fireRateGrowth: 1.08,
      basePierce: 1,
      splashRadius: 0,
      slowFactor: 1,
      slowDuration: 0,
    },
    frost: {
      key: 'frost',
      name: '霜塔',
      description: '造成轻微伤害并显著减速，拖延敌人脚步。',
      cost: 75,
      color: '#7c9cff',
      bulletColor: '#c2d4ff',
      baseDamage: 12,
      damageGrowth: 1.25,
      baseRange: 200,
      rangeGrowth: 1.12,
      baseFireRate: 0.9,
      fireRateGrowth: 1.05,
      basePierce: 1,
      splashRadius: 60,
      slowFactor: 0.55,
      slowDuration: 2.2,
    },
    blast: {
      key: 'blast',
      name: '爆破塔',
      description: '发射高伤害炸弹，对范围内目标造成溅射。',
      cost: 90,
      color: '#ff9f43',
      bulletColor: '#ffcf78',
      baseDamage: 32,
      damageGrowth: 1.32,
      baseRange: 170,
      rangeGrowth: 1.07,
      baseFireRate: 0.75,
      fireRateGrowth: 1.05,
      basePierce: 1,
      splashRadius: 96,
      slowFactor: 1,
      slowDuration: 0,
    },
  };

  const ENEMY_TYPES = {
    scout: {
      key: 'scout',
      name: '斥候',
      color: '#8bf7a8',
      baseSpeed: 82,
      baseHp: 85,
      reward: 8,
      toughness: 1,
      description: '速度较快的轻装单位，成群冲锋。',
    },
    brute: {
      key: 'brute',
      name: '重装',
      color: '#ff6b6b',
      baseSpeed: 48,
      baseHp: 160,
      reward: 14,
      toughness: 1.5,
      description: '护甲厚实但移动缓慢，需要持续输出。',
    },
    runner: {
      key: 'runner',
      name: '疾风',
      color: '#ffd166',
      baseSpeed: 105,
      baseHp: 70,
      reward: 9,
      toughness: 0.9,
      description: '极快的速度，溅射和减速是克制关键。',
    },
    mystic: {
      key: 'mystic',
      name: '灵能者',
      color: '#8c7ae6',
      baseSpeed: 62,
      baseHp: 140,
      reward: 12,
      toughness: 1.2,
      description: '具有灵能护盾，血量成长更高。',
    },
    boss: {
      key: 'boss',
      name: '巨像 Boss',
      color: '#f78fb3',
      baseSpeed: 58,
      baseHp: 550,
      reward: 40,
      toughness: 2.6,
      description: '每波压轴出现的巨像，血量随波数大幅提升。',
    },
  };

  const MAP_BUILDERS = {
    z: {
      name: 'Z 形通道',
      build: buildZPath,
    },
    snake: {
      name: '蛇形通道',
      build: buildSnakePath,
    },
    spiral: {
      name: '螺旋通道',
      build: buildSpiralPath,
    },
    ring: {
      name: '环形通道',
      build: buildRingPath,
    },
  };

  function resizeCanvas() {
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    if (state.dpr !== dpr) {
      state.dpr = dpr;
    }
    canvas.width = BOARD_WIDTH * state.dpr;
    canvas.height = BOARD_HEIGHT * state.dpr;
    canvas.style.width = `${BOARD_WIDTH}px`;
    canvas.style.height = `${BOARD_HEIGHT}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function createGridBase() {
    const grid = Array.from({ length: GRID_ROWS }, (_, r) =>
      Array.from({ length: GRID_COLS }, (_, c) =>
        r === 0 || c === 0 || r === GRID_ROWS - 1 || c === GRID_COLS - 1 ? 2 : 1
      )
    );
    return grid;
  }

  function buildZPath() {
    const grid = createGridBase();
    const path = [];
    let row = 1;
    let col = 1;
    path.push([row, col]);
    while (col < GRID_COLS - 2) {
      col += 1;
      path.push([row, col]);
    }
    while (row < GRID_ROWS - 2 && col > 1) {
      row += 1;
      path.push([row, col]);
      col -= 1;
      path.push([row, col]);
    }
    while (col > 1) {
      col -= 1;
      path.push([row, col]);
    }
    while (row < GRID_ROWS - 2) {
      row += 1;
      path.push([row, col]);
    }
    finalizePath(grid, path);
    return grid;
  }

  function buildSnakePath() {
    const grid = createGridBase();
    const path = [];
    let direction = 1;
    for (let row = 1; row < GRID_ROWS - 1; row++) {
      if (direction === 1) {
        for (let col = 1; col < GRID_COLS - 1; col++) {
          path.push([row, col]);
        }
      } else {
        for (let col = GRID_COLS - 2; col >= 1; col--) {
          path.push([row, col]);
        }
      }
      direction *= -1;
    }
    finalizePath(grid, path);
    return grid;
  }

  function buildSpiralPath() {
    const grid = createGridBase();
    const path = [];
    let top = 1;
    let bottom = GRID_ROWS - 2;
    let left = 1;
    let right = GRID_COLS - 2;
    while (top <= bottom && left <= right) {
      for (let col = left; col <= right; col++) path.push([top, col]);
      top += 1;
      for (let row = top; row <= bottom; row++) path.push([row, right]);
      right -= 1;
      if (top > bottom) break;
      for (let col = right; col >= left; col--) path.push([bottom, col]);
      bottom -= 1;
      if (left > right) break;
      for (let row = bottom; row >= top; row--) path.push([row, left]);
      left += 1;
    }
    finalizePath(grid, path);
    return grid;
  }

  function buildRingPath() {
    const grid = createGridBase();
    const path = [];
    const innerTop = 2;
    const innerBottom = GRID_ROWS - 3;
    const innerLeft = 2;
    const innerRight = GRID_COLS - 3;
    for (let col = innerLeft; col <= innerRight; col++) path.push([innerTop, col]);
    for (let row = innerTop + 1; row <= innerBottom; row++) path.push([row, innerRight]);
    for (let col = innerRight - 1; col >= innerLeft; col--) path.push([innerBottom, col]);
    for (let row = innerBottom - 1; row > innerTop; row--) path.push([row, innerLeft]);
    // 向下延伸至出口，形成环形后向基地退却
    for (let row = innerTop + 2; row < GRID_ROWS - 1; row++) {
      path.push([row, innerLeft]);
    }
    finalizePath(grid, path);
    return grid;
  }

  function finalizePath(grid, path) {
    const waypoints = [];
    const buildable = new Set();
    for (let r = 1; r < GRID_ROWS - 1; r++) {
      for (let c = 1; c < GRID_COLS - 1; c++) {
        buildable.add(`${r},${c}`);
      }
    }
    path.forEach(([r, c]) => {
      grid[r][c] = 0;
      buildable.delete(`${r},${c}`);
    });
    path.forEach(([r, c], index) => {
      if (index === 0 || index === path.length - 1) {
        waypoints.push(tileCenter(r, c));
        return;
      }
      const [pr, pc] = path[index - 1];
      const [nr, nc] = path[index + 1];
      if ((pr === r && nr === r) || (pc === c && nc === c)) {
        return;
      }
      waypoints.push(tileCenter(r, c));
    });
    const first = path[0];
    const last = path[path.length - 1];
    state.waypoints = [tileCenter(first[0], first[1]), ...waypoints, tileCenter(last[0], last[1])];
    state.buildable = buildable;
  }

  function tileCenter(row, col) {
    return {
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  function resetState(mapKey) {
    state.mapKey = mapKey;
    state.grid = MAP_BUILDERS[mapKey].build();
    state.towers = [];
    state.enemies = [];
    state.bullets = [];
    state.lives = BASE_LIFE;
    state.gold = BASE_GOLD;
    state.wave = 0;
    state.running = true;
    state.phase = 'cooldown';
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.waveCooldown = 1.5;
    state.messageTimer = 0;
    state.message = '准备迎接第一波敌军！';
    state.selectedTowerId = null;
    state.lastTime = 0;
    updateHUD();
    updateTowerInfo();
    showMessage(state.message, 1.5);
  }

  function updateHUD() {
    hudLife.textContent = state.lives;
    hudGold.textContent = Math.max(0, Math.floor(state.gold));
    hudWave.textContent = state.wave;
  }

  function showMessage(text, duration = 2) {
    state.message = text;
    state.messageTimer = duration;
    if (text) {
      messageEl.textContent = text;
      messageEl.classList.remove('hidden');
    } else {
      messageEl.classList.add('hidden');
    }
  }

  function hideMessage() {
    state.message = '';
    state.messageTimer = 0;
    messageEl.classList.add('hidden');
  }

  function generateWave(wave) {
    const entries = [];
    const commonPool = [
      { type: 'scout', weight: 3 },
      { type: 'runner', weight: 2 + Math.min(3, Math.floor(wave / 3)) },
      { type: 'brute', weight: 1 + Math.floor(wave / 4) },
      { type: 'mystic', weight: 1 + Math.floor(wave / 5) },
    ];
    const totalWeight = commonPool.reduce((sum, entry) => sum + entry.weight, 0);
    const bodyCount = Math.min(12 + wave * 2, 60);
    for (let i = 0; i < bodyCount; i++) {
      const pick = Math.random() * totalWeight;
      let acc = 0;
      let chosen = commonPool[0].type;
      for (const entry of commonPool) {
        acc += entry.weight;
        if (pick <= acc) {
          chosen = entry.type;
          break;
        }
      }
      entries.push({ type: chosen, delay: 0.35 });
    }
    const bossDelay = Math.max(1.2, 2.5 - wave * 0.1);
    entries.push({ type: 'boss', delay: bossDelay });
    return entries;
  }

  function spawnEnemy(typeKey) {
    const def = ENEMY_TYPES[typeKey];
    const scale = Math.pow(1.18, Math.max(0, state.wave - 1)) * def.toughness;
    const hp = def.baseHp * scale;
    const enemy = {
      id: nextId(),
      type: typeKey,
      name: def.name,
      color: def.color,
      reward: def.reward,
      baseSpeed: def.baseSpeed,
      speed: def.baseSpeed,
      maxHp: hp,
      hp,
      slowFactor: 1,
      slowTimer: 0,
      waypointIndex: 0,
      progress: 0,
    };
    const start = state.waypoints[0];
    enemy.x = start.x;
    enemy.y = start.y;
    state.enemies.push(enemy);
  }

  function updateEnemies(dt) {
    const lastWaypointIndex = state.waypoints.length - 1;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const enemy = state.enemies[i];
      if (enemy.slowTimer > 0) {
        enemy.slowTimer -= dt;
        if (enemy.slowTimer <= 0) {
          enemy.slowFactor = 1;
        }
      }
      const speed = enemy.baseSpeed * enemy.slowFactor;
      const nextIndex = Math.min(enemy.waypointIndex + 1, lastWaypointIndex);
      const target = state.waypoints[nextIndex];
      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      if (dist < speed * dt) {
        enemy.x = target.x;
        enemy.y = target.y;
        enemy.waypointIndex = nextIndex;
        if (enemy.waypointIndex >= lastWaypointIndex) {
          state.enemies.splice(i, 1);
          state.lives -= 1;
          updateHUD();
          showMessage('敌人突破防线，损失 1 点生命！', 1.2);
          if (state.lives <= 0) {
            endGame(false);
          }
          continue;
        }
      } else {
        enemy.x += (dx / dist) * speed * dt;
        enemy.y += (dy / dist) * speed * dt;
      }
    }
  }

  function endGame(victory) {
    state.phase = 'ended';
    state.running = false;
    showMessage(victory ? '恭喜，你守住了防线！' : '防线被击破，重新再来！', 999);
  }

  function getTowerStats(tower) {
    const def = TOWER_TYPES[tower.type];
    const level = tower.level;
    return {
      damage: easing(def.baseDamage, def.damageGrowth, level),
      range: easing(def.baseRange, def.rangeGrowth, level),
      fireRate: easing(def.baseFireRate, def.fireRateGrowth, level),
      splashRadius: def.splashRadius * Math.pow(1.08, level - 1),
      slowFactor: def.slowFactor,
      slowDuration: easing(def.slowDuration || 0, 1.05, level),
    };
  }

  function updateTowers(dt) {
    for (const tower of state.towers) {
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;
      const stats = getTowerStats(tower);
      const target = findTarget(tower, stats.range);
      if (!target) continue;
      fireBullet(tower, target, stats);
      tower.cooldown = 1 / stats.fireRate;
    }
  }

  function findTarget(tower, range) {
    let chosen = null;
    let bestScore = -Infinity;
    for (const enemy of state.enemies) {
      const dist = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
      if (dist > range) continue;
      const score = enemy.waypointIndex + enemy.hp / enemy.maxHp;
      if (score > bestScore) {
        bestScore = score;
        chosen = enemy;
      }
    }
    return chosen;
  }

  function fireBullet(tower, target, stats) {
    const angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    const bullet = {
      x: tower.x,
      y: tower.y,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      damage: stats.damage,
      towerType: tower.type,
      color: TOWER_TYPES[tower.type].bulletColor,
      splashRadius: stats.splashRadius,
      slowFactor: stats.slowFactor,
      slowDuration: stats.slowDuration,
    };
    state.bullets.push(bullet);
  }

  function updateBullets(dt) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const bullet = state.bullets[i];
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.x < 0 || bullet.x > BOARD_WIDTH || bullet.y < 0 || bullet.y > BOARD_HEIGHT) {
        state.bullets.splice(i, 1);
        continue;
      }
      let hit = false;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const enemy = state.enemies[j];
        const dist = Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y);
        if (dist <= ENEMY_RADIUS) {
          const killed = applyDamage(enemy, bullet.damage);
          if (!killed && bullet.slowFactor < 1 && bullet.slowDuration > 0) {
            enemy.slowFactor = Math.min(enemy.slowFactor, bullet.slowFactor);
            enemy.slowTimer = Math.max(enemy.slowTimer, bullet.slowDuration);
          }
          if (bullet.splashRadius > 0) {
            applySplashDamage(bullet, enemy);
          }
          hit = true;
          break;
        }
      }
      if (hit) {
        state.bullets.splice(i, 1);
      }
    }
  }

  function applyDamage(enemy, damage) {
    enemy.hp -= damage;
    if (enemy.hp <= 0) {
      const goldGain = enemy.reward * (1 + state.wave * 0.05);
      state.gold += goldGain;
      updateHUD();
      const index = state.enemies.indexOf(enemy);
      if (index >= 0) {
        state.enemies.splice(index, 1);
      }
      return true;
    }
    return false;
  }

  function applySplashDamage(bullet, primary) {
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const enemy = state.enemies[i];
      if (enemy === primary) continue;
      const dist = Math.hypot(enemy.x - primary.x, enemy.y - primary.y);
      if (dist <= bullet.splashRadius) {
        const killed = applyDamage(enemy, bullet.damage * 0.6);
        if (!killed && bullet.slowFactor < 1 && bullet.slowDuration > 0) {
          enemy.slowFactor = Math.min(enemy.slowFactor, bullet.slowFactor);
          enemy.slowTimer = Math.max(enemy.slowTimer, bullet.slowDuration * 0.7);
        }
      }
    }
  }

  function updateWaveSystem(dt) {
    if (state.phase === 'ended') return;
    if (state.phase === 'cooldown') {
      state.waveCooldown -= dt;
      if (state.waveCooldown <= 0) {
        hideMessage();
        startWave();
      }
      return;
    }
    if (state.phase === 'spawning') {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
        const entry = state.spawnQueue.shift();
        spawnEnemy(entry.type);
        state.spawnTimer = entry.delay;
      }
      if (state.spawnQueue.length === 0) {
        state.phase = 'fighting';
      }
    }
    if (state.phase === 'fighting') {
      if (state.enemies.length === 0 && state.spawnQueue.length === 0 && state.bullets.length === 0) {
        beginRest();
      }
    }
  }

  function startWave() {
    if (!state.running) return;
    state.wave += 1;
    state.phase = 'spawning';
    state.spawnQueue = generateWave(state.wave);
    state.spawnTimer = 0.2;
    updateHUD();
    showMessage(`第 ${state.wave} 波来袭！`, 1.5);
  }

  function beginRest() {
    const reward = Math.round(18 + state.wave * 3);
    state.gold += reward;
    updateHUD();
    const restTime = Math.max(1, 4 - state.wave * 0.25);
    state.waveCooldown = restTime;
    state.phase = 'cooldown';
    showMessage(`成功守住第 ${state.wave} 波！奖励 ${reward} 金币`, Math.max(restTime, 1.5));
    if (state.wave >= 25) {
      endGame(true);
    }
  }

  function draw() {
    drawBoard();
    drawTowers();
    drawEnemies();
    drawBullets();
    drawTowerRange();
  }

  function drawBoard() {
    ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tile = state.grid[r]?.[c] ?? 2;
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;
        if (tile === 2) {
          ctx.fillStyle = '#131922';
        } else if (tile === 0) {
          const gradient = ctx.createLinearGradient(x, y, x + TILE_SIZE, y + TILE_SIZE);
          gradient.addColorStop(0, '#353c4a');
          gradient.addColorStop(1, '#1d232f');
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = '#2a3140';
        }
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        if (tile === 1) {
          ctx.strokeStyle = 'rgba(255, 203, 71, 0.25)';
          ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
      }
    }
  }

  function drawTowers() {
    for (const tower of state.towers) {
      ctx.fillStyle = TOWER_TYPES[tower.type].color;
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${tower.level}`, tower.x, tower.y + 5);
      if (state.selectedTowerId === tower.id) {
        ctx.strokeStyle = '#ffcb47';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  function drawEnemies() {
    for (const enemy of state.enemies) {
      ctx.fillStyle = enemy.color;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, ENEMY_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c1118';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, ENEMY_RADIUS * 0.5, 0, Math.PI * 2);
      ctx.fill();
      drawEnemyHpBar(enemy);
    }
  }

  function drawEnemyHpBar(enemy) {
    const width = 36;
    const height = 6;
    const x = enemy.x - width / 2;
    const y = enemy.y - ENEMY_RADIUS - 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#21d07a';
    ctx.fillRect(x, y, width * Math.max(enemy.hp / enemy.maxHp, 0), height);
  }

  function drawBullets() {
    for (const bullet of state.bullets) {
      ctx.fillStyle = bullet.color;
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTowerRange() {
    if (!state.selectedTowerId) return;
    const tower = state.towers.find((t) => t.id === state.selectedTowerId);
    if (!tower) return;
    const stats = getTowerStats(tower);
    ctx.strokeStyle = 'rgba(255, 203, 71, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
    ctx.stroke();
  }

  function placeTower(row, col) {
    const key = `${row},${col}`;
    if (!state.buildable.has(key)) return;
    const type = TOWER_TYPES[state.selectedTowerType];
    if (!type) return;
    if (state.gold < type.cost) {
      showMessage('金币不足，无法建造！', 1.2);
      return;
    }
    state.gold -= type.cost;
    const pos = tileCenter(row, col);
    const tower = {
      id: nextId(),
      type: type.key,
      level: 1,
      x: pos.x,
      y: pos.y,
      cooldown: 0,
      row,
      col,
    };
    state.towers.push(tower);
    state.buildable.delete(key);
    updateHUD();
    updateTowerInfo();
  }

  function upgradeTower(tower) {
    const cost = getUpgradeCost(tower);
    if (state.gold < cost) {
      showMessage('金币不足，暂时无法升级。', 1.4);
      return;
    }
    state.gold -= cost;
    tower.level += 1;
    updateHUD();
    updateTowerInfo(tower);
  }

  function getUpgradeCost(tower) {
    const base = TOWER_TYPES[tower.type].cost;
    return Math.floor(base * Math.pow(1.65, tower.level));
  }

  function selectTower(tower) {
    state.selectedTowerId = tower?.id ?? null;
    updateTowerInfo(tower);
  }

  function updateTowerInfo(tower) {
    if (!tower) {
      towerInfoEl.innerHTML = '点击己方塔查看详情';
      return;
    }
    const def = TOWER_TYPES[tower.type];
    const stats = getTowerStats(tower);
    const cost = getUpgradeCost(tower);
    towerInfoEl.innerHTML = `
      <header class="tower-header">
        <strong>${def.name} Lv.${tower.level}</strong>
        <span>${def.description}</span>
      </header>
      <ul class="tower-stats">
        <li>伤害：${stats.damage.toFixed(1)}</li>
        <li>射程：${stats.range.toFixed(0)}</li>
        <li>攻速：${stats.fireRate.toFixed(2)} / 秒</li>
        ${stats.splashRadius > 0 ? `<li>溅射半径：${stats.splashRadius.toFixed(0)}</li>` : ''}
        ${stats.slowFactor < 1 ? `<li>减速：${Math.round((1 - stats.slowFactor) * 100)}%（${stats.slowDuration.toFixed(1)} 秒）</li>` : ''}
      </ul>
      <button id="upgrade-button" class="ghost">升级（${cost} 金币）</button>
    `;
    const upgradeBtn = document.getElementById('upgrade-button');
    if (upgradeBtn) {
      upgradeBtn.disabled = state.gold < cost;
      upgradeBtn.addEventListener('click', () => upgradeTower(tower), { once: true });
    }
  }

  function handleCanvasClick(event) {
    if (!state.running || state.phase === 'ended') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / BOARD_WIDTH;
    const scaleY = canvas.height / BOARD_HEIGHT;
    const x = (event.clientX - rect.left) * (1 / scaleX);
    const y = (event.clientY - rect.top) * (1 / scaleY);
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const tower = state.towers.find((t) => t.row === row && t.col === col);
    if (tower) {
      selectTower(tower);
      return;
    }
    selectTower(null);
    placeTower(row, col);
  }

  function setupToolbar() {
    toolbarEl.addEventListener('click', (event) => {
      const button = event.target.closest('.tower-button');
      if (!button) return;
      const towerKey = button.dataset.tower;
      if (!TOWER_TYPES[towerKey]) return;
      state.selectedTowerType = towerKey;
      document.querySelectorAll('.tower-button').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
    });
  }

  function setupModals() {
    document.getElementById('bestia-button').addEventListener('click', () => {
      bestiaModal.classList.remove('hidden');
    });
    document.getElementById('help-button').addEventListener('click', () => {
      helpModal.classList.remove('hidden');
    });
    document.getElementById('restart-button').addEventListener('click', () => restart());
    document.querySelectorAll('.close').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const target = event.target.dataset.close;
        document.getElementById(target).classList.add('hidden');
      });
    });
    document.querySelectorAll('.map-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.map;
        mapModal.classList.add('hidden');
        resetState(key);
      });
    });
  }

  function populateBestiary() {
    const fragment = document.createDocumentFragment();
    Object.values(ENEMY_TYPES).forEach((def) => {
      const card = document.createElement('div');
      card.className = 'bestia-card';
      card.innerHTML = `
        <strong style="color:${def.color}">${def.name}</strong>
        <span>${def.description}</span>
        <span>基础生命：${def.baseHp}</span>
        <span>基础速度：${def.baseSpeed}</span>
        <span>奖励金币：${def.reward}</span>
      `;
      fragment.appendChild(card);
    });
    bestiaListEl.appendChild(fragment);
  }

  function restart() {
    if (!state.mapKey) {
      mapModal.classList.remove('hidden');
      return;
    }
    resetState(state.mapKey);
  }

  function handleKeyboard(event) {
    if (event.key.toLowerCase() === 'r') {
      restart();
    }
  }

  function update(dt) {
    if (!state.running) return;
    if (state.messageTimer > 0) {
      state.messageTimer -= dt;
      if (state.messageTimer <= 0 && state.phase !== 'cooldown' && state.phase !== 'ended') {
        hideMessage();
      }
    }
    updateWaveSystem(dt);
    updateEnemies(dt);
    updateTowers(dt);
    updateBullets(dt);
  }

  function loop(timestamp) {
    if (!state.running && state.phase !== 'ended') {
      // 等待地图选择
      requestAnimationFrame(loop);
      return;
    }
    if (!state.lastTime) state.lastTime = timestamp;
    const delta = Math.min((timestamp - state.lastTime) / 1000, 0.05);
    state.lastTime = timestamp;
    update(delta);
    draw();
    requestAnimationFrame(loop);
  }

  function init() {
    resizeCanvas();
    setupToolbar();
    setupModals();
    populateBestiary();
    canvas.addEventListener('click', handleCanvasClick);
    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('resize', resizeCanvas);
    requestAnimationFrame(loop);
  }

  init();
})();

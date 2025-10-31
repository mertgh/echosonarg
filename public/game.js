const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let width = 0, height = 0, dpr = 1;
function resize() {
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  width = Math.floor(window.innerWidth);
  height = Math.floor(window.innerHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// Main menu handling
let gameStarted = false;
let soundEnabled = true;
let musicEnabled = true;
const bgMusic = document.getElementById('bg-music');

async function showMainMenu() {
  const menu = document.getElementById('main-menu');
  
  // try auto-login with saved credentials
  const savedCreds = localStorage.getItem('space-sonar-creds');
  if (savedCreds) {
    try {
      const { username, password } = JSON.parse(savedCreds);
      const user = await loginUser(username, password);
      
      // populate stats
      const statItems = document.querySelectorAll('#menu-stats .stat-item span');
      if (statItems[0]) statItems[0].textContent = user.totalScore || 0;
      if (statItems[1]) statItems[1].textContent = user.totalKills || 0;
      if (statItems[2]) statItems[2].textContent = user.bestStreak || 0;
      
      const usernameInput = document.getElementById('username-input');
      if (usernameInput) usernameInput.value = username;
      
      updateAccountStatus('✅ Hoş geldin, ' + username + '!', 'success');
    } catch (error) {
      updateAccountStatus('📝 Giriş yap veya yeni hesap oluştur', 'info');
    }
  } else {
    updateAccountStatus('📝 Giriş yap veya yeni hesap oluştur', 'info');
  }
  
  if (menu) menu.classList.remove('hidden');
}

function updateAccountStatus(message, type = 'info') {
  const status = document.getElementById('account-status');
  if (status) {
    status.textContent = message;
    status.className = `account-status ${type}`;
  }
}

function hideMainMenu() {
  const menu = document.getElementById('main-menu');
  if (menu) menu.classList.add('hidden');
}

window.showHelp = function() {
  alert('🎮 NASIL OYNANIR\n\n' +
        '🚀 HAREKET:\n' +
        'W - İleri git\n' +
        'A/D - Sağa/Sola dön\n\n' +
        '🔫 SALDIRI:\n' +
        'Space/Mouse - Ateş et\n' +
        'F - Sonar kullan\n' +
        'G - Torpido (unlock gerekli)\n' +
        'H - Füze (unlock gerekli)\n\n' +
        '💰 HEDEF:\n' +
        'Düşmanları öldür, credits kazan\n' +
        'Upgrade al, güçlen\n' +
        'TOP 10\'a gir!\n\n' +
        '⚠️ DİKKAT:\n' +
        'Öldüğünde tüm upgrades sıfırlanır!\n' +
        'Dikkatli oyna, hayatta kal!');
};

window.toggleSound = function() {
  soundEnabled = !soundEnabled;
  musicEnabled = !musicEnabled;
  
  const btn = document.querySelector('.menu-btn:nth-child(2)');
  if (btn) btn.textContent = soundEnabled ? '🔊 Ses: Açık' : '🔇 Ses: Kapalı';
  
  // toggle background music
  if (bgMusic) {
    if (musicEnabled) {
      bgMusic.volume = 0.3;
      bgMusic.play().catch(e => console.log('Music play failed'));
    } else {
      bgMusic.pause();
    }
  }
};

const socket = io({ transports: ['websocket'], upgrade: false, autoConnect: false });

let myId = null;
let world = { width: 4000, height: 4000 };
let myName = '';
let availableColors = [];
let streakNotifications = []; // {text, createdAt}

/** @type {Map<string,{id:string,name:string,x:number,y:number,angle:number,hp:number,maxHp:number,isBot:boolean,score:number,kills:number,deaths:number,level:number,xp:number,credits:number,skills:any,vx:number,vy:number}>} */
const players = new Map();
const playerVelocities = new Map(); // store last known velocities for interpolation
const SKILL_COSTS = { speedBoost: [50, 100, 150], shield: [50, 100, 150], rapidFire: [50, 100, 150] };
/** @type {{ id:number, x:number, y:number }[]} */
let bullets = [];
/** @type {{ id:number, x:number, y:number, type:string }[]} */
let projectiles = [];
let leaderboard = [];
let killFeed = [];
let lastKillFeedUpdate = '';
let explosions = []; // {x, y, createdAt, size}
let particles = []; // {x, y, vx, vy, life, maxLife, color, size}
let damageIndicators = []; // {x, y, damage, createdAt}
let previousPlayerHP = new Map(); // track HP changes

// Toast notification system
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// add toastOut animation
const style = document.createElement('style');
style.textContent = '@keyframes toastOut { to { transform: translateX(120%); opacity: 0; } }';
document.head.appendChild(style);
const WEAPON_COSTS = { cannon: [100, 200, 300], torpedo: [150, 300, 500], missile: [200, 400, 700] };
const ELECTRONICS_COSTS = { radar: [120, 250, 400], sonar: [100, 200, 350], targeting: [180, 350, 600] };

// UI visibility toggles
let showLeaderboard = true;
let showColorPicker = true;
let showMinimap = true;

// input state
const keys = new Set();
let turn = 0; // -1..1
let thrust = false;
let lastSent = 0;
let latency = 0;
let lastPingAt = performance.now();
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let mouseRightDown = false;
let spaceDown = false;

const FIRE_COOLDOWN = 350; // ms
let lastFireAt = 0;

// Audio Context for sound effects
let audioContext = null;
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    audioContext.resume();
    audioUnlocked = true;
  } catch (e) {
    // silent fail
  }
}

function playFireSound() {
  if (!audioContext || !audioUnlocked || !soundEnabled) return;
  try {
    const now = audioContext.currentTime;
    
    // Deep space cannon - bass + punch
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(120, now);
    osc1.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc1.start(now);
    osc1.stop(now + 0.15);
    
    // High frequency crack
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(2000, now);
    osc2.frequency.exponentialRampToValueAtTime(100, now + 0.05);
    gain2.gain.setValueAtTime(0.2, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc2.start(now);
    osc2.stop(now + 0.05);
    
    // Noise burst for impact
    const bufferSize = audioContext.sampleRate * 0.03;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / bufferSize * 10);
    }
    const noise = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    noise.buffer = buffer;
    noise.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);
    noise.start(now);
  } catch (e) {
    // silent fail
  }
}

function playExplosionSound() {
  if (!audioContext || !audioUnlocked || !soundEnabled) return;
  try {
    const now = audioContext.currentTime;
    
    // Explosion bass
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.connect(gain1);
    gain1.connect(audioContext.destination);
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(150, now);
    osc1.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1.start(now);
    osc1.stop(now + 0.3);
    
    // Noise burst
    const bufferSize = audioContext.sampleRate * 0.2;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / bufferSize * 8);
    }
    const noise = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    noise.buffer = buffer;
    noise.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    noise.start(now);
  } catch (e) {
    // silent fail
  }
}

function playStreakSound(streak) {
  if (!audioContext || !audioUnlocked || !soundEnabled) return;
  try {
    const now = audioContext.currentTime;
    const baseFreq = 400 + (streak * 50);
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.type = 'sine';
    
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.15);
    
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    osc.start(now);
    osc.stop(now + 0.15);
  } catch (e) {
    // silent fail
  }
}

function playHitSound() {
  if (!audioContext || !audioUnlocked || !soundEnabled) return;
  try {
    const now = audioContext.currentTime;
    
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.type = 'triangle';
    
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.08);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {
    // silent fail
  }
}

const nameEl = document.getElementById('name');
const pingEl = document.getElementById('ping');
const fpsEl = document.getElementById('fps');
const cdBar = document.getElementById('cdbar');
const cdText = document.getElementById('cdtext');

// Server-side account system
let currentUser = null;

async function loginUser(username, password) {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Giriş başarısız');
    }
    
    currentUser = data.user;
    // save credentials locally for auto-login
    localStorage.setItem('space-sonar-creds', JSON.stringify({ username, password }));
    return data.user;
  } catch (error) {
    throw error;
  }
}

async function registerUser(username, password) {
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Kayıt başarısız');
    }
    
    currentUser = data.user;
    // save credentials locally
    localStorage.setItem('space-sonar-creds', JSON.stringify({ username, password }));
    return data.user;
  } catch (error) {
    throw error;
  }
}

async function updateUserProgress(username, updates) {
  try {
    await fetch('/api/user/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, updates })
    });
  } catch (error) {
    console.log('Progress update failed:', error);
  }
}

// Load persistent data
function loadProgress() {
  if (currentUser) {
    return {
      totalKills: currentUser.totalKills || 0,
      totalScore: currentUser.totalScore || 0,
      bestStreak: currentUser.bestStreak || 0,
      shipColor: currentUser.shipColor || '#ffffff'
    };
  }
  return { totalKills: 0, totalScore: 0, bestStreak: 0, shipColor: '#ffffff' };
}

function saveProgress(data) {
  if (currentUser) {
    currentUser.totalKills = data.totalKills || currentUser.totalKills;
    currentUser.totalScore = data.totalScore || currentUser.totalScore;
    currentUser.bestStreak = data.bestStreak || currentUser.bestStreak;
    currentUser.shipColor = data.shipColor || currentUser.shipColor;
    
    // update on server
    updateUserProgress(currentUser.username, data);
  }
}

// Show main menu on load
window.addEventListener('DOMContentLoaded', () => {
  showMainMenu();
  
  // Play button handler
  const playBtn = document.getElementById('play-button');
  if (playBtn) {
    playBtn.addEventListener('click', startGame);
  }
  
  // Enter key on inputs
  const usernameInput = document.getElementById('username-input');
  const passwordInput = document.getElementById('password-input');
  if (usernameInput) {
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (passwordInput) passwordInput.focus();
      }
    });
  }
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') startGame();
    });
  }
});

async function startGame() {
  if (gameStarted) return;
  
  // get inputs
  const usernameInput = document.getElementById('username-input');
  const passwordInput = document.getElementById('password-input');
  
  let username = usernameInput ? usernameInput.value.trim() : '';
  let password = passwordInput ? passwordInput.value.trim() : '';
  
  // validation
  if (!username || username.length < 3) {
    updateAccountStatus('❌ Kullanıcı adı en az 3 karakter olmalı!', 'error');
    return;
  }
  
  if (!password || password.length < 3) {
    updateAccountStatus('❌ Şifre en az 3 karakter olmalı!', 'error');
    return;
  }
  
  updateAccountStatus('⏳ Kontrol ediliyor...', 'info');
  
  try {
    // try login first
    let user;
    try {
      user = await loginUser(username, password);
      updateAccountStatus('✅ Giriş başarılı!', 'success');
    } catch (loginError) {
      // if login fails, try register
      user = await registerUser(username, password);
      updateAccountStatus('✅ Hesap oluşturuldu!', 'success');
    }
    
    // populate stats in menu
    const statItems = document.querySelectorAll('#menu-stats .stat-item span');
    if (statItems[0]) statItems[0].textContent = user.totalScore || 0;
    if (statItems[1]) statItems[1].textContent = user.totalKills || 0;
    if (statItems[2]) statItems[2].textContent = user.bestStreak || 0;
    
    gameStarted = true;
    
    // start background music
    if (bgMusic && musicEnabled) {
      bgMusic.volume = 0.3;
      bgMusic.play().catch(e => console.log('Music autoplay blocked'));
    }
    
    // hide menu and connect
    setTimeout(() => {
      hideMainMenu();
      socket.connect();
    }, 500);
    
  } catch (error) {
    updateAccountStatus('❌ ' + (error.message || 'Bir hata oluştu'), 'error');
    gameStarted = false;
  }
}

// Auto-join on connect
socket.on('connect', () => {
  lastPingAt = performance.now();
  
  const progress = loadProgress();
  const playerName = currentUser ? currentUser.username : `Guest-${Math.random().toString(36).slice(2, 8)}`;
  
  socket.emit('join', {
    name: playerName,
    persistentData: progress
  });
});

socket.on('init', data => {
  myId = data.id;
  world = data.world;
  myName = data.name;
  availableColors = data.availableColors || [];
  nameEl.textContent = myName;
  
  // init color picker
  initColorPicker();
  updateTotalStats();
});

function initColorPicker() {
  const grid = document.getElementById('color-grid');
  if (!grid || availableColors.length === 0) return;
  
  const progress = loadProgress();
  grid.innerHTML = availableColors.map((color, idx) => {
    const isSelected = color === progress.shipColor;
    return `<div class="color-option ${isSelected ? 'selected' : ''}" 
                 style="background: ${color};" 
                 onclick="selectColor(${idx})"></div>`;
  }).join('');
}

window.selectColor = function(index) {
  const color = availableColors[index];
  if (!color) return;
  
  socket.emit('changeColor', index);
  saveProgress({ shipColor: color });
  
  // update UI
  document.querySelectorAll('.color-option').forEach((el, i) => {
    el.classList.toggle('selected', i === index);
  });
};

function updateTotalStats() {
  const stats = loadProgress();
  const totalEl = document.getElementById('total-stats');
  if (totalEl) {
    totalEl.textContent = `Toplam: ${stats.totalKills} Öldürme · ${stats.totalScore} Puan · En İyi Seri: ${stats.bestStreak}`;
  }
}

socket.on('saveProgress', (data) => {
  saveProgress(data);
});

socket.on('streak', (data) => {
  streakNotifications.push({
    text: `${data.streak}x STREAK! ${data.bonus > 0 ? `+${data.bonus} bonus!` : ''}`,
    createdAt: performance.now()
  });
  
  showToast('🔥 KILL STREAK!', `${data.streak}x combo! +${data.bonus} bonus puan`, 'success');
  playStreakSound(data.streak);
});

socket.on('state', s => {
  // ping estimate
  const now = performance.now();
  latency = Math.round(now - lastPingAt);
  pingEl.textContent = String(latency);
  lastPingAt = now;

  // check for HP changes to show damage
  for (const p of s.players) {
    const oldHP = previousPlayerHP.get(p.id);
    if (oldHP !== undefined && oldHP > p.hp) {
      const damage = Math.round(oldHP - p.hp);
      damageIndicators.push({
        x: p.x,
        y: p.y,
        damage: damage,
        createdAt: now
      });
      
      // reduced hit particles (3 instead of 5)
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 100;
        particles.push({
          x: p.x,
          y: p.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.2,
          maxLife: 0.2,
          color: '#ff4444',
          size: 2
        });
      }
      
      // play hit sound if it's the player
      if (p.id === myId) {
        playHitSound();
      }
    }
    previousPlayerHP.set(p.id, p.hp);
  }

  players.clear();
  for (const p of s.players) {
    players.set(p.id, p);
  }
  bullets = s.bullets || [];
  projectiles = s.projectiles || [];
  leaderboard = s.leaderboard || [];
  killFeed = s.killFeed || [];
  
  updateLeaderboard();
  updateKillFeed();
  updateUpgradeUI();
});

socket.on('explosion', (data) => {
  explosions.push({
    x: data.x,
    y: data.y,
    createdAt: performance.now(),
    size: 0
  });
  
  // reduced explosion particles (10 instead of 25)
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i) / 10;
    const speed = 150 + Math.random() * 150;
    particles.push({
      x: data.x,
      y: data.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5,
      maxLife: 0.5,
      color: i % 2 === 0 ? '#ff6600' : '#ffaa00',
      size: 3
    });
  }
  
  playExplosionSound();
});

// controls
function onKey(e, down) {
  unlockAudio(); // unlock on any key press
  const k = e.key.toLowerCase();
  keys[down ? 'add' : 'delete'](k);
  
  // Space for continuous fire
  if (k === ' ') {
    spaceDown = down;
  }
  
  // One-time actions
  if (down && !e.repeat) {
    if (k === 'g') fireTorpedo();
    if (k === 'h') fireMissile();
    if (k === '1') upgradeSkill('speedBoost');
    if (k === '2') upgradeSkill('shield');
    if (k === '3') upgradeSkill('rapidFire');
    if (k === 't') toggleLeaderboard();
    if (k === 'c') toggleColorPicker();
    if (k === 'm') toggleMinimap();
  }
  
  updateInput();
}

function toggleLeaderboard() {
  showLeaderboard = !showLeaderboard;
  const lb = document.querySelector('.leaderboard');
  if (lb) lb.style.display = showLeaderboard ? 'block' : 'none';
}

function toggleColorPicker() {
  showColorPicker = !showColorPicker;
  const cp = document.querySelector('.color-picker');
  if (cp) cp.style.display = showColorPicker ? 'block' : 'none';
}

function toggleMinimap() {
  showMinimap = !showMinimap;
}

// global functions for HTML button clicks
window.upgradeSkill = function(skillName) {
  socket.emit('upgradeSkill', skillName);
};

window.upgradeWeapon = function(weaponName) {
  socket.emit('upgradeWeapon', weaponName);
};


function fireTorpedo() {
  const meData = players.get(myId);
  if (!meData || meData.weapons.torpedo === 0) return;
  socket.emit('fireTorpedo', {});
}

function fireMissile() {
  const meData = players.get(myId);
  if (!meData || meData.weapons.missile === 0) return;
  socket.emit('fireMissile', {});
}


// mouse down/up for fire (left) and rotation (right)
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  unlockAudio();
  
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  
  if (e.button === 0) {
    // left click - fire
    mouseDown = true;
  } else if (e.button === 2) {
    // right click - rotate
    mouseRightDown = true;
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    mouseDown = false;
  } else if (e.button === 2) {
    mouseRightDown = false;
  }
});

// prevent context menu on right click
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

// update mouse position on move
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));

function updateInput() {
  const newThrust = keys.has('w') || keys.has('arrowup');
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  let newTurn = (left ? -1 : 0) + (right ? 1 : 0);
  
  // mouse right click rotation (override keyboard)
  if (mouseRightDown) {
    const me = getMe();
    const dx = mouseX - width/2;
    const dy = mouseY - height/2;
    const targetAngle = Math.atan2(dy, dx);
    
    let angleDiff = targetAngle - me.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    // smooth rotation towards mouse
    if (Math.abs(angleDiff) > 0.05) {
      newTurn = angleDiff > 0 ? 1 : -1;
    } else {
      newTurn = 0;
    }
  }

  // always update to ensure state is current
  thrust = newThrust;
  turn = newTurn;

  const t = performance.now();
  if (t - lastSent > 40) {
    const inputData = { thrust, turn };
    socket.emit('input', inputData);
    lastSent = t;
  }
}

function triggerFire() {
  const now = performance.now();
  if (now - lastFireAt < FIRE_COOLDOWN) return;
  lastFireAt = now;
  playFireSound();
  socket.emit('fire'); // fire in ship's current direction
}

function triggerFireAtAngle(angle) {
  const now = performance.now();
  if (now - lastFireAt < FIRE_COOLDOWN) return;
  lastFireAt = now;
  playFireSound();
  socket.emit('fire', { angle: angle });
}

// camera follows me
function getMe() {
  return players.get(myId) || { x: world.width / 2, y: world.height / 2, angle: 0 };
}

// wrap-aware delta for drawing nearby entities
function wrappedDelta(ax, ay, bx, by) {
  let dx = ax - bx;
  let dy = ay - by;
  if (dx > world.width / 2) dx -= world.width;
  if (dx < -world.width / 2) dx += world.width;
  if (dy > world.height / 2) dy -= world.height;
  if (dy < -world.height / 2) dy += world.height;
  return { dx, dy };
}

// rendering
let lastFpsAt = performance.now();
let frames = 0;
function drawShip(x, y, angle, options = {}) {
  const {
    primary = '#00ff00', // lime green default
    accent = '#8ec5ff',
    scale = 1,
    thrusting = false,
    glow = true
  } = options;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Engine flames (simplified - no particles for performance)
  if (thrusting) {
    const flicker = 1 + Math.random() * 0.3;
    const flameLength = 20 * flicker;
    
    // Main engine flame (center) - no shadow for performance
    ctx.fillStyle = '#ff8800';
    ctx.beginPath();
    ctx.moveTo(-16, -5);
    ctx.lineTo(-16 - flameLength, -3);
    ctx.lineTo(-16 - flameLength * 0.5, 0);
    ctx.lineTo(-16 - flameLength, 3);
    ctx.lineTo(-16, 5);
    ctx.closePath();
    ctx.fill();
  }

  // Nose cone (red pointed tip)
  ctx.fillStyle = '#a23b3b';
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(14, -6);
  ctx.lineTo(14, 6);
  ctx.closePath();
  ctx.fill();

  // Main body (lime green rocket)
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(14, -6);
  ctx.lineTo(14, 6);
  ctx.lineTo(-10, 6);
  ctx.lineTo(-10, -6);
  ctx.closePath();
  ctx.fill();

  // Window/cockpit (blue-gray geometric)
  ctx.fillStyle = '#5a7a8a';
  ctx.beginPath();
  ctx.moveTo(10, -4);
  ctx.lineTo(6, -2);
  ctx.lineTo(6, 2);
  ctx.lineTo(10, 4);
  ctx.closePath();
  ctx.fill();

  // Window highlight
  ctx.fillStyle = '#7a9aaa';
  ctx.beginPath();
  ctx.moveTo(10, -3);
  ctx.lineTo(7, -1);
  ctx.lineTo(7, 1);
  ctx.lineTo(10, 3);
  ctx.closePath();
  ctx.fill();

  // Side wings (red swept back)
  ctx.fillStyle = '#a23b3b';
  // Left wing
  ctx.beginPath();
  ctx.moveTo(2, -6);
  ctx.lineTo(2, -14);
  ctx.lineTo(-8, -14);
  ctx.lineTo(-8, -6);
  ctx.closePath();
  ctx.fill();
  // Right wing
  ctx.beginPath();
  ctx.moveTo(2, 6);
  ctx.lineTo(2, 14);
  ctx.lineTo(-8, 14);
  ctx.lineTo(-8, 6);
  ctx.closePath();
  ctx.fill();

  // Wing details (green on wings)
  ctx.fillStyle = primary;
  ctx.fillRect(0, -12, 3, 5);
  ctx.fillRect(0, 7, 3, 5);

  // Side boosters (green cylinders)
  ctx.fillStyle = primary;
  ctx.fillRect(-10, -16, 4, 10);
  ctx.fillRect(-10, 6, 4, 10);

  // Booster tips (red)
  ctx.fillStyle = '#a23b3b';
  ctx.beginPath();
  ctx.moveTo(-10, -16);
  ctx.lineTo(-8, -18);
  ctx.lineTo(-6, -16);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-10, 16);
  ctx.lineTo(-8, 18);
  ctx.lineTo(-6, 16);
  ctx.closePath();
  ctx.fill();

  // Booster stripes (red bands)
  ctx.fillStyle = '#8b2f2f';
  ctx.fillRect(-10, -8, 4, 2);
  ctx.fillRect(-10, 14, 4, 2);

  // Engine base (red block)
  ctx.fillStyle = '#a23b3b';
  ctx.fillRect(-16, -6, 6, 12);

  // Engine nozzles (dark)
  ctx.fillStyle = '#3a1f1f';
  ctx.fillRect(-16, -4, 2, 3);
  ctx.fillRect(-16, 1, 2, 3);

  ctx.restore();
}

function drawDarkness(me) {
  // light darkness layer - ships should be visible
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, height);

  // large vision cone around me
  const inner = 100;
  const outer = 600;
  const grad = ctx.createRadialGradient(width/2, height/2, inner, width/2, height/2, outer);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(width/2, height/2, outer, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}


function drawBullets(me) {
  for (const bullet of bullets) {
    const { dx, dy } = wrappedDelta(bullet.x, bullet.y, me.x, me.y);
    const bx = width/2 + dx;
    const by = height/2 + dy;
    
    // tracking bullets have different color
    if (bullet.targetId) {
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff6666';
    } else {
      ctx.shadowColor = '#ffaa44';
      ctx.shadowBlur = 15;
      ctx.fillStyle = '#fff4d6';
    }
    
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawTargetLockIndicator(me) {
  // targeting system removed
  return;
  
  // find target in front of ship
  const maxDist = 800 + (meData.electronics.targeting * 200);
  const coneAngle = Math.PI / 3 - (meData.electronics.targeting * 0.15);
  
  let nearestTarget = null;
  let minDist = Infinity;
  
  for (const other of players.values()) {
    if (other.id === myId || other.hp <= 0) continue;
    const { dx, dy } = wrappedDelta(other.x, other.y, me.x, me.y);
    const dist = Math.hypot(dx, dy);
    if (dist > maxDist) continue;
    
    const angleToTarget = Math.atan2(dy, dx);
    let angleDiff = angleToTarget - me.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    if (Math.abs(angleDiff) < coneAngle && dist < minDist) {
      minDist = dist;
      nearestTarget = other;
    }
  }
  
  if (nearestTarget) {
    const { dx, dy } = wrappedDelta(nearestTarget.x, nearestTarget.y, me.x, me.y);
    const tx = width/2 + dx;
    const ty = height/2 + dy;
    
    // animated lock brackets
    const time = performance.now() * 0.003;
    const pulse = Math.sin(time * 3) * 0.3 + 0.7;
    
    ctx.strokeStyle = `rgba(255, 0, 0, ${pulse})`;
    ctx.lineWidth = 3;
    const bracketSize = 25;
    
    // top-left
    ctx.beginPath();
    ctx.moveTo(tx - bracketSize, ty - bracketSize);
    ctx.lineTo(tx - bracketSize, ty - bracketSize + 10);
    ctx.moveTo(tx - bracketSize, ty - bracketSize);
    ctx.lineTo(tx - bracketSize + 10, ty - bracketSize);
    ctx.stroke();
    
    // top-right
    ctx.beginPath();
    ctx.moveTo(tx + bracketSize, ty - bracketSize);
    ctx.lineTo(tx + bracketSize, ty - bracketSize + 10);
    ctx.moveTo(tx + bracketSize, ty - bracketSize);
    ctx.lineTo(tx + bracketSize - 10, ty - bracketSize);
    ctx.stroke();
    
    // bottom-left
    ctx.beginPath();
    ctx.moveTo(tx - bracketSize, ty + bracketSize);
    ctx.lineTo(tx - bracketSize, ty + bracketSize - 10);
    ctx.moveTo(tx - bracketSize, ty + bracketSize);
    ctx.lineTo(tx - bracketSize + 10, ty + bracketSize);
    ctx.stroke();
    
    // bottom-right
    ctx.beginPath();
    ctx.moveTo(tx + bracketSize, ty + bracketSize);
    ctx.lineTo(tx + bracketSize, ty + bracketSize - 10);
    ctx.moveTo(tx + bracketSize, ty + bracketSize);
    ctx.lineTo(tx + bracketSize - 10, ty + bracketSize);
    ctx.stroke();
    
    // "LOCKED" text
    ctx.font = 'bold 10px ui-sans-serif, system-ui';
    ctx.fillStyle = `rgba(255, 0, 0, ${pulse})`;
    ctx.textAlign = 'center';
    ctx.fillText('LOCKED', tx, ty - bracketSize - 8);
  }
}

function drawProjectiles(me) {
  for (const proj of projectiles) {
    const { dx, dy } = wrappedDelta(proj.x, proj.y, me.x, me.y);
    const px = width/2 + dx;
    const py = height/2 + dy;
    
    if (proj.type === 'torpedo') {
      // torpedo - blue streak
      ctx.shadowColor = '#4080ff';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#5090ff';
      ctx.beginPath();
      ctx.ellipse(px, py, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (proj.type === 'missile') {
      // missile - red with flame trail
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 25;
      ctx.fillStyle = '#ff6666';
      ctx.beginPath();
      ctx.ellipse(px, py, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // flame trail
      ctx.fillStyle = '#ff8800';
      ctx.beginPath();
      ctx.arc(px - 10, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function updateAndDrawParticles(me, now) {
  const dt = 1/60;
  
  // update and draw particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98; // slight drag
    p.vy *= 0.98;
    
    const { dx, dy } = wrappedDelta(p.x, p.y, me.x, me.y);
    const px = width/2 + dx;
    const py = height/2 + dy;
    
    const alpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  
  // draw damage indicators
  const DAMAGE_DURATION = 1000;
  for (let i = damageIndicators.length - 1; i >= 0; i--) {
    const ind = damageIndicators[i];
    const age = now - ind.createdAt;
    
    if (age > DAMAGE_DURATION) {
      damageIndicators.splice(i, 1);
      continue;
    }
    
    const { dx, dy } = wrappedDelta(ind.x, ind.y, me.x, me.y);
    const ix = width/2 + dx;
    const iy = height/2 + dy - (age / DAMAGE_DURATION) * 40;
    
    const alpha = 1 - (age / DAMAGE_DURATION);
    ctx.font = 'bold 18px ui-sans-serif, system-ui';
    ctx.fillStyle = `rgba(255, 68, 68, ${alpha})`;
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText(`-${ind.damage}`, ix, iy);
    ctx.fillText(`-${ind.damage}`, ix, iy);
  }
}

function drawExplosions(me, now) {
  const EXPLOSION_DURATION = 500; // ms
  
  for (let i = explosions.length - 1; i >= 0; i--) {
    const exp = explosions[i];
    const age = now - exp.createdAt;
    
    if (age > EXPLOSION_DURATION) {
      explosions.splice(i, 1);
      continue;
    }
    
    const { dx, dy } = wrappedDelta(exp.x, exp.y, me.x, me.y);
    const ex = width/2 + dx;
    const ey = height/2 + dy;
    
    const progress = age / EXPLOSION_DURATION;
    const size = 80 * (1 - Math.pow(1 - progress, 2));
    const alpha = 1 - progress;
    
    // outer ring
    ctx.strokeStyle = `rgba(255, 100, 50, ${alpha})`;
    ctx.lineWidth = 8 * (1 - progress);
    ctx.beginPath();
    ctx.arc(ex, ey, size, 0, Math.PI * 2);
    ctx.stroke();
    
    // middle ring
    ctx.strokeStyle = `rgba(255, 180, 50, ${alpha * 0.8})`;
    ctx.lineWidth = 6 * (1 - progress);
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    
    // inner flash
    if (progress < 0.3) {
      ctx.fillStyle = `rgba(255, 255, 200, ${(1 - progress / 0.3) * 0.8})`;
      ctx.beginPath();
      ctx.arc(ex, ey, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // particles
    for (let p = 0; p < 8; p++) {
      const angle = (p / 8) * Math.PI * 2;
      const dist = size * 0.9;
      const px = ex + Math.cos(angle) * dist;
      const py = ey + Math.sin(angle) * dist;
      ctx.fillStyle = `rgba(255, 150, 50, ${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(px, py, 4 * (1 - progress), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMiniMap(me, now) {
  const pad = 12;
  const size = Math.min(220, Math.floor(width * 0.22));
  const x0 = width - pad - size;
  const y0 = pad + 8;

  ctx.save();
  // background
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);

  const innerPad = 6;
  const sx = x0 + innerPad;
  const sy = y0 + innerPad;
  const sw = size - innerPad * 2;
  const sh = size - innerPad * 2;

  const scaleX = sw / world.width;
  const scaleY = sh / world.height;

  // other players
  for (const p of players.values()) {
    const px = sx + p.x * scaleX;
    const py = sy + p.y * scaleY;
    if (p.id === myId) continue;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = p.isBot ? '#f38ba8' : '#89b4fa';
    ctx.fill();
  }

  // me (triangle)
  const mx = sx + me.x * scaleX;
  const my = sy + me.y * scaleY;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(me.angle);
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fillStyle = '#cdd6f4';
  ctx.fill();
  ctx.restore();

  // label
  ctx.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('MAP', x0 + 8, y0 - 2);

  ctx.restore();
}

function drawReveals(me, now) {
  // reveal other ships if nearby (sonar removed)
  for (const other of players.values()) {
    if (other.id === myId) continue;
    
    // check if nearby (within vision range)
    const { dx: vdx, dy: vdy } = wrappedDelta(other.x, other.y, me.x, me.y);
    const distFromMe = Math.hypot(vdx, vdy);
    if (distFromMe > 600) continue; // visible range increased to 600
    
    const { dx, dy } = wrappedDelta(other.x, other.y, me.x, me.y);
    const ox = width/2 + dx;
    const oy = height/2 + dy;
    
    // draw ship with their custom color
    const enemyColor = other.shipColor || '#ff6666';
    const shipColor = { primary: enemyColor, accent: '#ffaaaa', scale: 1.05, glow: true };
    drawShip(ox, oy, other.angle, shipColor);
    
    // draw name and HP
    ctx.save();
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillStyle = '#ff6666';
    ctx.textAlign = 'center';
    ctx.fillText(other.name, ox, oy - 30);
    
    // HP bar mini
    const barW = 50;
    const barH = 5;
    const hpRatio = other.hp / other.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ox - barW/2, oy - 22, barW, barH);
    const hpColor = hpRatio > 0.6 ? '#a6e3a1' : hpRatio > 0.3 ? '#f9e2af' : '#f38ba8';
    ctx.fillStyle = hpColor;
    ctx.fillRect(ox - barW/2 + 1, oy - 21, (barW - 2) * hpRatio, barH - 2);
    ctx.restore();
  }
}

function drawStars(me) {
  const rng = (x) => Math.abs(Math.sin(x * 12.9898) * 43758.5453) % 1;
  
  // deep space gradient
  const bgGrad = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height)/2);
  bgGrad.addColorStop(0, '#0a0e1a');
  bgGrad.addColorStop(0.5, '#050810');
  bgGrad.addColorStop(1, '#020308');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);
  
  // distant nebulas
  const nebulaCell = 1200;
  const nCols = 3;
  const nRows = 3;
  const nStartX = Math.floor((me.x * 0.02 - width/2) / nebulaCell) - 1;
  const nStartY = Math.floor((me.y * 0.02 - height/2) / nebulaCell) - 1;
  
  for (let iy = 0; iy < nRows; iy++) {
    for (let ix = 0; ix < nCols; ix++) {
      const cx = (nStartX + ix) * nebulaCell;
      const cy = (nStartY + iy) * nebulaCell;
      const rx = rng(cx * 0.001 + cy * 0.002) * nebulaCell;
      const ry = rng(cx * 0.002 + cy * 0.001) * nebulaCell;
      const px = (cx - (me.x * 0.02 - width/2) + rx);
      const py = (cy - (me.y * 0.02 - height/2) + ry);
      
      const size = 120 + rng(rx + ry) * 180;
      const nebGrad = ctx.createRadialGradient(px, py, 0, px, py, size);
      const hue = rng(rx * ry) * 60 + 220; // blue-purple range
      nebGrad.addColorStop(0, `hsla(${hue}, 60%, 40%, 0.08)`);
      nebGrad.addColorStop(0.5, `hsla(${hue}, 50%, 30%, 0.04)`);
      nebGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = nebGrad;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // medium stars (parallax layer 1) - simplified
  const cell1 = 250;
  const cols1 = Math.ceil(width / cell1) + 2;
  const rows1 = Math.ceil(height / cell1) + 2;
  const startX1 = Math.floor((me.x * 0.3 - width/2) / cell1) - 1;
  const startY1 = Math.floor((me.y * 0.3 - height/2) / cell1) - 1;
  
  for (let iy = 0; iy < rows1; iy++) {
    for (let ix = 0; ix < cols1; ix++) {
      const cx = (startX1 + ix) * cell1;
      const cy = (startY1 + iy) * cell1;
      for (let s = 0; s < 6; s++) {
        const rx = rng(cx * 0.123 + cy * 0.987 + s) * cell1;
        const ry = rng(cx * 0.777 + cy * 0.333 + s) * cell1;
        const px = (cx - (me.x * 0.3 - width/2) + rx);
        const py = (cy - (me.y * 0.3 - height/2) + ry);
        const brightness = rng(rx + ry);
        const size = brightness > 0.8 ? 2 : 1.5;
        
        ctx.fillStyle = brightness > 0.9 ? '#ffffff' : '#c8d8f8';
        ctx.fillRect(px - size/2, py - size/2, size, size);
      }
    }
  }
  
  // close stars (parallax layer 2) - no glow
  const cell2 = 150;
  const cols2 = Math.ceil(width / cell2) + 2;
  const rows2 = Math.ceil(height / cell2) + 2;
  const startX2 = Math.floor((me.x * 0.7 - width/2) / cell2) - 1;
  const startY2 = Math.floor((me.y * 0.7 - height/2) / cell2) - 1;
  
  for (let iy = 0; iy < rows2; iy++) {
    for (let ix = 0; ix < cols2; ix++) {
      const cx = (startX2 + ix) * cell2;
      const cy = (startY2 + iy) * cell2;
      for (let s = 0; s < 4; s++) {
        const rx = rng(cx * 0.456 + cy * 0.789 + s * 100) * cell2;
        const ry = rng(cx * 0.654 + cy * 0.321 + s * 100) * cell2;
        const px = (cx - (me.x * 0.7 - width/2) + rx);
        const py = (cy - (me.y * 0.7 - height/2) + ry);
        const brightness = rng(rx * ry + s);
        const size = brightness > 0.8 ? 2.5 : 2;
        
        ctx.fillStyle = brightness > 0.85 ? '#ffffff' : '#d8e8ff';
        ctx.fillRect(px - size/2, py - size/2, size, size);
      }
    }
  }
  
  // foreground bright stars - minimal glow
  const cell3 = 100;
  const cols3 = Math.ceil(width / cell3) + 2;
  const rows3 = Math.ceil(height / cell3) + 2;
  const startX3 = Math.floor((me.x - width/2) / cell3) - 1;
  const startY3 = Math.floor((me.y - height/2) / cell3) - 1;
  
  for (let iy = 0; iy < rows3; iy++) {
    for (let ix = 0; ix < cols3; ix++) {
      const cx = (startX3 + ix) * cell3;
      const cy = (startY3 + iy) * cell3;
      for (let s = 0; s < 2; s++) {
        const rx = rng(cx * 0.911 + cy * 0.822 + s * 200) * cell3;
        const ry = rng(cx * 0.733 + cy * 0.644 + s * 200) * cell3;
        const px = (cx - (me.x - width/2) + rx);
        const py = (cy - (me.y - height/2) + ry);
        
        if (rng(rx + ry + s) > 0.75) {
          const size = 2.5 + rng(rx * ry);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px - size/2, py - size/2, size, size);
        }
      }
    }
  }
}

function drawHPBar(me, now) {
  const meData = players.get(myId);
  if (!meData) return;

  const barW = 300;
  const barH = 28;
  const x = (width - barW) / 2;
  const y = height - 80;

  // background
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, barW, barH);

  // HP fill
  const hpRatio = meData.hp / meData.maxHp;
  const fillW = (barW - 4) * hpRatio;
  const hpColor = hpRatio > 0.6 ? '#a6e3a1' : hpRatio > 0.3 ? '#f9e2af' : '#f38ba8';
  ctx.fillStyle = hpColor;
  ctx.fillRect(x + 2, y + 2, fillW, barH - 4);

  // border
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);

  // text
  ctx.font = '14px ui-sans-serif, system-ui';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(`HP: ${Math.ceil(meData.hp)} / ${meData.maxHp}`, x + barW / 2, y + barH / 2 + 5);

  // XP bar
  const xpBarW = 300;
  const xpBarH = 8;
  const xpX = (width - xpBarW) / 2;
  const xpY = height - 48;
  const xpForNext = meData.level * 100;
  const xpRatio = meData.xp / xpForNext;
  
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(xpX, xpY, xpBarW, xpBarH);
  ctx.fillStyle = '#fab387';
  ctx.fillRect(xpX + 1, xpY + 1, (xpBarW - 2) * xpRatio, xpBarH - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(xpX, xpY, xpBarW, xpBarH);

  // stats
  ctx.font = 'bold 16px ui-sans-serif, system-ui';
  ctx.fillStyle = '#f9e2af';
  ctx.textAlign = 'left';
  ctx.fillText(`Lv.${meData.level}`, 16, height - 100);
  
  // streak indicator
  if (meData.killStreak >= 2) {
    ctx.fillStyle = meData.killStreak >= 5 ? '#ff6b9d' : '#f9e2af';
    ctx.fillText(`🔥 ${meData.killStreak}x STREAK`, 16, height - 80);
  }
  
  ctx.fillStyle = '#a6e3a1';
  ctx.fillText(`💵 ${meData.credits}`, 16, height - 58);
  ctx.fillStyle = '#89b4fa';
  ctx.fillText(`⭐ ${meData.score}`, 16, height - 36);
  ctx.fillStyle = '#f38ba8';
  ctx.fillText(`💀 ${meData.kills}/${meData.deaths}`, 16, height - 14);

  ctx.textAlign = 'left';
  
  // update skill levels
  updateSkillUI(meData);
  
  // draw streak notifications
  drawStreakNotifications(now);
}

function drawStreakNotifications(now) {
  const NOTIF_DURATION = 2000;
  
  for (let i = streakNotifications.length - 1; i >= 0; i--) {
    const notif = streakNotifications[i];
    const age = now - notif.createdAt;
    
    if (age > NOTIF_DURATION) {
      streakNotifications.splice(i, 1);
      continue;
    }
    
    const progress = age / NOTIF_DURATION;
    const alpha = 1 - progress;
    const y = height / 2 - 100 - (progress * 50);
    
    ctx.save();
    ctx.font = 'bold 28px ui-sans-serif, system-ui';
    ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
    ctx.strokeStyle = `rgba(255, 100, 50, ${alpha})`;
    ctx.lineWidth = 4;
    ctx.textAlign = 'center';
    ctx.shadowColor = `rgba(255, 150, 0, ${alpha})`;
    ctx.shadowBlur = 20;
    ctx.strokeText(notif.text, width / 2, y);
    ctx.fillText(notif.text, width / 2, y);
    ctx.restore();
  }
}

function updateLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;
  
  const myData = players.get(myId);
  list.innerHTML = leaderboard.map((entry, idx) => {
    const isMe = myData && entry.name === myData.name;
    return `<div class="lb-entry ${isMe ? 'me' : ''}">
      <span class="lb-rank">${idx + 1}</span>
      <span class="lb-name">${entry.name}</span>
      <span class="lb-score">${entry.score}</span>
    </div>`;
  }).join('');
}

function updateKillFeed() {
  const feed = document.getElementById('killfeed');
  if (!feed) return;
  
  // only update if changed
  const currentHash = JSON.stringify(killFeed);
  if (currentHash === lastKillFeedUpdate) return;
  lastKillFeedUpdate = currentHash;
  
  feed.innerHTML = killFeed.map(kill => {
    const streakText = kill.streak >= 3 ? ` <span style="color: #f9e2af;">🔥${kill.streak}x</span>` : '';
    return `<div class="kill-item">
      <span class="killer">${kill.killer}</span> 💥 <span class="killed">${kill.killed}</span>${streakText}
    </div>`;
  }).join('');
}

function updateSkillUI(meData) {
  const speedLevel = document.getElementById('speed-level');
  const shieldLevel = document.getElementById('shield-level');
  const rapidLevel = document.getElementById('rapid-level');
  
  const speedCost = SKILL_COSTS.speedBoost[meData.skills.speedBoost] || 'MAX';
  const shieldCost = SKILL_COSTS.shield[meData.skills.shield] || 'MAX';
  const rapidCost = SKILL_COSTS.rapidFire[meData.skills.rapidFire] || 'MAX';
  
  if (speedLevel) speedLevel.textContent = `Lv. ${meData.skills.speedBoost}/3 (${speedCost})`;
  if (shieldLevel) shieldLevel.textContent = `Lv. ${meData.skills.shield}/3 (${shieldCost})`;
  if (rapidLevel) rapidLevel.textContent = `Lv. ${meData.skills.rapidFire}/3 (${rapidCost})`;
}

function updateUpgradeUI() {
  const meData = players.get(myId);
  if (!meData) return;
  
  // weapons only (electronics removed)
  const cannonLevel = document.getElementById('cannon-level');
  const torpedoLevel = document.getElementById('torpedo-level');
  const missileLevel = document.getElementById('missile-level');
  
  if (!meData.weapons) return; // safety check
  
  const cannonCost = WEAPON_COSTS.cannon[meData.weapons.cannon] || 'MAX';
  const torpedoCost = WEAPON_COSTS.torpedo[meData.weapons.torpedo] || 'MAX';
  const missileCost = WEAPON_COSTS.missile[meData.weapons.missile] || 'MAX';
  
  if (cannonLevel) cannonLevel.textContent = `Lv. ${meData.weapons.cannon}/3 ${cannonCost !== 'MAX' ? `(${cannonCost})` : ''}`;
  if (torpedoLevel) torpedoLevel.textContent = `Lv. ${meData.weapons.torpedo}/3 ${torpedoCost !== 'MAX' ? `(${torpedoCost})` : ''}`;
  if (missileLevel) missileLevel.textContent = `Lv. ${meData.weapons.missile}/3 ${missileCost !== 'MAX' ? `(${missileCost})` : ''}`;
}

function drawCrosshair() {
  if (mouseX === 0 && mouseY === 0) return;
  
  ctx.save();
  const size = 20;
  const gap = 8;
  
  // outer glow
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(mouseX - size, mouseY);
  ctx.lineTo(mouseX - gap, mouseY);
  ctx.moveTo(mouseX + gap, mouseY);
  ctx.lineTo(mouseX + size, mouseY);
  ctx.moveTo(mouseX, mouseY - size);
  ctx.lineTo(mouseX, mouseY - gap);
  ctx.moveTo(mouseX, mouseY + gap);
  ctx.lineTo(mouseX, mouseY + size);
  ctx.stroke();
  
  // inner crosshair
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mouseX - size, mouseY);
  ctx.lineTo(mouseX - gap, mouseY);
  ctx.moveTo(mouseX + gap, mouseY);
  ctx.lineTo(mouseX + size, mouseY);
  ctx.moveTo(mouseX, mouseY - size);
  ctx.lineTo(mouseX, mouseY - gap);
  ctx.moveTo(mouseX, mouseY + gap);
  ctx.lineTo(mouseX, mouseY + size);
  ctx.stroke();
  
  // center dot
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath();
  ctx.arc(mouseX, mouseY, 2, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

function render() {
  const me = getMe();
  const now = performance.now();

  // Continuous fire when space or mouse held (with cooldown check)
  if (spaceDown && now - lastFireAt >= FIRE_COOLDOWN) {
    triggerFire();
  }
  
  if (mouseDown && now - lastFireAt >= FIRE_COOLDOWN) {
    const dx = mouseX - width/2;
    const dy = mouseY - height/2;
    const angle = Math.atan2(dy, dx);
    triggerFireAtAngle(angle);
  }

  // FPS counter
  frames++;
  if (now - lastFpsAt >= 1000) {
    fpsEl.textContent = String(frames);
    frames = 0;
    lastFpsAt = now;
  }

  // background
  drawStars(me);

  // world origin at center
  ctx.save();
  // draw my ship at center with custom color
  const meData = players.get(myId);
  const myColor = (meData && meData.shipColor) || '#00ff00';
  drawShip(width/2, height/2, me.angle, { primary: myColor, accent: '#cfe7ff', thrusting: thrust });

  // reveals (other ships)
  drawReveals(me, now);
  
  // target lock indicator
  drawTargetLockIndicator(me);
  
  // bullets
  drawBullets(me);
  
  // projectiles (torpedoes, missiles)
  drawProjectiles(me);
  
  // particles
  updateAndDrawParticles(me, now);
  
  // explosions
  drawExplosions(me, now);

  ctx.restore();

  // darkness on top, with small vision around me
  drawDarkness(me);

  // mini map on top-right (if visible)
  if (showMinimap) {
    drawMiniMap(me, now);
  }

  // HP bar and score
  drawHPBar(me, now);
  
  // crosshair
  drawCrosshair();

  requestAnimationFrame(render);
}
requestAnimationFrame(render);



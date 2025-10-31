import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from './models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection (use env variable for production)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://freak:q1w2e3r4t5Y**-@localhost:27017/space-sonar-io';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

const TICK_HZ = 60;
const BROADCAST_HZ = 20;
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const MAX_SPEED = 180; // px/s - slower for easier aiming
const ACCELERATION = 250; // px/s^2 - slower acceleration
const TURN_SPEED = Math.PI * 1.4; // rad/s - faster turning for better control
const FRICTION = 0.5; // velocity damping per second (much more friction to stop)
const SONAR_COOLDOWN_MS = 2500;
const SONAR_SPEED = 700; // px/s
const SONAR_TTL_MS = 2200;
const COLLISION_DAMAGE = 5;
const SHIP_RADIUS = 20;
const MAX_HP = 100;
const BOT_COUNT = 8;
const BULLET_SPEED = 950; // px/s (increased for easier hits)
const BULLET_DAMAGE = 25;
const BULLET_RADIUS = 6; // increased from 4 for easier hits
const FIRE_COOLDOWN_MS = 350; // faster fire rate (from 400)
const BULLET_TTL_MS = 2500; // longer life (from 2000)
const BULLET_MAX_RANGE = 800; // max distance bullets can travel
const SKILL_COSTS = { speedBoost: [50, 100, 150], shield: [50, 100, 150], rapidFire: [50, 100, 150] };
const WEAPON_COSTS = { cannon: [100, 200, 300], torpedo: [150, 300, 500], missile: [200, 400, 700] };
const ELECTRONICS_COSTS = { radar: [120, 250, 400], sonar: [100, 200, 350], targeting: [180, 350, 600] };
const KILL_REWARD = 75; // credits per kill
const SHIP_COLORS = ['#ffffff', '#ff6b9d', '#c9a0dc', '#ffd700', '#00ffff', '#ff8c00', '#7fffd4', '#ff69b4'];
const STREAK_BONUSES = [0, 50, 100, 200, 400, 800]; // bonus credits for streaks
const TORPEDO_COOLDOWN = 3000; // ms
const MISSILE_COOLDOWN = 5000; // ms
const TORPEDO_DAMAGE = 35;
const MISSILE_DAMAGE = 50;

/** @typedef {{
 *  id: string,
 *  name: string,
 *  x: number,
 *  y: number,
 *  angle: number,
 *  vx: number,
 *  vy: number,
 *  thrust: boolean,
 *  turn: number,
 *  lastSonarAt: number,
 *  lastFireAt: number,
 *  lastTorpedoAt: number,
 *  lastMissileAt: number,
 *  hp: number,
 *  maxHp: number,
 *  isBot: boolean,
 *  score: number,
 *  kills: number,
 *  deaths: number,
 *  level: number,
 *  xp: number,
 *  credits: number,
 *  skills: {speedBoost: number, shield: number, rapidFire: number},
 *  shipColor: string,
 *  killStreak: number,
 *  bestStreak: number,
 *  totalKills: number,
 *  totalScore: number,
 *  weapons: {cannon: number, torpedo: number, missile: number},
 *  electronics: {radar: number, sonar: number, targeting: number}
 * }} Player
 */

/** @typedef {{ id: number, x: number, y: number, createdAt: number }} SonarPulse */

/** @typedef {{ id: number, x: number, y: number, vx: number, vy: number, ownerId: string, createdAt: number, startX: number, startY: number, targetId: string|null }} Bullet */

/** @typedef {{ id: number, x: number, y: number, vx: number, vy: number, ownerId: string, createdAt: number, type: string }} Projectile */

/** @type {Map<string, Player>} */
const players = new Map();
/** @type {SonarPulse[]} */
let pulses = [];
let nextPulseId = 1;
/** @type {Bullet[]} */
let bullets = [];
let nextBulletId = 1;

/** @type {Projectile[]} */
let projectiles = []; // torpedoes and missiles
let nextProjectileId = 1;

/** @typedef {{ id: string, killer: string, killed: string, timestamp: number }} KillEvent */
/** @type {KillEvent[]} */
let recentKills = [];

function randomSpawn() {
  return {
    x: Math.random() * WORLD_WIDTH,
    y: Math.random() * WORLD_HEIGHT,
    angle: Math.random() * Math.PI * 2
  };
}

function clampPosition(value, max) {
  return Math.max(SHIP_RADIUS, Math.min(max - SHIP_RADIUS, value));
}

function distanceSq(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function createPlayer(id, name, isBot = false, persistentData = {}) {
  const spawn = randomSpawn();
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    vx: 0,
    vy: 0,
    thrust: false,
    turn: 0,
    lastSonarAt: 0,
    lastFireAt: 0,
    lastTorpedoAt: 0,
    lastMissileAt: 0,
    hp: MAX_HP,
    maxHp: MAX_HP,
    isBot,
    score: 0,
    kills: 0,
    deaths: 0,
    level: 1,
    xp: 0,
    credits: isBot ? 999 : 0,
    skills: { speedBoost: 0, shield: 0, rapidFire: 0 },
    shipColor: persistentData.shipColor || SHIP_COLORS[0],
    killStreak: 0,
    bestStreak: persistentData.bestStreak || 0,
    totalKills: persistentData.totalKills || 0,
    totalScore: persistentData.totalScore || 0,
    weapons: { cannon: 1, torpedo: 0, missile: 0 }, // always reset
    electronics: { radar: 0, sonar: 1, targeting: 0 } // always reset
  };
}

function spawnBot() {
  const id = `bot-${Math.random().toString(36).slice(2, 9)}`;
  const name = `Bot-${(Math.random() * 1000 | 0).toString().padStart(3, '0')}`;
  const bot = createPlayer(id, name, true);
  
  // give bots random skills for variety
  const skillPoints = Math.floor(Math.random() * 7); // 0-6 skill points
  for (let i = 0; i < skillPoints; i++) {
    const skills = ['speedBoost', 'shield', 'rapidFire'];
    const randomSkill = skills[Math.floor(Math.random() * skills.length)];
    if (bot.skills[randomSkill] < 3) {
      bot.skills[randomSkill]++;
    }
  }
  
  // give bots random weapons (50% chance each)
  if (Math.random() > 0.5) {
    bot.weapons.torpedo = 1 + Math.floor(Math.random() * 3); // 1-3
  }
  if (Math.random() > 0.6) {
    bot.weapons.missile = 1 + Math.floor(Math.random() * 3); // 1-3
  }
  bot.weapons.cannon = 1 + Math.floor(Math.random() * 3); // 1-3
  
  // give bots random electronics
  if (Math.random() > 0.4) {
    bot.electronics.radar = 1 + Math.floor(Math.random() * 3);
  }
  if (Math.random() > 0.5) {
    bot.electronics.sonar = 1 + Math.floor(Math.random() * 3);
  }
  if (Math.random() > 0.6) {
    bot.electronics.targeting = 1 + Math.floor(Math.random() * 3);
  }
  
  // random ship color
  bot.shipColor = SHIP_COLORS[Math.floor(Math.random() * SHIP_COLORS.length)];
  
  players.set(id, bot);
}

// spawn initial bots
for (let i = 0; i < BOT_COUNT; i++) {
  spawnBot();
}

// Authentication endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı!' });
    }
    
    // update last login
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      success: true,
      user: {
        username: user.username,
        totalKills: user.totalKills,
        totalScore: user.totalScore,
        bestStreak: user.bestStreak,
        shipColor: user.shipColor
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Kullanıcı adı en az 3 karakter olmalı!' });
    }
    
    if (!password || password.length < 3) {
      return res.status(400).json({ error: 'Şifre en az 3 karakter olmalı!' });
    }
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış!' });
    }
    
    const user = new User({ username, password });
    await user.save();
    
    res.json({
      success: true,
      user: {
        username: user.username,
        totalKills: 0,
        totalScore: 0,
        bestStreak: 0,
        shipColor: '#ffffff'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.post('/api/user/update', async (req, res) => {
  try {
    const { username, updates } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı!' });
    }
    
    if (updates.totalKills !== undefined) user.totalKills = updates.totalKills;
    if (updates.totalScore !== undefined) user.totalScore = updates.totalScore;
    if (updates.bestStreak !== undefined) user.bestStreak = updates.bestStreak;
    if (updates.shipColor) user.shipColor = updates.shipColor;
    
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

io.on('connection', socket => {
  console.log('Player connected:', socket.id);
  
  // Create player immediately for backwards compatibility
  const defaultName = `Pilot-${(Math.random() * 1000 | 0).toString().padStart(3, '0')}`;
  const player = createPlayer(socket.id, defaultName, false, {});
  players.set(socket.id, player);

  socket.emit('init', {
    id: socket.id,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    name: player.name,
    availableColors: SHIP_COLORS
  });
  
  // Handle join event for updating name and persistent data
  socket.on('join', (data) => {
    const p = players.get(socket.id);
    if (p) {
      p.name = data.name || p.name;
      if (data.persistentData) {
        p.totalKills = data.persistentData.totalKills || 0;
        p.totalScore = data.persistentData.totalScore || 0;
        p.bestStreak = data.persistentData.bestStreak || 0;
        p.shipColor = data.persistentData.shipColor || SHIP_COLORS[0];
      }
    }
  });

  socket.on('input', data => {
    const p = players.get(socket.id);
    if (!p) return;
    if (typeof data.thrust === 'boolean') p.thrust = data.thrust;
    if (typeof data.turn === 'number') p.turn = Math.max(-1, Math.min(1, data.turn));
  });

  socket.on('sonar', () => {
    const p = players.get(socket.id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastSonarAt < SONAR_COOLDOWN_MS) return;
    p.lastSonarAt = now;
    pulses.push({ id: nextPulseId++, x: p.x, y: p.y, createdAt: now });
  });

  socket.on('fire', (data) => {
    const p = players.get(socket.id);
    if (!p || p.hp <= 0) return;
    const now = Date.now();
    
    // rapid fire skill reduces cooldown
    const cooldown = FIRE_COOLDOWN_MS * (1 - p.skills.rapidFire * 0.15);
    if (now - p.lastFireAt < cooldown) return;
    p.lastFireAt = now;
    
    // use provided angle from mouse or current ship angle
    let fireAngle = p.angle;
    if (data && typeof data.angle === 'number') {
      fireAngle = data.angle;
      p.angle = fireAngle; // instantly rotate ship to fire angle
    }
    
    // auto-targeting: find nearest visible enemy in direction
    let targetId = null;
    
    if (p.electronics.targeting > 0) {
      let nearestTarget = null;
      let minDist = Infinity;
      const maxTargetDist = 800 + (p.electronics.targeting * 200);
      
      for (const other of players.values()) {
        if (other.id === p.id || other.hp <= 0) continue;
        const dist = Math.hypot(other.x - p.x, other.y - p.y);
        if (dist > maxTargetDist) continue;
        
        const angleToTarget = Math.atan2(other.y - p.y, other.x - p.x);
        let angleDiff = angleToTarget - fireAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        const coneAngle = Math.PI / 4; // 45 degree cone
        if (Math.abs(angleDiff) < coneAngle && dist < minDist) {
          minDist = dist;
          nearestTarget = other;
          targetId = other.id;
        }
      }
    }
    
    const bulletVx = Math.cos(fireAngle) * BULLET_SPEED;
    const bulletVy = Math.sin(fireAngle) * BULLET_SPEED;
    const startX = p.x + Math.cos(fireAngle) * 25;
    const startY = p.y + Math.sin(fireAngle) * 25;
    bullets.push({
      id: nextBulletId++,
      x: startX,
      y: startY,
      vx: bulletVx,
      vy: bulletVy,
      ownerId: socket.id,
      createdAt: now,
      startX: startX,
      startY: startY,
      targetId: targetId
    });
  });
  
  socket.on('upgradeSkill', (skillName) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (skillName === 'speedBoost' || skillName === 'shield' || skillName === 'rapidFire') {
      const currentLevel = p.skills[skillName];
      if (currentLevel < 3) { // max level 3
        const cost = SKILL_COSTS[skillName][currentLevel];
        if (p.credits >= cost) {
          p.credits -= cost;
          p.skills[skillName]++;
        }
      }
    }
  });
  
  socket.on('changeColor', (colorIndex) => {
    const p = players.get(socket.id);
    if (!p || p.isBot) return;
    if (colorIndex >= 0 && colorIndex < SHIP_COLORS.length) {
      p.shipColor = SHIP_COLORS[colorIndex];
    }
  });
  
  socket.on('upgradeWeapon', (weaponName) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (weaponName === 'cannon' || weaponName === 'torpedo' || weaponName === 'missile') {
      const currentLevel = p.weapons[weaponName];
      if (currentLevel < 3) {
        const cost = WEAPON_COSTS[weaponName][currentLevel];
        if (p.credits >= cost) {
          p.credits -= cost;
          p.weapons[weaponName]++;
        }
      }
    }
  });
  
  socket.on('upgradeElectronics', (electronicsName) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (electronicsName === 'radar' || electronicsName === 'sonar' || electronicsName === 'targeting') {
      const currentLevel = p.electronics[electronicsName];
      if (currentLevel < 3) {
        const cost = ELECTRONICS_COSTS[electronicsName][currentLevel];
        if (p.credits >= cost) {
          p.credits -= cost;
          p.electronics[electronicsName]++;
        }
      }
    }
  });
  
  socket.on('fireTorpedo', (data) => {
    const p = players.get(socket.id);
    if (!p || p.hp <= 0 || p.weapons.torpedo === 0) return;
    const now = Date.now();
    if (now - p.lastTorpedoAt < TORPEDO_COOLDOWN) return;
    p.lastTorpedoAt = now;
    
    let fireAngle = p.angle;
    if (data && typeof data.angle === 'number') {
      fireAngle = data.angle;
    }
    
    const speed = 500;
    projectiles.push({
      id: nextProjectileId++,
      x: p.x + Math.cos(fireAngle) * 30,
      y: p.y + Math.sin(fireAngle) * 30,
      vx: Math.cos(fireAngle) * speed,
      vy: Math.sin(fireAngle) * speed,
      ownerId: socket.id,
      createdAt: now,
      type: 'torpedo'
    });
  });
  
  socket.on('fireMissile', (data) => {
    const p = players.get(socket.id);
    if (!p || p.hp <= 0 || p.weapons.missile === 0) return;
    const now = Date.now();
    if (now - p.lastMissileAt < MISSILE_COOLDOWN) return;
    p.lastMissileAt = now;
    
    let fireAngle = p.angle;
    if (data && typeof data.angle === 'number') {
      fireAngle = data.angle;
    }
    
    const speed = 400;
    projectiles.push({
      id: nextProjectileId++,
      x: p.x + Math.cos(fireAngle) * 30,
      y: p.y + Math.sin(fireAngle) * 30,
      vx: Math.cos(fireAngle) * speed,
      vy: Math.sin(fireAngle) * speed,
      ownerId: socket.id,
      createdAt: now,
      type: 'missile'
    });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });
});

let lastTick = Date.now();
let botThinkTimer = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000); // clamp large frames
  lastTick = now;
  botThinkTimer += dt;

  // bot AI (every 0.3s for smarter reactions)
  if (botThinkTimer >= 0.3) {
    botThinkTimer = 0;
    for (const bot of players.values()) {
      if (!bot.isBot || bot.hp <= 0) continue;
      
      // find nearest enemy
      let nearestEnemy = null;
      let minDist = Infinity;
      for (const other of players.values()) {
        if (other.id === bot.id || other.hp <= 0) continue;
        const dist = distanceSq(bot.x, bot.y, other.x, other.y);
        if (dist < minDist) {
          minDist = dist;
          nearestEnemy = other;
        }
      }
      
      if (nearestEnemy) {
        const dist = Math.sqrt(minDist);
        const dx = nearestEnemy.x - bot.x;
        const dy = nearestEnemy.y - bot.y;
        const angleToEnemy = Math.atan2(dy, dx);
        let angleDiff = angleToEnemy - bot.angle;
        
        // normalize angle difference
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        // smart behavior based on distance and HP
        if (dist < 600) {
          // combat range
          if (bot.hp < 30 && dist < 300) {
            // retreat when low HP
            bot.thrust = true;
            bot.turn = angleDiff > 0 ? -1 : 1; // turn away
          } else {
            // attack mode
            bot.turn = Math.abs(angleDiff) > 0.1 ? (angleDiff > 0 ? 1 : -1) : 0;
            bot.thrust = dist > 200; // maintain distance
            
            // fire when aimed
            const aimThreshold = bot.electronics.targeting > 0 ? 0.5 : 0.3;
            if (Math.abs(angleDiff) < aimThreshold && dist < 700) {
              // use best available weapon
              if (bot.weapons.missile > 0 && dist > 400 && now - bot.lastMissileAt >= MISSILE_COOLDOWN) {
                bot.lastMissileAt = now;
                const speed = 400;
                projectiles.push({
                  id: nextProjectileId++,
                  x: bot.x + Math.cos(bot.angle) * 30,
                  y: bot.y + Math.sin(bot.angle) * 30,
                  vx: Math.cos(bot.angle) * speed,
                  vy: Math.sin(bot.angle) * speed,
                  ownerId: bot.id,
                  createdAt: now,
                  type: 'missile'
                });
              } else if (bot.weapons.torpedo > 0 && dist > 250 && dist < 600 && now - bot.lastTorpedoAt >= TORPEDO_COOLDOWN) {
                bot.lastTorpedoAt = now;
                const speed = 500;
                projectiles.push({
                  id: nextProjectileId++,
                  x: bot.x + Math.cos(bot.angle) * 30,
                  y: bot.y + Math.sin(bot.angle) * 30,
                  vx: Math.cos(bot.angle) * speed,
                  vy: Math.sin(bot.angle) * speed,
                  ownerId: bot.id,
                  createdAt: now,
                  type: 'torpedo'
                });
              } else if (now - bot.lastFireAt >= FIRE_COOLDOWN_MS * (1 - bot.skills.rapidFire * 0.15)) {
                // cannon fire with targeting
                bot.lastFireAt = now;
                
                let targetId = null;
                if (bot.electronics.targeting > 0) {
                  const maxTargetDist = 800 + (bot.electronics.targeting * 200);
                  for (const other of players.values()) {
                    if (other.id === bot.id || other.hp <= 0) continue;
                    const targetDist = Math.hypot(other.x - bot.x, other.y - bot.y);
                    if (targetDist < maxTargetDist) {
                      const angleToTarget = Math.atan2(other.y - bot.y, other.x - bot.x);
                      let diff = angleToTarget - bot.angle;
                      while (diff > Math.PI) diff -= Math.PI * 2;
                      while (diff < -Math.PI) diff += Math.PI * 2;
                      if (Math.abs(diff) < Math.PI / 4) {
                        targetId = other.id;
                        break;
                      }
                    }
                  }
                }
                
                const bulletVx = Math.cos(bot.angle) * BULLET_SPEED;
                const bulletVy = Math.sin(bot.angle) * BULLET_SPEED;
                const startX = bot.x + Math.cos(bot.angle) * 25;
                const startY = bot.y + Math.sin(bot.angle) * 25;
                bullets.push({
                  id: nextBulletId++,
                  x: startX,
                  y: startY,
                  vx: bulletVx,
                  vy: bulletVy,
                  ownerId: bot.id,
                  createdAt: now,
                  startX: startX,
                  startY: startY,
                  targetId: targetId
                });
              }
            }
          }
          
          // use sonar when enemy nearby
          if (dist > 400 && dist < 1000 && Math.random() > 0.5 && now - bot.lastSonarAt >= SONAR_COOLDOWN_MS) {
            bot.lastSonarAt = now;
            pulses.push({ id: nextPulseId++, x: bot.x, y: bot.y, createdAt: now });
          }
        } else {
          // search mode - patrol
          bot.thrust = Math.random() > 0.4;
          if (Math.random() > 0.7) {
            bot.turn = Math.random() > 0.5 ? 1 : -1;
          } else {
            bot.turn = 0;
          }
          
          // use sonar to find enemies
          if (Math.random() > 0.7 && now - bot.lastSonarAt >= SONAR_COOLDOWN_MS) {
            bot.lastSonarAt = now;
            pulses.push({ id: nextPulseId++, x: bot.x, y: bot.y, createdAt: now });
          }
        }
        
        // avoid walls
        const wallMargin = 100;
        if (bot.x < wallMargin || bot.x > WORLD_WIDTH - wallMargin ||
            bot.y < wallMargin || bot.y > WORLD_HEIGHT - wallMargin) {
          const centerX = WORLD_WIDTH / 2;
          const centerY = WORLD_HEIGHT / 2;
          const angleToCenter = Math.atan2(centerY - bot.y, centerX - bot.x);
          let angleDiff = angleToCenter - bot.angle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          bot.turn = angleDiff > 0 ? 1 : -1;
          bot.thrust = true;
        }
      } else {
        // no enemies - patrol randomly
        bot.thrust = Math.random() > 0.5;
        bot.turn = Math.random() < 0.2 ? (Math.random() > 0.5 ? 1 : -1) : 0;
      }
    }
  }

  for (const p of players.values()) {
    if (p.hp <= 0) continue;

    // turning
    p.angle += p.turn * TURN_SPEED * dt;

    // thrust with speed boost skill
    const accelMultiplier = 1 + (p.skills.speedBoost * 0.2);
    const maxSpeedMultiplier = 1 + (p.skills.speedBoost * 0.2);
    
    if (p.thrust) {
      p.vx += Math.cos(p.angle) * ACCELERATION * accelMultiplier * dt;
      p.vy += Math.sin(p.angle) * ACCELERATION * accelMultiplier * dt;
    }

    // friction
    p.vx *= Math.pow(FRICTION, dt);
    p.vy *= Math.pow(FRICTION, dt);

    // clamp speed
    const speed = Math.hypot(p.vx, p.vy);
    const effectiveMaxSpeed = MAX_SPEED * maxSpeedMultiplier;
    if (speed > effectiveMaxSpeed) {
      const s = effectiveMaxSpeed / speed;
      p.vx *= s;
      p.vy *= s;
    }

    // integrate with boundary clamping
    p.x = clampPosition(p.x + p.vx * dt, WORLD_WIDTH);
    p.y = clampPosition(p.y + p.vy * dt, WORLD_HEIGHT);

    // bounce off walls
    if (p.x <= SHIP_RADIUS || p.x >= WORLD_WIDTH - SHIP_RADIUS) p.vx *= -0.5;
    if (p.y <= SHIP_RADIUS || p.y >= WORLD_HEIGHT - SHIP_RADIUS) p.vy *= -0.5;
  }

  // update bullets with tracking
  for (const bullet of bullets) {
    // homing behavior if has target
    if (bullet.targetId) {
      const target = players.get(bullet.targetId);
      if (target && target.hp > 0) {
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist > 0) {
          const targetAngle = Math.atan2(dy, dx);
          const currentAngle = Math.atan2(bullet.vy, bullet.vx);
          let angleDiff = targetAngle - currentAngle;
          
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          
          // homing strength (0.15 = subtle tracking)
          const homingStrength = 0.15;
          const newAngle = currentAngle + angleDiff * homingStrength;
          
          bullet.vx = Math.cos(newAngle) * BULLET_SPEED;
          bullet.vy = Math.sin(newAngle) * BULLET_SPEED;
        }
      }
    }
    
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
  }
  
  // update projectiles (torpedo, missile)
  for (const proj of projectiles) {
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
  }

  // bullet collisions with players
  const bulletsToRemove = new Set();
  for (const bullet of bullets) {
    for (const p of players.values()) {
      if (p.id === bullet.ownerId || p.hp <= 0) continue;
      const distSq = distanceSq(bullet.x, bullet.y, p.x, p.y);
      const hitDist = SHIP_RADIUS + BULLET_RADIUS;
      if (distSq < hitDist * hitDist) {
        // shield skill reduces damage
        const shieldMultiplier = 1 - (p.skills.shield * 0.15);
        const damage = BULLET_DAMAGE * shieldMultiplier;
        p.hp = Math.max(0, p.hp - damage);
        bulletsToRemove.add(bullet.id);
        
        // award score, kill, XP and credits to shooter
        if (p.hp <= 0) {
          const shooter = players.get(bullet.ownerId);
          if (shooter) {
            shooter.killStreak++;
            shooter.kills++;
            shooter.totalKills++;
            
            // heal shooter on kill
            shooter.hp = Math.min(shooter.maxHp, shooter.hp + 50);
            
            // loot system: 50% to killer, 25% stays, 25% lost
            const lootedCredits = Math.floor(p.credits * 0.5);
            shooter.credits += lootedCredits;
            p.credits = Math.floor(p.credits * 0.25); // victim keeps only 25%
            
            // streak bonuses
            const streakBonus = shooter.killStreak >= 5 ? STREAK_BONUSES[Math.min(5, shooter.killStreak - 2)] : 0;
            const baseReward = 100;
            const totalReward = baseReward + streakBonus;
            
            shooter.score += totalReward;
            shooter.totalScore += totalReward;
            shooter.xp += 50;
            shooter.credits += KILL_REWARD + (shooter.killStreak >= 3 ? 25 : 0);
            
            if (shooter.killStreak > shooter.bestStreak) {
              shooter.bestStreak = shooter.killStreak;
            }
            
            // level up check
            const xpForNextLevel = shooter.level * 100;
            if (shooter.xp >= xpForNextLevel) {
              shooter.level++;
              shooter.xp -= xpForNextLevel;
              shooter.maxHp += 10;
              shooter.hp = shooter.maxHp;
            }
            
            // add to kill feed with streak
            recentKills.unshift({
              id: `kill-${Date.now()}-${Math.random()}`,
              killer: shooter.name,
              killed: p.name,
              timestamp: Date.now(),
              streak: shooter.killStreak
            });
            if (recentKills.length > 2) recentKills.pop();
            
            // notify shooter of streak
            if (shooter.killStreak >= 3 && !shooter.isBot) {
              io.to(shooter.id).emit('streak', { streak: shooter.killStreak, bonus: streakBonus });
            }
          }
          p.deaths++;
          p.killStreak = 0; // reset victim's streak
          
          // emit explosion event to all clients
          io.emit('explosion', { x: p.x, y: p.y });
        }
        break;
      }
    }
  }

  // projectile collisions (torpedo, missile)
  const projectilesToRemove = new Set();
  for (const proj of projectiles) {
    for (const p of players.values()) {
      if (p.id === proj.ownerId || p.hp <= 0) continue;
      const hitDist = SHIP_RADIUS + 10;
      const distSq = distanceSq(proj.x, proj.y, p.x, p.y);
      if (distSq < hitDist * hitDist) {
        const damage = proj.type === 'torpedo' ? TORPEDO_DAMAGE : MISSILE_DAMAGE;
        const shieldMultiplier = 1 - (p.electronics.radar * 0.1); // radar helps avoid
        p.hp = Math.max(0, p.hp - damage * shieldMultiplier);
        projectilesToRemove.add(proj.id);
        
        if (p.hp <= 0) {
          const shooter = players.get(proj.ownerId);
          if (shooter) {
            shooter.killStreak++;
            shooter.kills++;
            shooter.totalKills++;
            
            // heal shooter on kill
            shooter.hp = Math.min(shooter.maxHp, shooter.hp + 50);
            
            // loot system: 50% to killer, 25% kept, 25% lost
            const totalCredits = p.credits;
            const lootedCredits = Math.floor(totalCredits * 0.5); // 50% to killer
            const keptCredits = Math.floor(totalCredits * 0.25); // 25% kept by victim
            // 25% disappears (totalCredits * 0.25)
            
            shooter.credits += lootedCredits;
            p.credits = keptCredits;
            
            const streakBonus = shooter.killStreak >= 5 ? STREAK_BONUSES[Math.min(5, shooter.killStreak - 2)] : 0;
            const baseReward = 150; // higher reward for advanced weapons
            shooter.score += baseReward + streakBonus;
            shooter.totalScore += baseReward + streakBonus;
            shooter.xp += 75;
            shooter.credits += 100;
            
            if (shooter.killStreak > shooter.bestStreak) {
              shooter.bestStreak = shooter.killStreak;
            }
            
            recentKills.unshift({
              id: `kill-${Date.now()}-${Math.random()}`,
              killer: shooter.name,
              killed: p.name,
              timestamp: Date.now(),
              streak: shooter.killStreak
            });
            if (recentKills.length > 2) recentKills.pop();
            
            if (shooter.killStreak >= 3 && !shooter.isBot) {
              io.to(shooter.id).emit('streak', { streak: shooter.killStreak, bonus: streakBonus });
            }
          }
          p.deaths++;
          p.killStreak = 0;
          io.emit('explosion', { x: p.x, y: p.y });
        }
        break;
      }
    }
  }
  
  // remove projectiles
  const projCutoff = Date.now() - 6000;
  projectiles = projectiles.filter(p => !projectilesToRemove.has(p.id) && p.createdAt > projCutoff);
  
  // remove hit bullets, expired bullets, and out-of-range bullets
  const bulletCutoff = Date.now() - BULLET_TTL_MS;
  bullets = bullets.filter(b => {
    if (bulletsToRemove.has(b.id)) return false;
    if (b.createdAt <= bulletCutoff) return false;
    
    // check if bullet exceeded max range
    const distTraveled = Math.hypot(b.x - b.startX, b.y - b.startY);
    if (distTraveled > BULLET_MAX_RANGE) return false;
    
    return true;
  });

  // ship collision (minor damage)
  const alive = Array.from(players.values()).filter(p => p.hp > 0);
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const distSq = distanceSq(a.x, a.y, b.x, b.y);
      const minDist = SHIP_RADIUS * 2;
      if (distSq < minDist * minDist) {
        // collision - just push apart, small damage
        const dist = Math.sqrt(distSq);
        const nx = (b.x - a.x) / dist;
        const ny = (b.y - a.y) / dist;
        const overlap = minDist - dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
        
        a.hp = Math.max(0, a.hp - COLLISION_DAMAGE * dt);
        b.hp = Math.max(0, b.hp - COLLISION_DAMAGE * dt);
      }
    }
  }

  // respawn dead players/bots
  for (const p of players.values()) {
    if (p.hp <= 0) {
      const spawn = randomSpawn();
      p.x = spawn.x;
      p.y = spawn.y;
      p.angle = spawn.angle;
      p.vx = 0;
      p.vy = 0;
      p.hp = MAX_HP;
      
      // reset on death (except bots)
      if (!p.isBot) {
        p.skills = { speedBoost: 0, shield: 0, rapidFire: 0 };
        p.weapons = { cannon: 1, torpedo: 0, missile: 0 };
        p.electronics = { radar: 0, sonar: 1, targeting: 0 };
        p.credits = 0; // lose all credits
        p.level = 1; // reset level
        p.xp = 0; // reset XP
        p.maxHp = MAX_HP; // reset max HP
        // score and kills stay (persistent)
        p.deaths++; // increment death count
        
        // send persistent data back to player for localStorage (only stats)
        io.to(p.id).emit('saveProgress', {
          totalKills: p.totalKills,
          totalScore: p.totalScore,
          bestStreak: p.bestStreak,
          shipColor: p.shipColor
        });
      }
    }
  }

  // maintain bot count
  const botCount = Array.from(players.values()).filter(p => p.isBot).length;
  if (botCount < BOT_COUNT) {
    spawnBot();
  }

  // expire sonar pulses
  const cutoff = Date.now() - SONAR_TTL_MS;
  pulses = pulses.filter(pl => pl.createdAt > cutoff);
}, 1000 / TICK_HZ);

setInterval(() => {
  // leaderboard: top 10 players by score
  const leaderboard = Array.from(players.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(p => ({ name: p.name, score: p.score, kills: p.kills, level: p.level }));
  
  const snapshot = {
    t: Date.now(),
    players: Array.from(players.values()).map(p => ({ 
      id: p.id, 
      name: p.name,
      x: p.x, 
      y: p.y, 
      angle: p.angle, 
      hp: p.hp, 
      maxHp: p.maxHp,
      isBot: p.isBot,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      level: p.level,
      xp: p.xp,
      credits: p.credits,
      skills: p.skills,
      shipColor: p.shipColor,
      killStreak: p.killStreak,
      bestStreak: p.bestStreak,
      weapons: p.weapons,
      electronics: p.electronics
    })),
    pulses: pulses,
    bullets: bullets.map(b => ({ id: b.id, x: b.x, y: b.y })),
    projectiles: projectiles.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
    leaderboard: leaderboard,
    killFeed: recentKills.slice(0, 2)
  };
  io.emit('state', snapshot);
}, 1000 / BROADCAST_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`space-sonar-io listening on http://localhost:${PORT}`);
});



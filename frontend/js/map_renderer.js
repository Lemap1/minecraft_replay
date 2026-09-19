/**
 * 2D Canvas Map Renderer for Fallen Kingdoms Replay
 */

export class MapRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // World & View Transform
    this.scale = 0.8;
    this.offsetX = 0;
    this.offsetY = 0;

    // Data references
    this.meta = null;
    this.worldId = 1;
    this.trajectories = []; // [time, user_id, x, y, z, action]
    this.placedBlocks = []; // [x, z, y, time, material, user_id]
    this.events = { deaths: [], chats: [], explosions: [], chest_loots: [], breaches: [] };
    this.playersById = {};

    // Playback & Filter state
    this.currentTime = 0;
    this.followPlayerId = null;
    this.yFilter = 'all'; // 'all', 'surface', 'mines'

    // Layer visibility
    this.layers = {
      bases: true,
      chests: true,
      blocks: true,
      players: true,
      names: true,
      trails: true,
      kills: true,
      explosions: true,
      grid: true
    };

    // Images cache (player avatars, custom map)
    this.avatarImages = {};
    this.customMapImage = null;
    this.customMapLoaded = false;

    // Interaction state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.mouseWorldX = 0;
    this.mouseWorldZ = 0;
    this.hoveredPlayer = null;

    // Callbacks
    this.onHoverCoords = options.onHoverCoords || (() => {});
    this.onPlayerClick = options.onPlayerClick || (() => {});

    this.initEvents();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  initEvents() {
    const el = this.canvas;

    el.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX - this.offsetX;
      this.dragStartY = e.clientY - this.offsetY;
      el.style.cursor = 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    });

    window.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      if (this.isDragging) {
        // If dragging, unfollow player
        if (this.followPlayerId) {
          this.followPlayerId = null;
          if (this.onUnfollow) this.onUnfollow();
        }
        this.offsetX = e.clientX - this.dragStartX;
        this.offsetY = e.clientY - this.dragStartY;
      }

      // Convert client coords to world coords
      const worldX = Math.round((clientX - this.offsetX) / this.scale);
      const worldZ = Math.round((clientY - this.offsetY) / this.scale);
      this.mouseWorldX = worldX;
      this.mouseWorldZ = worldZ;
      this.onHoverCoords(worldX, worldZ, Math.round(this.scale * 100));

      // Check player hover
      this.checkPlayerHover(clientX, clientY);
    });

    // Zoom on wheel
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newScale = Math.max(0.15, Math.min(8.0, this.scale * zoomFactor));

      // Zoom towards mouse position
      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.onHoverCoords(this.mouseWorldX, this.mouseWorldZ, Math.round(this.scale * 100));
    }, { passive: false });

    // Click on player
    el.addEventListener('click', (e) => {
      if (this.hoveredPlayer) {
        this.followPlayerId = this.hoveredPlayer.id;
        this.onPlayerClick(this.hoveredPlayer);
      }
    });
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  setData({ meta, trajectories, placedBlocks, events, worldId = 1 }) {
    this.meta = meta;
    this.worldId = worldId;
    this.trajectories = trajectories || [];
    // Sort placed blocks by firstTime ascending for binary search & viewport culling
    this.placedBlocks = (placedBlocks || []).sort((a, b) => a[3] - b[3]);
    this.events = events || { deaths: [], chats: [], explosions: [], chest_loots: [], breaches: [] };

    // Pre-index trajectories by playerId for high-performance O(1) lookups
    this.playerTrajectories = new Map();
    for (let i = 0; i < this.trajectories.length; i++) {
      const pt = this.trajectories[i];
      const uid = pt[1];
      let arr = this.playerTrajectories.get(uid);
      if (!arr) {
        arr = [];
        this.playerTrajectories.set(uid, arr);
      }
      arr.push(pt);
    }

    // Index players
    this.playersById = {};
    if (meta && meta.players) {
      for (const p of meta.players) {
        this.playersById[p.id] = p;
        this.preloadAvatar(p);
      }
    }

    // Dynamic map preloading for ANY world from meta.world_maps
    const wMap = meta?.world_maps?.[this.worldId];
    if (wMap && wMap.has_custom_map && wMap.custom_map_url) {
      this.customMapLoaded = false;
      this.customMapImage = new Image();
      this.customMapImage.onload = () => {
        this.customMapLoaded = true;
      };
      this.customMapImage.onerror = () => {
        console.warn(`[MapRenderer] Échec chargement carte monde ${this.worldId}:`, wMap.custom_map_url);
        this.customMapLoaded = false;
      };
      this.customMapImage.src = wMap.custom_map_url;
    } else if (this.worldId === (meta?.default_world_id || 1) && meta?.has_custom_map && meta?.custom_map_url) {
      this.customMapLoaded = false;
      this.customMapImage = new Image();
      this.customMapImage.onload = () => {
        this.customMapLoaded = true;
      };
      this.customMapImage.onerror = () => {
        this.customMapLoaded = false;
      };
      this.customMapImage.src = meta.custom_map_url;
    } else {
      this.customMapImage = null;
      this.customMapLoaded = false;
    }

    // Initial center on bases or bounds
    this.fitBounds();
  }

  reloadCustomMap(mapUrl, mapBounds) {
    if (mapBounds) {
      if (!this.meta) this.meta = {};
      this.meta.map_bounds = mapBounds;
    }
    if (this.meta) this.meta.has_custom_map = true;
    this.customMapLoaded = false;
    this.customMapImage = new Image();
    this.customMapImage.onload = () => {
      this.customMapLoaded = true;
    };
    this.customMapImage.onerror = () => {
      console.warn('[MapRenderer] Échec du rechargement de la carte custom :', mapUrl);
      this.customMapLoaded = false;
    };
    this.customMapImage.src = mapUrl;
  }

  preloadAvatar(player) {
    if (!this.avatarImages[player.id]) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = player.avatar_url;
      img.onload = () => {
        this.avatarImages[player.id] = img;
      };
    }
  }

  fitBounds() {
    if (!this.meta || !this.meta.bounds) {
      this.centerOn(0, 0);
      return;
    }
    const b = this.meta.bounds[this.worldId] || { min_x: -400, max_x: 400, min_z: -400, max_z: 400 };
    const width = b.max_x - b.min_x;
    const height = b.max_z - b.min_z;

    const padding = 80;
    const scaleX = (this.canvas.width - padding * 2) / width;
    const scaleY = (this.canvas.height - padding * 2) / height;
    this.scale = Math.max(0.2, Math.min(1.5, Math.min(scaleX, scaleY)));

    const centerX = (b.min_x + b.max_x) / 2;
    const centerZ = (b.min_z + b.max_z) / 2;
    this.centerOn(centerX, centerZ);
  }

  centerOn(x, z) {
    this.offsetX = this.canvas.width / 2 - x * this.scale;
    this.offsetY = this.canvas.height / 2 - z * this.scale;
  }

  setTime(t) {
    this.currentTime = t;
  }

  // Convert World Coord (X, Z) to Screen (px, py)
  worldToScreen(x, z) {
    return {
      x: this.offsetX + x * this.scale,
      y: this.offsetY + z * this.scale
    };
  }

  // Main Render Loop Frame
  render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, width, height);

    if (!this.meta) return;

    // Follow player camera
    if (this.followPlayerId) {
      const playerPos = this.calculatePlayerPosition(this.followPlayerId, this.currentTime);
      if (playerPos) {
        this.centerOn(playerPos.x, playerPos.z);
      }
    }

    // 1. Custom Map or Procedural Terrain
    this.renderMapBackground();

    // 2. Coordinate Grid
    if (this.layers.grid) {
      this.renderGrid();
    }

    // 3. Base Zones (Radius 15 with team colors)
    if (this.layers.bases) {
      this.renderBases();
    }

    // 4. Placed Blocks / Fortifications (evolve with currentTime)
    if (this.layers.blocks) {
      this.renderPlacedBlocks();
    }

    // 5. Explosions (TNT & Creepers)
    if (this.layers.explosions) {
      this.renderExplosions();
    }

    // 6. Death markers / Kills
    if (this.layers.kills) {
      this.renderDeaths();
    }

    // 7. Player Trails & Avatars
    if (this.layers.players) {
      this.renderPlayers();
    }
  }

  renderMapBackground() {
    const ctx = this.ctx;
    const b = (this.customMapLoaded && this.meta.map_bounds)
      ? this.meta.map_bounds
      : (this.meta?.bounds?.[this.worldId] || { min_x: -500, max_x: 500, min_z: -500, max_z: 500 });

    const p1 = this.worldToScreen(b.min_x, b.min_z);
    const p2 = this.worldToScreen(b.max_x, b.max_z);
    const w = p2.x - p1.x;
    const h = p2.y - p1.y;

    if (this.customMapLoaded && this.customMapImage) {
      ctx.drawImage(this.customMapImage, p1.x, p1.y, w, h);
      return;
    }

    // Determine dimension type dynamically
    const worldObj = this.meta?.worlds?.find(x => x.id === this.worldId);
    const dimType = worldObj?.dimension_type || (this.worldId === 2 ? 'nether' : (this.worldId === 3 ? 'the_end' : 'overworld'));

    if (dimType === 'nether') {
      // Atmospheric Nether procedural background
      const grad = ctx.createRadialGradient(
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 20,
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, Math.max(w, h) / 1.4
      );
      grad.addColorStop(0, '#2d0a0a');
      grad.addColorStop(0.6, '#1a0404');
      grad.addColorStop(1, '#0c0202');
      ctx.fillStyle = grad;
      ctx.fillRect(p1.x, p1.y, w, h);

      // Arena border in glowing red
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(p1.x, p1.y, w, h);

      // Central Nether Portal (0,0)
      const center = this.worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 40 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔥 Portail Nether Central (0,0)', center.x, center.y - 44 * this.scale);
    } else if (dimType === 'the_end') {
      // Atmospheric The End procedural background
      const grad = ctx.createRadialGradient(
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 30,
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, Math.max(w, h) / 1.4
      );
      grad.addColorStop(0, '#1c0e2d');
      grad.addColorStop(0.7, '#0d0517');
      grad.addColorStop(1, '#05020a');
      ctx.fillStyle = grad;
      ctx.fillRect(p1.x, p1.y, w, h);

      // Arena border in glowing purple
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(p1.x, p1.y, w, h);

      // Central Exit Portal / End Podium (0,0)
      const center = this.worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(168, 85, 247, 0.18)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 40 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c084fc';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#d8b4fe';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔮 Podium de l\'End (0,0)', center.x, center.y - 44 * this.scale);
    } else {
      // Procedural tactical Overworld background
      const grad = ctx.createRadialGradient(
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 50,
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, Math.max(w, h) / 1.3
      );
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.7, '#090d16');
      grad.addColorStop(1, '#05070c');
      ctx.fillStyle = grad;
      ctx.fillRect(p1.x, p1.y, w, h);

      // Arena border
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(p1.x, p1.y, w, h);

      // Center (0,0) Spawn Circle
      const center = this.worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 40 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SPAWN (0,0)', center.x, center.y + 3);
    }
  }

  renderGrid() {
    const ctx = this.ctx;
    const b = this.meta.bounds[this.worldId] || { min_x: -500, max_x: 500, min_z: -500, max_z: 500 };

    // Choose grid step based on scale
    let step = 100;
    if (this.scale > 2.0) step = 25;
    else if (this.scale > 0.8) step = 50;

    const isNether = this.worldId === 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = isNether ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.04)';
    ctx.fillStyle = isNether ? 'rgba(248, 113, 113, 0.5)' : 'rgba(148, 163, 184, 0.4)';
    ctx.font = '9px monospace';

    const startX = Math.floor(b.min_x / step) * step;
    const endX = Math.ceil(b.max_x / step) * step;
    const startZ = Math.floor(b.min_z / step) * step;
    const endZ = Math.ceil(b.max_z / step) * step;

    // Vertical lines (X constant)
    for (let x = startX; x <= endX; x += step) {
      const top = this.worldToScreen(x, b.min_z);
      const bottom = this.worldToScreen(x, b.max_z);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();

      if (top.y > 0 && top.y < this.canvas.height) {
        ctx.fillText(`${x}`, top.x + 2, Math.max(12, top.y + 10));
      }
    }

    // Horizontal lines (Z constant)
    for (let z = startZ; z <= endZ; z += step) {
      const left = this.worldToScreen(b.min_x, z);
      const right = this.worldToScreen(b.max_x, z);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();

      if (left.x > 0 && left.x < this.canvas.width) {
        ctx.fillText(`${z}`, Math.max(4, left.x + 4), left.y - 2);
      }
    }

    // Main Axes (X=0 and Z=0)
    const axisX = this.worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;

    // X=0
    ctx.beginPath();
    ctx.moveTo(axisX.x, 0);
    ctx.lineTo(axisX.x, this.canvas.height);
    ctx.stroke();

    // Z=0
    ctx.beginPath();
    ctx.moveTo(0, axisX.y);
    ctx.lineTo(this.canvas.width, axisX.y);
    ctx.stroke();
  }

  renderBases() {
    const ctx = this.ctx;
    if (!this.meta || !this.meta.bases) return;
    const t = this.currentTime;

    for (const base of this.meta.bases) {
      const p = this.worldToScreen(base.x, base.z);
      const r = (base.radius || 15) * this.scale;
      const color = base.color || '#64748b';

      // Outer glow circle
      ctx.fillStyle = `${color}18`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Border circle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      // Base Flag Icon & Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🏰 Base ${base.team.toUpperCase()}`, p.x, p.y - r - 6);

      // Coordinates
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '9px monospace';
      ctx.fillText(`(${base.x}, ${base.z})`, p.x, p.y - r + 6);

      // 1. Chest Room Render if enabled
      if (this.layers.chests && base.chest_room) {
        const cr = this.worldToScreen(base.chest_room.x, base.chest_room.z);

        // Chest room zone highlight
        ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cr.x, cr.y, 9 * this.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Chest Room Icon & Tag
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('📦 Coffres', cr.x, cr.y - 11);
      }

      // 2. Live Alerts: Enemy Chest Looting (active in last 30 seconds)
      if (this.events.chest_loots) {
        const recentLoot = this.events.chest_loots.find(l =>
          l.base_team === base.team && (t - l.time >= 0 && t - l.time <= 30)
        );
        if (recentLoot) {
          const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
          const alertRadius = r + 12 + pulse * 14;
          ctx.strokeStyle = `rgba(239, 68, 68, ${0.85 - pulse * 0.4})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, alertRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Banner
          ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
          const alertText = `🚨 PILLAGE COFFRES (${recentLoot.looter_team?.toUpperCase() || 'ENNEMI'}) !`;
          ctx.font = 'bold 11px sans-serif';
          const txtW = ctx.measureText(alertText).width;
          ctx.fillRect(p.x - txtW / 2 - 8, p.y + r + 10, txtW + 16, 20);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(alertText, p.x, p.y + r + 24);
        }
      }

      // 3. Live Alerts: Wall Breach (TNT explosion in base territory in last 25s)
      if (this.events.breaches) {
        const recentBreach = this.events.breaches.find(br =>
          br.team === base.team && (t - br.time >= 0 && t - br.time <= 25)
        );
        if (recentBreach) {
          const bp = this.worldToScreen(recentBreach.x, recentBreach.z);
          ctx.strokeStyle = '#eab308';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(bp.x, bp.y, 14 * this.scale, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 10px sans-serif';
          ctx.fillStyle = '#fef08a';
          ctx.fillText('💥 BRÈCHE !', bp.x, bp.y - 12);
        }
      }
    }
  }

  renderPlacedBlocks() {
    const ctx = this.ctx;
    const t = this.currentTime;
    const blockSize = Math.max(1.5, Math.round(1 * this.scale));

    if (!this.placedBlocks || this.placedBlocks.length === 0) return;

    // 1. Binary search upper bound where firstTime <= t
    let low = 0;
    let high = this.placedBlocks.length - 1;
    let maxIdx = -1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.placedBlocks[mid][3] <= t) {
        maxIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (maxIdx === -1) return;

    // 2. Viewport culling bounding box in world coordinates
    const pad = 10;
    const minWorldX = (0 - this.offsetX) / this.scale - pad;
    const maxWorldX = (this.canvas.width - this.offsetX) / this.scale + pad;
    const minWorldZ = (0 - this.offsetY) / this.scale - pad;
    const maxWorldZ = (this.canvas.height - this.offsetY) / this.scale + pad;

    // 3. Batch coordinates by block category to minimize canvas state switches
    const buckets = {
      stone: [],
      wood: [],
      water: [],
      tnt: [],
      chest: [],
      other: []
    };

    const yFilter = this.yFilter;
    const blocks = this.placedBlocks;

    for (let i = 0; i <= maxIdx; i++) {
      const b = blocks[i];
      const x = b[0];
      const z = b[1];

      // Viewport culling
      if (x < minWorldX || x > maxWorldX || z < minWorldZ || z > maxWorldZ) continue;

      const y = b[2];
      // Altitude Y filter
      if (yFilter === 'surface' && y <= 55) continue;
      if (yFilter === 'mines' && y > 55) continue;

      const p = this.worldToScreen(x, z);
      const px = p.x - blockSize / 2;
      const py = p.y - blockSize / 2;
      const mat = b[4];

      if (mat.includes('cobblestone') || mat.includes('stone')) {
        buckets.stone.push(px, py);
      } else if (mat.includes('wood') || mat.includes('plank') || mat.includes('log')) {
        buckets.wood.push(px, py);
      } else if (mat.includes('water')) {
        buckets.water.push(px, py);
      } else if (mat.includes('tnt')) {
        buckets.tnt.push(px, py);
      } else if (mat.includes('chest')) {
        buckets.chest.push(px, py);
      } else {
        buckets.other.push(px, py);
      }
    }

    // 4. Fast batch drawing per category
    const colors = {
      stone: '#94a3b8',
      wood: '#b45309',
      water: 'rgba(56, 189, 248, 0.6)',
      tnt: '#ef4444',
      chest: '#f59e0b',
      other: '#64748b'
    };

    for (const [key, coords] of Object.entries(buckets)) {
      if (coords.length === 0) continue;
      ctx.fillStyle = colors[key];
      ctx.beginPath();
      for (let j = 0; j < coords.length; j += 2) {
        ctx.rect(coords[j], coords[j + 1], blockSize, blockSize);
      }
      ctx.fill();
    }
  }

  renderExplosions() {
    const ctx = this.ctx;
    const t = this.currentTime;
    const duration = 4; // 4 seconds visible

    for (const exp of this.events.explosions) {
      const dt = t - exp.time;
      if (dt >= 0 && dt <= duration) {
        const progress = dt / duration;
        const p = this.worldToScreen(exp.x, exp.z);

        // Dynamically scale max shockwave based on explosion magnitude
        const maxR = exp.blocks ? Math.min(65, 20 + Math.sqrt(exp.blocks) * 1.8) : 25;
        const radius = (8 + progress * maxR) * this.scale;
        const alpha = Math.max(0, 1 - progress);

        // Shockwave
        ctx.strokeStyle = exp.type === 'tnt' ? `rgba(239, 68, 68, ${alpha})` : `rgba(34, 197, 94, ${alpha})`;
        ctx.lineWidth = exp.blocks && exp.blocks > 100 ? 4 : 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner flash
        if (progress < 0.35) {
          const flashAlpha = alpha * (exp.blocks && exp.blocks > 50 ? 0.9 : 0.65);
          ctx.fillStyle = exp.type === 'tnt' ? `rgba(254, 240, 138, ${flashAlpha})` : `rgba(187, 247, 208, ${flashAlpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Icon
        ctx.font = `${Math.round(14 * this.scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(exp.type === 'tnt' ? '💥' : '💣', p.x, p.y + 5);

        // Player name tag if attributed
        if (exp.user && !exp.user.startsWith('#') && progress < 0.7) {
          ctx.font = `bold ${Math.max(10, Math.round(11 * this.scale))}px sans-serif`;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
          ctx.fillText(exp.user, p.x, p.y - radius - 3);
        }
      }
    }
  }

  renderDeaths() {
    const ctx = this.ctx;
    const t = this.currentTime;
    const visibleDuration = 60; // Death skull visible for 60 seconds

    for (const d of this.events.deaths) {
      const dt = t - d.time;
      if (dt >= 0 && dt <= visibleDuration) {
        const alpha = Math.max(0.2, 1 - dt / visibleDuration);
        const p = this.worldToScreen(d.x, d.z);

        // Skull icon
        ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('💀', p.x, p.y);

        // Victim text
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(d.victim, p.x, p.y + 12);
      }
    }
  }

  renderPlayers() {
    const ctx = this.ctx;
    const t = this.currentTime;

    // Collect positions for all players
    const currentPositions = {};
    for (const player of this.meta.players) {
      const pos = this.calculatePlayerPosition(player.id, t);
      if (pos) {
        currentPositions[player.id] = pos;
      }
    }

    // 1. Draw Trails (last 30 seconds)
    if (this.layers.trails) {
      for (const [playerId, pos] of Object.entries(currentPositions)) {
        const trail = this.getPlayerTrail(parseInt(playerId), t, 30);
        if (trail.length > 1) {
          const pData = this.playersById[playerId];
          const color = pData ? pData.team_color : '#3b82f6';

          ctx.strokeStyle = `${color}88`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          const firstP = this.worldToScreen(trail[0].x, trail[0].z);
          ctx.moveTo(firstP.x, firstP.y);

          for (let i = 1; i < trail.length; i++) {
            const sp = this.worldToScreen(trail[i].x, trail[i].z);
            ctx.lineTo(sp.x, sp.y);
          }
          ctx.stroke();
        }
      }
    }

    // 2. Draw Player Avatars and Badges
    for (const [playerId, pos] of Object.entries(currentPositions)) {
      const player = this.playersById[playerId];
      if (!player) continue;

      // Altitude Y filter
      if (this.yFilter === 'surface' && pos.y <= 55) continue;
      if (this.yFilter === 'mines' && pos.y > 55) continue;

      const p = this.worldToScreen(pos.x, pos.z);
      const isHovered = this.hoveredPlayer && this.hoveredPlayer.id === player.id;
      const isFollowed = this.followPlayerId === player.id;

      // Generous size for clear visibility at all zoom levels
      const headRadius = isHovered || isFollowed ? 20 : 15;
      const teamColor = player.team_color || '#3b82f6';
      const isMines = pos.y < 55;
      const isHighAltitude = pos.y > 85;

      ctx.save();

      // If in caves / mines, reduce opacity to suggest subterranean depth
      if (isMines) {
        ctx.globalAlpha = 0.72;
      }

      // 1. Large Glowing Team Halo / Aura
      ctx.save();
      ctx.fillStyle = `${teamColor}40`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, headRadius + 7, 0, Math.PI * 2);
      ctx.fill();

      // Outer vibrant team border
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = isHovered || isFollowed ? 4.5 : 3.5;
      ctx.shadowColor = isHighAltitude ? 'rgba(0, 0, 0, 0.8)' : teamColor;
      ctx.shadowBlur = isHovered || isFollowed ? 14 : (isHighAltitude ? 12 : 8);
      if (isHighAltitude) {
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 6;
      }
      ctx.beginPath();
      if (isMines) {
        ctx.setLineDash([4, 2]); // Dashed border for miners underground
      }
      ctx.arc(p.x, p.y, headRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 2. Avatar head inside
      const img = this.avatarImages[player.id];
      if (img && img.complete) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, headRadius - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, p.x - headRadius + 2, p.y - headRadius + 2, (headRadius - 2) * 2, (headRadius - 2) * 2);
        ctx.restore();
      } else {
        // Fallback colored circle
        ctx.fillStyle = teamColor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, headRadius - 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Small Team Pointer Chevron below avatar
      ctx.fillStyle = teamColor;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y + headRadius + 2);
      ctx.lineTo(p.x + 5, p.y + headRadius + 2);
      ctx.lineTo(p.x, p.y + headRadius + 8);
      ctx.closePath();
      ctx.fill();

      // 4. Action Indicator (blip when placing/breaking blocks)
      if (pos.lastActionTime && t - pos.lastActionTime <= 2.5) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, headRadius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 5. Altitude Icon Badge (⛏️ for mines, 🪶 for high towers)
      if (isMines || isHighAltitude) {
        ctx.font = 'bold 9px sans-serif';
        const altText = isMines ? `⛏️ ${Math.round(pos.y)}` : `🪶 ${Math.round(pos.y)}`;
        const altW = ctx.measureText(altText).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(p.x + headRadius - 4, p.y - headRadius - 2, altW + 6, 13);
        ctx.fillStyle = isMines ? '#38bdf8' : '#fbbf24';
        ctx.fillText(altText, p.x + headRadius - 1, p.y - headRadius + 8);
      }

      // 6. Team & Player Name Badge
      if (this.layers.names) {
        ctx.font = 'bold 11px sans-serif';
        const teamLabel = player.team && player.team !== 'neutral' ? player.team.toUpperCase() : '';
        const fullText = teamLabel ? `[${teamLabel}] ${player.name}` : player.name;
        const textWidth = ctx.measureText(fullText).width;
        const badgeWidth = textWidth + 14;
        const badgeHeight = 17;
        const badgeY = p.y - headRadius - badgeHeight - 4;

        // Dark background with team colored border
        ctx.fillStyle = 'rgba(11, 15, 25, 0.92)';
        ctx.beginPath();
        ctx.roundRect(p.x - badgeWidth / 2, badgeY, badgeWidth, badgeHeight, 4);
        ctx.fill();

        ctx.strokeStyle = teamColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Team Colored Dot
        ctx.fillStyle = teamColor;
        ctx.beginPath();
        ctx.arc(p.x - textWidth / 2 - 1, badgeY + badgeHeight / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Name text
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(fullText, p.x + 4, badgeY + badgeHeight - 4.5);
      }

      ctx.restore();
    }
  }

  // Calculate interpolated player position at time t
  calculatePlayerPosition(playerId, t) {
    const points = this.playerTrajectories ? this.playerTrajectories.get(playerId) : null;
    if (!points || points.length === 0) return null;

    // Strict Dimension Presence Verification:
    // If player_dimensions metadata is available, verify the player is in this.worldId at time t.
    // If not present in this dimension or logged off, NEVER display them (not even static).
    const presenceSpans = this.meta?.player_dimensions?.[playerId];
    if (presenceSpans && presenceSpans.length > 0) {
      let activeSpan = null;
      for (let i = 0; i < presenceSpans.length; i++) {
        const s = presenceSpans[i];
        if (t >= s.start && t <= s.end) {
          activeSpan = s;
          break;
        }
      }
      if (!activeSpan || activeSpan.wid !== this.worldId) {
        return null;
      }
    } else {
      // Fallback if no dimension metadata: hide if outside recorded point bounds
      if (t < points[0][0] || t > points[points.length - 1][0] + 30) {
        return null;
      }
    }

    // Binary search for closest points around t in this world
    let low = 0;
    let high = points.length - 1;
    let idx = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (points[mid][0] <= t) {
        idx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (idx === -1) {
      // t is before the first recorded point in this world
      const first = points[0];
      if (first[0] - t <= 30) {
        return { x: first[2], y: first[3], z: first[4], lastActionTime: first[0] };
      }
      return null;
    }

    const prev = points[idx];
    if (idx === points.length - 1) {
      // t is after the last recorded point in this world
      // Stationary at last known position while still within active dimension span
      return { x: prev[2], y: prev[3], z: prev[4], lastActionTime: prev[0] };
    }

    const next = points[idx + 1];
    const timeGap = next[0] - prev[0];

    // If gap between points is short (< 20 seconds), linearly interpolate
    if (timeGap > 0 && timeGap <= 20) {
      const alpha = (t - prev[0]) / timeGap;
      return {
        x: prev[2] + (next[2] - prev[2]) * alpha,
        y: prev[3] + (next[3] - prev[3]) * alpha,
        z: prev[4] + (next[4] - prev[4]) * alpha,
        lastActionTime: prev[0]
      };
    }

    // Otherwise stationary at previous point
    return { x: prev[2], y: prev[3], z: prev[4], lastActionTime: prev[0] };
  }

  // Get trail points for the last durationSeconds
  getPlayerTrail(playerId, t, durationSeconds = 30) {
    const start = t - durationSeconds;
    const allPts = this.playerTrajectories ? this.playerTrajectories.get(playerId) : null;
    if (!allPts || allPts.length === 0) return [];
    const points = allPts.filter(p => p[0] >= start && p[0] <= t);
    return points.map(p => ({ x: p[2], z: p[4] }));
  }

  checkPlayerHover(clientX, clientY) {
    const t = this.currentTime;
    let found = null;

    for (const player of this.meta.players) {
      const pos = this.calculatePlayerPosition(player.id, t);
      if (pos) {
        const p = this.worldToScreen(pos.x, pos.z);
        const dist = Math.hypot(clientX - p.x, clientY - p.y);
        if (dist <= 16) {
          found = { ...player, currentPos: pos, screenPos: p };
          break;
        }
      }
    }

    this.hoveredPlayer = found;
    const tooltip = document.getElementById('canvas-tooltip');
    if (!tooltip) return;

    if (found) {
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${found.screenPos.x}px`;
      tooltip.style.top = `${found.screenPos.y - 14}px`;
      tooltip.innerHTML = `
        <div style="font-weight: 800; color: ${found.team_color}; font-size: 13px;">${found.name}</div>
        <div style="color: #94a3b8; font-size: 10px;">Équipe : <strong>${found.team.toUpperCase()}</strong></div>
        <div style="color: #cbd5e1; font-family: monospace; font-size: 10px; margin-top: 2px;">
          X: ${Math.round(found.currentPos.x)} | Y: ${Math.round(found.currentPos.y)} | Z: ${Math.round(found.currentPos.z)}
        </div>
      `;
    } else {
      tooltip.classList.add('hidden');
    }
  }
}

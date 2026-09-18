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
    this.events = { deaths: [], chats: [], explosions: [] };
    this.playersById = {};

    // Playback state
    this.currentTime = 0;
    this.followPlayerId = null;

    // Layer visibility
    this.layers = {
      bases: true,
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
    this.placedBlocks = placedBlocks || [];
    this.events = events || { deaths: [], chats: [], explosions: [] };

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

    // Preload custom map if present
    if (this.worldId === 1 && meta && meta.has_custom_map && meta.custom_map_url) {
      this.customMapLoaded = false;
      this.customMapImage = new Image();
      this.customMapImage.onload = () => {
        this.customMapLoaded = true;
      };
      this.customMapImage.onerror = () => {
        console.warn('[MapRenderer] Échec du chargement de la carte custom :', meta.custom_map_url);
        this.customMapLoaded = false;
      };
      this.customMapImage.src = meta.custom_map_url;
    } else if (this.worldId === 2 && meta && meta.has_nether_map && meta.custom_nether_map_url) {
      this.customMapLoaded = false;
      this.customMapImage = new Image();
      this.customMapImage.onload = () => {
        this.customMapLoaded = true;
      };
      this.customMapImage.onerror = () => {
        console.warn('[MapRenderer] Échec du chargement de la carte nether custom :', meta.custom_nether_map_url);
        this.customMapLoaded = false;
      };
      this.customMapImage.src = meta.custom_nether_map_url;
    } else {
      this.customMapImage = null;
      this.customMapLoaded = false;
    }

    // Initial center on bases or 0,0
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
    const b = (this.worldId === 1 && this.customMapLoaded && this.meta.map_bounds)
      ? this.meta.map_bounds
      : (this.meta.bounds[this.worldId] || { min_x: -500, max_x: 500, min_z: -500, max_z: 500 });

    if (this.worldId === 1 && this.customMapLoaded && this.customMapImage) {
      const p1 = this.worldToScreen(b.min_x, b.min_z);
      const p2 = this.worldToScreen(b.max_x, b.max_z);
      ctx.drawImage(this.customMapImage, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    } else if (this.worldId === 2) {
      // Atmospheric Nether procedural background
      const p1 = this.worldToScreen(b.min_x, b.min_z);
      const p2 = this.worldToScreen(b.max_x, b.max_z);

      const grad = ctx.createRadialGradient(
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 20,
        (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, Math.max(p2.x - p1.x, p2.y - p1.y) / 1.4
      );
      grad.addColorStop(0, '#2d0a0a');
      grad.addColorStop(0.6, '#1a0404');
      grad.addColorStop(1, '#0c0202');
      ctx.fillStyle = grad;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

      // Arena border in glowing red
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

      // Central Nether Portal (0,0)
      const center = this.worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 40 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Procedural tactical background
      const p1 = this.worldToScreen(b.min_x, b.min_z);
      const p2 = this.worldToScreen(b.max_x, b.max_z);

      // Arena border
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);

      // Center (0,0) Spawn Circle
      const center = this.worldToScreen(0, 0);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.arc(center.x, center.y, 40 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
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
    if (!this.meta.bases) return;

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
    }
  }

  renderPlacedBlocks() {
    const ctx = this.ctx;
    const t = this.currentTime;
    const blockSize = Math.max(1.5, Math.round(1 * this.scale));

    for (const b of this.placedBlocks) {
      // b = [x, z, y, first_time, material, user_id]
      const [x, z, y, firstTime, mat] = b;
      if (firstTime > t) continue;

      const p = this.worldToScreen(x, z);

      // Color coding for Minecraft blocks
      if (mat.includes('cobblestone') || mat.includes('stone')) {
        ctx.fillStyle = '#94a3b8';
      } else if (mat.includes('wood') || mat.includes('plank') || mat.includes('log')) {
        ctx.fillStyle = '#b45309';
      } else if (mat.includes('water')) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
      } else if (mat.includes('tnt')) {
        ctx.fillStyle = '#ef4444';
      } else if (mat.includes('chest')) {
        ctx.fillStyle = '#f59e0b';
      } else {
        ctx.fillStyle = '#64748b';
      }

      ctx.fillRect(p.x - blockSize / 2, p.y - blockSize / 2, blockSize, blockSize);
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

      const p = this.worldToScreen(pos.x, pos.z);
      const isHovered = this.hoveredPlayer && this.hoveredPlayer.id === player.id;
      const isFollowed = this.followPlayerId === player.id;

      // Generous size for clear visibility at all zoom levels
      const headRadius = isHovered || isFollowed ? 20 : 15;
      const teamColor = player.team_color || '#3b82f6';

      // 1. Large Glowing Team Halo / Aura
      ctx.save();
      ctx.fillStyle = `${teamColor}40`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, headRadius + 7, 0, Math.PI * 2);
      ctx.fill();

      // Outer vibrant team border
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = isHovered || isFollowed ? 4.5 : 3.5;
      ctx.shadowColor = teamColor;
      ctx.shadowBlur = isHovered || isFollowed ? 14 : 8;
      ctx.beginPath();
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

      // 5. Team & Player Name Badge
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

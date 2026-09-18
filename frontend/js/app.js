/**
 * Main Application Orchestrator for Fallen Kingdoms Replay
 */

import { MapRenderer } from './map_renderer.js';
import { TimelinePlayer } from './timeline.js';
import { StatsPanel } from './stats_panel.js';
import { ChartsEngine } from './charts.js';

class App {
  constructor() {
    this.currentDb = null;
    this.currentWorld = 1; // 1 = Overworld, 2 = Nether
    this.meta = null;

    // Sub-systems
    this.renderer = null;
    this.timeline = null;
    this.stats = null;
    this.charts = null;

    this.init();
  }

  async init() {
    this.initUI();
    await this.loadDatabases();
    this.startAnimationLoop();
  }

  initUI() {
    // Canvas Setup
    const canvas = document.getElementById('map-canvas');
    this.renderer = new MapRenderer(canvas, {
      onHoverCoords: (x, z, zoom) => {
        const hudX = document.getElementById('hud-x');
        const hudZ = document.getElementById('hud-z');
        const hudZoom = document.getElementById('hud-zoom');
        if (hudX) hudX.innerText = x;
        if (hudZ) hudZ.innerText = z;
        if (hudZoom) hudZoom.innerText = `${zoom}%`;
      },
      onPlayerClick: (player) => {
        this.selectPlayer(player);
      }
    });

    // Timeline Setup
    this.timeline = new TimelinePlayer({
      onTick: (currentTime) => {
        this.renderer.setTime(currentTime);
        this.stats.updateTime(currentTime);
        this.charts?.setTime(currentTime);
      },
      onPlayStateChange: (isPlaying) => {
        // Can add state indicators if needed
      }
    });

    // Stats Panel Setup
    this.stats = new StatsPanel({
      onSelectPlayer: (player) => {
        this.selectPlayer(player);
      },
      onSeekTime: (targetTime) => {
        this.timeline.seek(targetTime);
      }
    });

    // Charts Setup
    const chartCanvas = document.getElementById('analytics-canvas');
    if (chartCanvas) {
      this.charts = new ChartsEngine(chartCanvas, {
        onSeekTime: (targetTime) => {
          this.timeline.seek(targetTime);
        }
      });
    }

    // Metric selector buttons
    const metricButtons = document.querySelectorAll('.btn-metric');
    metricButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        metricButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const metric = btn.getAttribute('data-metric');
        this.charts?.setMetric(metric);
      });
    });

    // Navigation Tabs
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        navTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetId = `view-${tab.getAttribute('data-tab').replace('-view', '')}`;
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(targetId)?.classList.add('active');

        // Resize canvas if returning to map tab or charts tab
        if (targetId === 'view-map') {
          setTimeout(() => this.renderer.resizeCanvas(), 50);
        } else if (targetId === 'view-charts') {
          setTimeout(() => this.charts?.resize(), 50);
        }
      });
    });

    // Sidebar Sub-Tabs
    const sideTabs = document.querySelectorAll('.side-tab');
    sideTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        sideTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetId = tab.getAttribute('data-sidetab');
        document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
        document.getElementById(targetId)?.classList.add('active');
      });
    });

    // Toggle Sidebar collapse
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar-panel');
      sidebar.classList.toggle('collapsed');
      setTimeout(() => this.renderer.resizeCanvas(), 300);
    });

    // World toggle buttons (Overworld / Nether)
    const worldBtns = document.querySelectorAll('.world-btn');
    worldBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        worldBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const wid = parseInt(btn.getAttribute('data-world')) || 1;
        this.switchWorld(wid);
      });
    });

    // Canvas HUD Zoom buttons
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.renderer.scale = Math.min(8.0, this.renderer.scale * 1.25);
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.renderer.scale = Math.max(0.15, this.renderer.scale * 0.8);
    });
    document.getElementById('btn-center-map')?.addEventListener('click', () => {
      this.renderer.centerOn(0, 0);
    });
    document.getElementById('btn-fit-map')?.addEventListener('click', () => {
      this.renderer.fitBounds();
    });

    // Layers dropdown toggle
    const layersBtn = document.getElementById('btn-toggle-layers');
    const layersPanel = document.getElementById('layers-panel');
    layersBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      layersPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!layersPanel.contains(e.target) && e.target !== layersBtn) {
        layersPanel.classList.add('hidden');
      }
    });

    // Layer checkboxes
    const bindLayer = (id, key) => {
      const cb = document.getElementById(id);
      if (cb) {
        cb.addEventListener('change', (e) => {
          this.renderer.layers[key] = e.target.checked;
        });
      }
    };
    bindLayer('layer-bases', 'bases');
    bindLayer('layer-blocks', 'blocks');
    bindLayer('layer-players', 'players');
    bindLayer('layer-names', 'names');
    bindLayer('layer-trails', 'trails');
    bindLayer('layer-kills', 'kills');
    bindLayer('layer-explosions', 'explosions');
    bindLayer('layer-grid', 'grid');

    // Unfollow button
    document.getElementById('btn-unfollow')?.addEventListener('click', () => {
      this.unfollowPlayer();
    });
    this.renderer.onUnfollow = () => {
      document.getElementById('follow-indicator')?.classList.add('hidden');
    };

    // Database select dropdown
    const dbSelect = document.getElementById('db-select');
    dbSelect?.addEventListener('change', (e) => {
      this.loadDatabaseData(e.target.value);
    });

    // Upload DB file
    const uploadDbBtn = document.getElementById('btn-upload-db');
    const inputDbFile = document.getElementById('input-upload-db-file');
    uploadDbBtn?.addEventListener('click', () => inputDbFile.click());
    inputDbFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        uploadDbBtn.innerText = '⏳ Envoi...';
        const res = await fetch('/api/upload-database', {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error('Échec upload BDD');
        const data = await res.json();
        alert(`Base de données "${file.name}" importée avec succès !`);
        await this.loadDatabases(file.name);
      } catch (err) {
        alert('Erreur lors du téléversement : ' + err.message);
      } finally {
        uploadDbBtn.innerText = '➕ BDD';
      }
    });

    // Upload Map PNG file
    const uploadMapBtn = document.getElementById('btn-upload-map');
    const inputMapFile = document.getElementById('input-upload-map-file');
    uploadMapBtn?.addEventListener('click', () => inputMapFile.click());
    inputMapFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('file', file);

      try {
        uploadMapBtn.innerText = '⏳ Envoi...';
        const res = await fetch(`/api/upload-map?db=${encodeURIComponent(this.currentDb || '')}`, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error('Échec upload carte');
        alert('Carte importée avec succès !');
        // Reload current db to refresh custom map image
        await this.loadDatabaseData(this.currentDb);
      } catch (err) {
        alert('Erreur upload carte : ' + err.message);
      } finally {
        uploadMapBtn.innerText = 'Charger map.png';
      }
    });

    // Regenerate Map from region/*.mca files
    const handleRegenerateMap = async () => {
      const btn = document.getElementById('btn-regenerate-map');
      const hudBtn = document.getElementById('btn-hud-regenerate-map');
      const origText = btn ? btn.innerText : '';
      const origHud = hudBtn ? hudBtn.innerText : '';

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerText = '⏳ Rendu...';
        }
        if (hudBtn) {
          hudBtn.disabled = true;
          hudBtn.innerText = '⏳';
        }

        const res = await fetch(`/api/regenerate-map?db=${encodeURIComponent(this.currentDb || '')}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Erreur lors de la régénération');
        }

        const mapUrl = `/api/map-image?db=${encodeURIComponent(this.currentDb || '')}&t=${Date.now()}`;
        this.renderer.reloadCustomMap(mapUrl, data.bounds);

        const mapLabel = document.getElementById('custom-map-label');
        if (mapLabel) {
          mapLabel.innerText = 'Fond : Image PNG personnalisée';
        }

        alert(data.message || 'Carte regénérée avec succès !');
      } catch (err) {
        alert('Erreur régénération carte : ' + err.message);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = origText || '🔄 Regénérer';
        }
        if (hudBtn) {
          hudBtn.disabled = false;
          hudBtn.innerText = origHud || '🗺️';
        }
      }
    };

    document.getElementById('btn-regenerate-map')?.addEventListener('click', handleRegenerateMap);
    document.getElementById('btn-hud-regenerate-map')?.addEventListener('click', handleRegenerateMap);
  }

  async loadDatabases(selectDbName = null) {
    try {
      const res = await fetch('/api/databases');
      if (!res.ok) throw new Error('Failed to list databases');
      const data = await res.json();
      const dbs = data.databases || [];

      const sel = document.getElementById('db-select');
      if (!sel) return;

      sel.innerHTML = '';
      if (dbs.length === 0) {
        sel.innerHTML = '<option value="">Aucune base trouvée</option>';
        return;
      }

      for (const d of dbs) {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.innerText = `${d.name} (${d.size_mb} Mo)`;
        sel.appendChild(opt);
      }

      // Choose initial DB
      const targetDb = selectDbName || (dbs[0] ? dbs[0].name : 'database.db');
      sel.value = targetDb;
      await this.loadDatabaseData(targetDb);
    } catch (err) {
      console.error('Error loading databases:', err);
    }
  }

  async loadDatabaseData(dbName) {
    this.currentDb = dbName;
    console.log(`[FK Replay] Chargement des données pour ${dbName}...`);

    try {
      // 1. Fetch metadata
      const metaRes = await fetch(`/api/meta?db=${encodeURIComponent(dbName)}`);
      if (!metaRes.ok) throw new Error('Meta query failed');
      this.meta = await metaRes.json();

      // Update custom map label
      const mapLabel = document.getElementById('custom-map-label');
      if (mapLabel) {
        mapLabel.innerText = this.meta.has_custom_map ? 'Fond : Image PNG personnalisée' : 'Fond : Procédural';
      }

      // 2. Fetch match events (kills, chats, explosions)
      const evRes = await fetch(`/api/events?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`);
      const events = evRes.ok ? await evRes.json() : { deaths: [], chats: [], explosions: [] };

      // 3. Fetch player trajectories
      const trajRes = await fetch(`/api/trajectories?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`);
      const trajData = trajRes.ok ? await trajRes.json() : { points: [] };

      // 4. Fetch placed blocks
      const blocksRes = await fetch(`/api/placed-blocks?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`);
      const blocksData = blocksRes.ok ? await blocksRes.json() : { blocks: [] };

      // Initialize components
      this.renderer.setData({
        meta: this.meta,
        trajectories: trajData.points || [],
        placedBlocks: blocksData.blocks || [],
        events: events,
        worldId: this.currentWorld
      });

      this.timeline.setRange({
        minTime: this.meta.time_range.min_time,
        maxTime: this.meta.time_range.max_time,
        matchStart: this.meta.time_range.match_start,
        matchStop: this.meta.time_range.match_stop,
        halfPlayersTime: this.meta.time_range.half_players_time,
        defaultStartTime: this.meta.time_range.default_start_time,
        hasExplicitStart: this.meta.time_range.has_explicit_start,
        milestones: this.meta.milestones || []
      });

      this.stats.setData({
        meta: this.meta,
        events: events,
        currentDb: this.currentDb
      });

      // 5. Fetch Analytics for Charts
      try {
        const anaRes = await fetch(`/api/analytics?db=${encodeURIComponent(dbName)}&bucket=60`);
        if (anaRes.ok) {
          const anaData = await anaRes.json();
          this.charts?.setData(anaData);
          this.renderChartsLegend(anaData.teams);
        }
      } catch (err) {
        console.warn('[App] Erreur chargement analytics:', err);
      }

      // Trigger initial stats calculation at current time
      this.renderer.setTime(this.timeline.currentTime);
      this.stats.updateTime(this.timeline.currentTime, true);
      this.charts?.setTime(this.timeline.currentTime);

      console.log(`[FK Replay] Prêt ! ${trajData.count || 0} points trajectoires, ${blocksData.count || 0} blocs.`);
    } catch (err) {
      console.error('Erreur chargement BDD:', err);
      alert('Erreur lors du chargement des données : ' + err.message);
    }
  }

  renderChartsLegend(teams) {
    const container = document.getElementById('charts-team-legend');
    if (!container || !teams) return;
    container.innerHTML = '';

    for (const t of teams) {
      const btn = document.createElement('button');
      btn.className = 'chart-team-pill active';
      btn.style.borderColor = t.color;
      btn.style.color = '#ffffff';
      btn.style.backgroundColor = `${t.color}33`;
      btn.innerHTML = `<span class="team-dot" style="background: ${t.color}"></span> Équipe ${t.label || t.name}`;

      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const isActive = btn.classList.contains('active');
        btn.style.opacity = isActive ? '1' : '0.4';
        btn.style.backgroundColor = isActive ? `${t.color}33` : 'transparent';
        this.charts?.toggleTeam(t.name);
      });

      container.appendChild(btn);
    }
  }

  async switchWorld(wid) {
    if (this.currentWorld === wid) return;
    this.currentWorld = wid;
    console.log(`[FK Replay] Changement de monde: World ${wid}`);

    // Update active button indicator
    document.querySelectorAll('.world-btn').forEach(btn => {
      const bWid = parseInt(btn.getAttribute('data-world')) || 1;
      btn.classList.toggle('active', bWid === wid);
    });

    // Update map label for current world
    const mapLabel = document.getElementById('custom-map-label');
    if (mapLabel) {
      if (this.currentWorld === 2) {
        mapLabel.innerText = this.meta?.has_nether_map ? 'Fond : Nether PNG personnalisé' : 'Fond : Nether (Procédural)';
      } else {
        mapLabel.innerText = this.meta?.has_custom_map ? 'Fond : Image PNG personnalisée' : 'Fond : Procédural';
      }
    }

    // Save exact timeline cursor position and playback state
    const savedTime = this.timeline.currentTime;
    const wasPlaying = this.timeline.isPlaying;
    if (wasPlaying) {
      this.timeline.pause();
    }

    try {
      const dbName = this.currentDb;
      const [evRes, trajRes, blocksRes] = await Promise.all([
        fetch(`/api/events?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`),
        fetch(`/api/trajectories?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`),
        fetch(`/api/placed-blocks?db=${encodeURIComponent(dbName)}&world=${this.currentWorld}`)
      ]);

      const events = evRes.ok ? await evRes.json() : { deaths: [], chats: [], explosions: [] };
      const trajData = trajRes.ok ? await trajRes.json() : { points: [] };
      const blocksData = blocksRes.ok ? await blocksRes.json() : { blocks: [] };

      // Update renderer with new world data
      this.renderer.setData({
        meta: this.meta,
        trajectories: trajData.points || [],
        placedBlocks: blocksData.blocks || [],
        events: events,
        worldId: this.currentWorld
      });

      // Update stats events
      this.stats.events = events;

      // Restore exact playback position without resetting timeline bounds
      this.renderer.setTime(savedTime);
      this.timeline.seek(savedTime);
      this.stats.updateTime(savedTime, true);
      this.charts?.setTime(savedTime);

      if (wasPlaying) {
        this.timeline.play();
      }
    } catch (err) {
      console.error('Erreur changement de monde:', err);
    }
  }

  selectPlayer(player) {
    this.renderer.followPlayerId = player.id;
    this.renderer.centerOn(player.currentPos ? player.currentPos.x : 0, player.currentPos ? player.currentPos.z : 0);

    const followIndicator = document.getElementById('follow-indicator');
    const followName = document.getElementById('follow-player-name');
    if (followIndicator && followName) {
      followName.innerText = player.name;
      followName.style.color = player.team_color;
      followIndicator.classList.remove('hidden');
    }
  }

  unfollowPlayer() {
    this.renderer.followPlayerId = null;
    document.getElementById('follow-indicator')?.classList.add('hidden');
  }

  startAnimationLoop() {
    const frame = () => {
      this.renderer.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

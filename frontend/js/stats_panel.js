/**
 * Live Stats, Leaderboard, Killfeed and Chat Manager
 */

export class StatsPanel {
  constructor(options = {}) {
    this.currentDb = null;
    this.meta = null;
    this.events = { deaths: [], chats: [], explosions: [] };

    this.selectedTeam = 'all';
    this.searchQuery = '';
    this.lastFetchedTime = 0;
    this.isFetching = false;

    // Callbacks
    this.onSelectPlayer = options.onSelectPlayer || (() => {});
    this.onSeekTime = options.onSeekTime || (() => {});

    // Mini sidebar elements
    this.miniDiamonds = document.getElementById('mini-diamonds');
    this.miniKills = document.getElementById('mini-kills');
    this.miniTnt = document.getElementById('mini-tnt');
    this.miniBlocks = document.getElementById('mini-blocks');
    this.sideLeaderboardList = document.getElementById('side-leaderboard-list');
    this.killfeedList = document.getElementById('killfeed-list');
    this.playersRoster = document.getElementById('players-roster');
    this.playerCount = document.getElementById('player-count');

    // Full Stats View elements
    this.kpiDiamonds = document.getElementById('kpi-diamonds');
    this.kpiIron = document.getElementById('kpi-iron');
    this.kpiGold = document.getElementById('kpi-gold');
    this.kpiKills = document.getElementById('kpi-kills');
    this.kpiDeaths = document.getElementById('kpi-deaths');
    this.kpiTnt = document.getElementById('kpi-tnt');
    this.kpiTntDetonated = document.getElementById('kpi-tnt-detonated');
    this.kpiBlocksPlaced = document.getElementById('kpi-blocks-placed');
    this.kpiBlocksBroken = document.getElementById('kpi-blocks-broken');
    this.fullLeaderboardBody = document.getElementById('full-leaderboard-body');

    // Sorting state
    this.sortField = 'score';
    this.sortDirection = 'desc'; // 'asc' or 'desc'
    this.lastData = null;

    // Chat View elements
    this.chatMessagesBox = document.getElementById('chat-messages-box');
    this.milestonesBox = document.getElementById('milestones-box');
    this.fullDeathsLog = document.getElementById('full-deaths-log');

    // PvP Duel Matrix & Recap elements
    this.teamMatrixWrapper = document.getElementById('team-matrix-wrapper');
    this.playerDuelsContainer = document.getElementById('player-duels-container');
    this.duelPlayerFilter = document.getElementById('duel-player-filter');
    this.duelMatrixData = null;
    this.recapData = null;

    this.initEvents();
  }

  initEvents() {
    // Recap modal setup
    this.initRecapModal();

    // Duel player filter
    this.duelPlayerFilter?.addEventListener('input', () => {
      this.renderDuelsTable();
    });

    // Sidebar team filter pills
    const pills = document.querySelectorAll('.team-pill');
    pills.forEach(p => {
      p.addEventListener('click', () => {
        pills.forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        this.selectedTeam = p.getAttribute('data-team') || 'all';

        // Sync with stats view select
        const sel = document.getElementById('stats-team-filter');
        if (sel) sel.value = this.selectedTeam;

        this.refreshStats(this.lastFetchedTime, true);
      });
    });

    // Full stats team filter
    const statsSel = document.getElementById('stats-team-filter');
    if (statsSel) {
      statsSel.addEventListener('change', (e) => {
        this.selectedTeam = e.target.value;
        // Sync with pills
        pills.forEach(x => {
          x.classList.toggle('active', x.getAttribute('data-team') === this.selectedTeam);
        });
        this.refreshStats(this.lastFetchedTime, true);
      });
    }

    // Player search input
    document.getElementById('player-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderPlayerRoster();
    });

    document.getElementById('stats-player-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      if (this.lastData) {
        this.renderFullLeaderboard(this.lastData.leaderboard);
      } else {
        this.refreshStats(this.lastFetchedTime, true);
      }
    });

    // Sortable table headers
    const sortableHeaders = document.querySelectorAll('#full-leaderboard-table th.sortable');
    sortableHeaders.forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        if (!field) return;

        if (this.sortField === field) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortField = field;
          this.sortDirection = (field === 'name' || field === 'team') ? 'asc' : 'desc';
        }

        this.updateSortHeaderIcons();
        if (this.lastData) {
          this.renderFullLeaderboard(this.lastData.leaderboard);
        }
      });
    });
    this.updateSortHeaderIcons();
  }

  setData({ meta, events, currentDb }) {
    this.meta = meta;
    this.events = events || { deaths: [], chats: [], explosions: [] };
    this.currentDb = currentDb;

    if (this.playerCount && meta.players) {
      this.playerCount.innerText = meta.players.length;
    }

    this.renderTeamFilters();
    this.renderMilestones();
    this.renderPlayerRoster();
    this.loadDuelMatrix();
  }

  renderTeamFilters() {
    if (!this.meta) return;

    // Collect all active teams from bases or players (excluding neutral)
    const teamsSet = new Map();
    if (this.meta.bases) {
      for (const b of this.meta.bases) {
        if (b.team && b.team !== 'neutral') {
          teamsSet.set(b.team, b.color || '#3b82f6');
        }
      }
    }
    if (this.meta.players) {
      for (const p of this.meta.players) {
        if (p.team && p.team !== 'neutral' && !teamsSet.has(p.team)) {
          teamsSet.set(p.team, p.team_color || '#3b82f6');
        }
      }
    }

    if (teamsSet.size === 0) return;

    const labels = {
      yellow: 'Jaune',
      purple: 'Violet',
      green: 'Vert',
      blue: 'Bleu',
      red: 'Rouge',
      cyan: 'Cyan',
      orange: 'Orange',
      pink: 'Rose'
    };

    // 1. Sidebar Team Filter Pills
    const pillsContainer = document.getElementById('team-filter-pills');
    if (pillsContainer) {
      pillsContainer.innerHTML = '';

      // "Tous" pill
      const allBtn = document.createElement('button');
      allBtn.className = `team-pill ${this.selectedTeam === 'all' ? 'active' : ''}`;
      allBtn.setAttribute('data-team', 'all');
      allBtn.textContent = 'Tous';
      allBtn.addEventListener('click', () => this.handleTeamSelect('all'));
      pillsContainer.appendChild(allBtn);

      for (const [tName, tColor] of teamsSet.entries()) {
        const btn = document.createElement('button');
        const isActive = this.selectedTeam === tName;
        btn.className = `team-pill pill-${tName} ${isActive ? 'active' : ''}`;
        btn.setAttribute('data-team', tName);
        btn.setAttribute('data-color', tColor);
        btn.textContent = labels[tName] || (tName.charAt(0).toUpperCase() + tName.slice(1));
        if (isActive) {
          btn.style.backgroundColor = tColor;
          btn.style.borderColor = tColor;
          btn.style.color = '#ffffff';
        }
        btn.addEventListener('click', () => this.handleTeamSelect(tName));
        pillsContainer.appendChild(btn);
      }
    }

    // 2. Full Stats Select Dropdown
    const sel = document.getElementById('stats-team-filter');
    if (sel) {
      sel.innerHTML = '<option value="all">Toutes les équipes</option>';
      for (const [tName] of teamsSet.entries()) {
        const opt = document.createElement('option');
        opt.value = tName;
        opt.textContent = `Équipe ${labels[tName] || (tName.charAt(0).toUpperCase() + tName.slice(1))}`;
        if (this.selectedTeam === tName) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = (e) => this.handleTeamSelect(e.target.value);
    }
  }

  handleTeamSelect(team) {
    this.selectedTeam = team;

    // Update pills active state and dynamic colors
    const pills = document.querySelectorAll('.team-pill');
    pills.forEach(x => {
      const pTeam = x.getAttribute('data-team') || 'all';
      const isActive = pTeam === team;
      x.classList.toggle('active', isActive);
      const color = x.getAttribute('data-color');
      if (isActive && color) {
        x.style.backgroundColor = color;
        x.style.borderColor = color;
        x.style.color = '#ffffff';
      } else if (!isActive && color) {
        x.style.backgroundColor = '';
        x.style.borderColor = '';
        x.style.color = '';
      }
    });

    // Update select dropdown
    const sel = document.getElementById('stats-team-filter');
    if (sel) sel.value = team;

    this.refreshStats(this.lastFetchedTime, true);
  }

  updateTime(t, forceFetch = false) {
    // Throttle backend fetch during playback (every 1 second or force)
    if (forceFetch || Math.abs(t - this.lastFetchedTime) >= 1.0) {
      this.refreshStats(t, forceFetch);
    }
    // Update live feeds synchronously with t
    this.updateKillfeed(t);
    this.updateChat(t);
  }

  async refreshStats(t, force = false) {
    if (this.isFetching && !force) return;
    this.isFetching = true;
    this.lastFetchedTime = t;

    try {
      const url = `/api/stats?db=${encodeURIComponent(this.currentDb || '')}&time=${Math.round(t)}&team=${this.selectedTeam}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Stats fetch failed');
      const data = await res.json();
      this.renderStats(data);
    } catch (err) {
      console.warn('Error fetching stats:', err);
    } finally {
      this.isFetching = false;
    }
  }

  renderStats(data) {
    this.lastData = data;
    const { totals, leaderboard } = data;

    // Filter leaderboard by search query if any
    let filteredLeaderboard = leaderboard;
    if (this.searchQuery) {
      filteredLeaderboard = leaderboard.filter(p => p.name.toLowerCase().includes(this.searchQuery));
    }

    // 1. Update Mini KPIs
    if (this.miniDiamonds) this.miniDiamonds.innerText = totals.diamonds;
    if (this.miniKills) this.miniKills.innerText = totals.kills;
    if (this.miniTnt) this.miniTnt.innerText = totals.tnt_placed;
    if (this.miniBlocks) this.miniBlocks.innerText = totals.blocks_placed;

    // 2. Update Full KPIs
    if (this.kpiDiamonds) this.kpiDiamonds.innerText = totals.diamonds;
    if (this.kpiIron) this.kpiIron.innerText = totals.iron;
    if (this.kpiGold) this.kpiGold.innerText = totals.gold;
    if (this.kpiKills) this.kpiKills.innerText = totals.kills;
    if (this.kpiDeaths) this.kpiDeaths.innerText = totals.deaths;
    if (this.kpiTnt) this.kpiTnt.innerText = totals.tnt_placed;
    if (this.kpiTntDetonated) this.kpiTntDetonated.innerText = totals.tnt_detonated || 0;
    if (this.kpiBlocksPlaced) this.kpiBlocksPlaced.innerText = totals.blocks_placed;
    if (this.kpiBlocksBroken) this.kpiBlocksBroken.innerText = totals.blocks_broken;

    // 3. Render Mini Sidebar Leaderboard (Top 10 by FK Score)
    if (this.sideLeaderboardList) {
      this.sideLeaderboardList.innerHTML = '';
      const top10ByScore = [...filteredLeaderboard].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
      top10ByScore.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'leader-item';
        item.style.borderLeftColor = p.team_color || '#3b82f6';
        item.innerHTML = `
          <div class="leader-player">
            <span style="font-weight: 700; color: #94a3b8; font-size: 11px;">#${idx + 1}</span>
            <img class="player-avatar-sm" src="${p.avatar_url}" alt="${p.name}">
            <span class="player-name-text">${p.name}</span>
          </div>
          <div class="leader-stats">
            <span class="stat-chip" title="Diamants minés">💎 ${p.diamonds}</span>
            <span class="stat-chip" title="Kills PvP">⚔️ ${p.kills}</span>
            <span class="stat-chip" title="Score FK" style="color: #fbbf24;">★ ${p.score}</span>
          </div>
        `;
        item.addEventListener('click', () => {
          if (this.meta && this.meta.players) {
            const playerObj = this.meta.players.find(x => x.name === p.name);
            if (playerObj) this.onSelectPlayer(playerObj);
          }
        });
        this.sideLeaderboardList.appendChild(item);
      });
    }

    // 4. Render Full Table with Current Sorting
    this.renderFullLeaderboard(leaderboard);
  }

  updateSortHeaderIcons() {
    const sortableHeaders = document.querySelectorAll('#full-leaderboard-table th.sortable');
    sortableHeaders.forEach(th => {
      const field = th.getAttribute('data-sort');
      const icon = th.querySelector('.sort-icon');
      if (field === this.sortField) {
        th.classList.add('sorted');
        th.classList.toggle('sorted-asc', this.sortDirection === 'asc');
        th.classList.toggle('sorted-desc', this.sortDirection === 'desc');
        if (icon) icon.textContent = this.sortDirection === 'asc' ? '▲' : '▼';
      } else {
        th.classList.remove('sorted', 'sorted-asc', 'sorted-desc');
        if (icon) icon.textContent = '⬍';
      }
    });
  }

  sortLeaderboard(list) {
    const field = this.sortField;
    const dir = this.sortDirection === 'asc' ? 1 : -1;

    return [...list].sort((a, b) => {
      let valA = a[field];
      let valB = b[field];

      if (typeof valA === 'string') {
        const cmp = (valA || '').localeCompare(valB || '', undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp * dir;
      } else {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        if (valA !== valB) return (valA - valB) * dir;
      }

      // Tie breaker: score descending, then name ascending
      const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  renderFullLeaderboard(leaderboard) {
    if (!this.fullLeaderboardBody) return;
    this.fullLeaderboardBody.innerHTML = '';

    let list = leaderboard || [];
    if (this.searchQuery) {
      list = list.filter(p => p.name.toLowerCase().includes(this.searchQuery));
    }

    const sortedList = this.sortLeaderboard(list);

    sortedList.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>#${idx + 1}</strong></td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <img class="player-avatar-sm" src="${p.avatar_url}" alt="${p.name}">
            <span style="font-weight: 700;">${p.name}</span>
          </div>
        </td>
        <td>
          <span class="roster-team-badge" style="background: ${p.team_color}22; color: ${p.team_color}; border: 1px solid ${p.team_color};">
            ${p.team.toUpperCase()}
          </span>
        </td>
        <td style="font-weight: 800; color: #fbbf24;">${p.score}</td>
        <td style="font-weight: 700; color: #38bdf8;">${p.diamonds}</td>
        <td>${p.iron}</td>
        <td>${p.gold}</td>
        <td style="color: #ef4444; font-weight: 700;">${p.kills}</td>
        <td style="color: #a855f7;">${p.deaths}</td>
        <td style="color: #f97316;">${p.tnt_placed}</td>
        <td style="color: #ea580c; font-weight: 700;">${p.tnt_detonated || 0}</td>
        <td style="color: #22c55e;">${p.blocks_placed}</td>
        <td style="color: #94a3b8;">${p.blocks_broken}</td>
        <td>
          <button class="btn btn-xs btn-outline btn-track-player" data-player="${p.name}">
            🎯 Suivre
          </button>
        </td>
      `;
      tr.querySelector('.btn-track-player').addEventListener('click', () => {
        const playerObj = this.meta.players.find(x => x.name === p.name);
        if (playerObj) {
          // Switch to map view tab and select player
          const mapTab = document.querySelector('.nav-tab[data-tab="map-view"]');
          if (mapTab) mapTab.click();
          this.onSelectPlayer(playerObj);
        }
      });
      this.fullLeaderboardBody.appendChild(tr);
    });
  }

  updateKillfeed(t) {
    if (!this.killfeedList) return;

    // Show kills up to t, most recent at top
    const pastDeaths = this.events.deaths.filter(d => d.time <= t).slice(-25).reverse();
    this.killfeedList.innerHTML = '';

    if (pastDeaths.length === 0) {
      this.killfeedList.innerHTML = '<div style="color: #64748b; font-size: 11px; text-align: center; padding: 12px;">Aucune élimination pour le moment.</div>';
      return;
    }

    for (const d of pastDeaths) {
      const el = document.createElement('div');
      el.className = 'kill-entry';
      const isPvP = d.is_pvp;
      el.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
          <span style="font-weight: 700; color: ${isPvP ? '#ef4444' : '#f97316'}; font-size: 11px;">
            ${isPvP ? '⚔️ Élimination PvP' : '💀 Mort Environnement'}
          </span>
          <span class="kill-time">${this.formatClock(d.time)}</span>
        </div>
        <div class="kill-text">
          ${isPvP ? `<span class="killer">${d.killer}</span> a éliminé <strong>${d.victim}</strong>` : `<strong>${d.victim}</strong> est mort (${d.killer})`}
        </div>
      `;
      el.addEventListener('click', () => {
        this.onSeekTime(d.time);
      });
      this.killfeedList.appendChild(el);
    }
  }

  updateChat(t) {
    if (!this.chatMessagesBox) return;

    // Chats up to t
    const pastChats = this.events.chats.filter(c => c.time <= t).slice(-40);
    this.chatMessagesBox.innerHTML = '';

    if (pastChats.length === 0) {
      this.chatMessagesBox.innerHTML = '<div style="color: #64748b; font-size: 12px; text-align: center; padding: 20px;">Aucun message chat à ce moment du match.</div>';
      return;
    }

    for (const c of pastChats) {
      const msgEl = document.createElement('div');
      msgEl.className = 'chat-msg';
      msgEl.innerHTML = `
        <div class="chat-msg-time">${this.formatClock(c.time)}</div>
        <div class="chat-msg-user">&lt;${c.user}&gt;</div>
        <div class="chat-msg-body">${this.escapeHtml(c.message)}</div>
      `;
      this.chatMessagesBox.appendChild(msgEl);
    }
    // Auto-scroll to bottom of chat
    this.chatMessagesBox.scrollTop = this.chatMessagesBox.scrollHeight;
  }

  renderMilestones() {
    if (!this.milestonesBox || !this.meta || !this.meta.milestones) return;
    this.milestonesBox.innerHTML = '';

    for (const m of this.meta.milestones) {
      const card = document.createElement('div');
      card.className = 'milestone-card';
      card.innerHTML = `
        <div>
          <div class="milestone-title">${m.title}</div>
          <div class="milestone-desc">${m.desc}</div>
        </div>
        <div class="milestone-time">${this.formatClock(m.time)} ⏱️</div>
      `;
      card.addEventListener('click', () => {
        this.onSeekTime(m.time);
      });
      this.milestonesBox.appendChild(card);
    }

    // Full deaths list in chat tab
    if (this.fullDeathsLog) {
      this.fullDeathsLog.innerHTML = '';
      for (const d of this.events.deaths) {
        const el = document.createElement('div');
        el.className = 'kill-entry';
        el.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span class="kill-text">
              ${d.is_pvp ? `<span class="killer">${d.killer}</span> ⚔️ <strong>${d.victim}</strong>` : `💀 <strong>${d.victim}</strong> (${d.killer})`}
            </span>
            <span class="kill-time">${this.formatClock(d.time)}</span>
          </div>
        `;
        el.addEventListener('click', () => {
          this.onSeekTime(d.time);
        });
        this.fullDeathsLog.appendChild(el);
      }
    }
  }

  renderPlayerRoster() {
    if (!this.playersRoster || !this.meta || !this.meta.players) return;
    this.playersRoster.innerHTML = '';

    let list = this.meta.players;
    if (this.searchQuery) {
      list = list.filter(p => p.name.toLowerCase().includes(this.searchQuery));
    }

    const rivalries = this.duelMatrixData ? this.duelMatrixData.rivalries : {};

    for (const p of list) {
      const card = document.createElement('div');
      card.className = 'roster-card';

      const rData = rivalries[p.name];
      let badgesHtml = '';
      if (rData) {
        if (rData.nemesis) {
          badgesHtml += `<span class="roster-nemesis-badge" title="Némésis (joueur qui l'a le plus tué)">💀 Némésis: <strong style="color: ${rData.nemesis.color}">${rData.nemesis.name}</strong> (${rData.nemesis.count})</span>`;
        }
        if (rData.favorite_victim) {
          badgesHtml += `<span class="roster-victim-badge" title="Proie favorite (joueur le plus éliminé)">🎯 Proie: <strong style="color: ${rData.favorite_victim.color}">${rData.favorite_victim.name}</strong> (${rData.favorite_victim.count})</span>`;
        }
      }

      card.innerHTML = `
        <div class="roster-left">
          <img class="player-avatar-sm" src="${p.avatar_url}" alt="${p.name}">
          <div>
            <div class="roster-name">${p.name}</div>
            <div style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
              <span class="roster-team-badge" style="background: ${p.team_color}22; color: ${p.team_color}; border: 1px solid ${p.team_color};">
                ${p.team.toUpperCase()}
              </span>
              ${rData ? `<span class="roster-kd-badge">K/D ${rData.kd_ratio}</span>` : ''}
            </div>
            ${badgesHtml ? `<div class="roster-badges-row">${badgesHtml}</div>` : ''}
          </div>
        </div>
        <button class="btn btn-xs btn-outline">Suivre</button>
      `;
      card.addEventListener('click', () => {
        this.onSelectPlayer(p);
      });
      this.playersRoster.appendChild(card);
    }
  }

  async loadDuelMatrix() {
    try {
      const res = await fetch(`/api/duel-matrix?db=${encodeURIComponent(this.currentDb || '')}`);
      if (!res.ok) return;
      this.duelMatrixData = await res.json();
      this.renderDuelMatrix();
      this.renderDuelsTable();
      this.renderPlayerRoster();
    } catch (err) {
      console.warn('[StatsPanel] Erreur chargement matrice PvP:', err);
    }
  }

  renderDuelMatrix() {
    if (!this.teamMatrixWrapper || !this.duelMatrixData) return;
    const { teams, team_matrix } = this.duelMatrixData;

    if (!teams || teams.length === 0) {
      this.teamMatrixWrapper.innerHTML = '<div style="color: #64748b; padding: 12px;">Aucun duel enregistré.</div>';
      return;
    }

    const labels = {
      yellow: 'Jaune',
      purple: 'Violet',
      green: 'Vert',
      blue: 'Bleu',
      red: 'Rouge',
      cyan: 'Cyan',
      orange: 'Orange',
      pink: 'Rose'
    };

    let html = `
      <table class="duel-matrix-table">
        <thead>
          <tr>
            <th class="matrix-corner">Attaquant ➔<br>Victime ↴</th>
    `;

    for (const t of teams) {
      const tColor = this.getTeamColorByName(t);
      html += `<th style="color: ${tColor}; border-top: 2px solid ${tColor};">Équipe ${labels[t] || t.capitalize()}</th>`;
    }
    html += `<th>Total Kills</th></tr></thead><tbody>`;

    for (const killerTeam of teams) {
      const ktColor = this.getTeamColorByName(killerTeam);
      let rowTotal = 0;
      html += `<tr><td class="matrix-team-label" style="color: ${ktColor}; border-left: 2px solid ${ktColor};">Équipe ${labels[killerTeam] || killerTeam.capitalize()}</td>`;

      for (const victimTeam of teams) {
        const kills = (team_matrix[killerTeam] && team_matrix[killerTeam][victimTeam]) || 0;
        const deaths = (team_matrix[victimTeam] && team_matrix[victimTeam][killerTeam]) || 0;
        rowTotal += kills;

        let cellClass = 'cell-neutral';
        if (killerTeam !== victimTeam) {
          if (kills > deaths) cellClass = 'cell-winning';
          else if (kills < deaths) cellClass = 'cell-losing';
        }

        html += `
          <td class="matrix-cell ${cellClass}" title="Équipe ${labels[killerTeam] || killerTeam} a tué ${kills} fois l'Équipe ${labels[victimTeam] || victimTeam} (encaissé: ${deaths})">
            <span class="cell-kills">${kills}</span>
            ${killerTeam !== victimTeam ? `<span class="cell-diff">${kills >= deaths ? '+' : ''}${kills - deaths}</span>` : ''}
          </td>
        `;
      }

      html += `<td class="matrix-total"><strong>${rowTotal}</strong></td></tr>`;
    }

    html += `</tbody></table>`;
    this.teamMatrixWrapper.innerHTML = html;
  }

  renderDuelsTable() {
    if (!this.playerDuelsContainer || !this.duelMatrixData) return;
    const duels = this.duelMatrixData.duels || [];

    let filter = '';
    if (this.duelPlayerFilter) {
      filter = this.duelPlayerFilter.value.toLowerCase().trim();
    }

    const filtered = filter
      ? duels.filter(d => d.killer.toLowerCase().includes(filter) || d.victim.toLowerCase().includes(filter))
      : duels;

    if (filtered.length === 0) {
      this.playerDuelsContainer.innerHTML = '<div style="color: #64748b; padding: 12px; text-align: center;">Aucun duel trouvé.</div>';
      return;
    }

    let html = '<div class="duels-list">';
    for (const d of filtered) {
      const isDominated = d.kills > d.deaths_to_victim;
      html += `
        <div class="duel-row">
          <div class="duel-player killer-side">
            <img class="player-avatar-sm" src="${d.killer_avatar}" alt="${d.killer}">
            <span class="duel-name" style="color: ${d.killer_team_color}; font-weight: 700;">${d.killer}</span>
          </div>
          <div class="duel-score-badge ${isDominated ? 'score-win' : 'score-draw'}">
            <span class="score-main">${d.kills}</span>
            <span class="score-sep">-</span>
            <span class="score-sub">${d.deaths_to_victim}</span>
          </div>
          <div class="duel-player victim-side">
            <span class="duel-name" style="color: ${d.victim_team_color}; font-weight: 700;">${d.victim}</span>
            <img class="player-avatar-sm" src="${d.victim_avatar}" alt="${d.victim}">
          </div>
        </div>
      `;
    }
    html += '</div>';
    this.playerDuelsContainer.innerHTML = html;
  }

  getTeamColorByName(teamName) {
    if (this.meta && this.meta.players) {
      const p = this.meta.players.find(x => x.team === teamName);
      if (p && p.team_color) return p.team_color;
    }
    return '#3b82f6';
  }

  initRecapModal() {
    const btnOpen = document.getElementById('btn-open-recap');
    const modal = document.getElementById('modal-match-recap');
    const btnClose = document.getElementById('btn-close-recap-modal');
    const btnDismiss = document.getElementById('btn-dismiss-recap');
    const btnCopy = document.getElementById('btn-copy-discord');
    const btnDownload = document.getElementById('btn-download-json');
    const textarea = document.getElementById('recap-discord-textarea');
    const pillsBox = document.getElementById('recap-pills');

    if (!modal) return;

    const openModal = async () => {
      modal.classList.remove('hidden');
      if (textarea) textarea.value = 'Chargement du rapport...';

      try {
        const res = await fetch(`/api/match-recap?db=${encodeURIComponent(this.currentDb || '')}`);
        if (!res.ok) throw new Error('Échec du chargement du récapitulatif');
        this.recapData = await res.json();

        if (textarea) {
          textarea.value = this.recapData.discord_markdown;
        }

        if (pillsBox) {
          const s = this.recapData.summary;
          const aw = this.recapData.awards;
          pillsBox.innerHTML = `
            <div class="recap-pill">⏱️ <strong>${s.duration_formatted}</strong> (${s.minecraft_days} Jours)</div>
            <div class="recap-pill">👑 MVP : <strong>${aw.mvp ? aw.mvp.name : 'N/A'}</strong></div>
            <div class="recap-pill">⚔️ <strong>${s.total_kills}</strong> Kills</div>
            <div class="recap-pill">💎 <strong>${s.total_diamonds}</strong> Diamants</div>
            <div class="recap-pill">💥 <strong>${s.total_tnt_detonated}</strong> TNT</div>
          `;
        }
      } catch (err) {
        if (textarea) textarea.value = 'Erreur lors du calcul du récapitulatif : ' + err.message;
      }
    };

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    btnOpen?.addEventListener('click', openModal);
    btnClose?.addEventListener('click', closeModal);
    btnDismiss?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    btnCopy?.addEventListener('click', async () => {
      if (textarea && textarea.value) {
        try {
          await navigator.clipboard.writeText(textarea.value);
          const origText = btnCopy.innerText;
          btnCopy.innerText = '✅ Copié dans le presse-papiers !';
          setTimeout(() => { btnCopy.innerText = origText; }, 2500);
        } catch (e) {
          textarea.select();
          document.execCommand('copy');
          alert('Texte copié !');
        }
      }
    });

    btnDownload?.addEventListener('click', () => {
      if (this.recapData) {
        const blob = new Blob([JSON.stringify(this.recapData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fk_match_recap_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  formatClock(unixTs) {
    const d = new Date(unixTs * 1000);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${mins}:${secs}`;
  }

  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

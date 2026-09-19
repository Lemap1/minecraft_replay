/**
 * Timeline & Video Playback Engine for Fallen Kingdoms Replay
 */

export class TimelinePlayer {
  constructor(options = {}) {
    this.minTime = 0;
    this.maxTime = 0;
    this.matchStart = 0;
    this.matchStop = 0;
    this.currentTime = 0;

    this.isPlaying = false;
    this.playbackSpeed = 10; // Default 10x speed

    this.lastFrameTimestamp = null;
    this.animationFrameId = null;

    // Callbacks
    this.onTick = options.onTick || (() => {});
    this.onPlayStateChange = options.onPlayStateChange || (() => {});

    // DOM Elements
    this.slider = document.getElementById('time-slider');
    this.tooltip = document.getElementById('scrubber-tooltip');
    this.playBtn = document.getElementById('btn-play-pause');
    this.currentText = document.getElementById('current-playback-time');
    this.totalText = document.getElementById('total-playback-duration');
    this.realClockText = document.getElementById('playback-real-clock');
    this.gameDayText = document.getElementById('game-day-text');
    this.gameTimeText = document.getElementById('game-time-text');
    this.dayIcon = document.querySelector('.day-icon');
    this.dayBadge = document.getElementById('game-day-badge');
    this.milestonesTrack = document.getElementById('milestones-track');

    this.bookmarks = [];
    this.lastNotifiedDay = 0;
    this.toastTimeout = null;

    this.initEvents();
  }

  initEvents() {
    // Play/Pause button
    this.playBtn.addEventListener('click', () => this.togglePlay());

    // Step buttons
    document.getElementById('btn-step-backward')?.addEventListener('click', () => this.step(-15));
    document.getElementById('btn-step-forward')?.addEventListener('click', () => this.step(15));

    // Jump to match start / end / half players
    document.getElementById('btn-jump-half')?.addEventListener('click', () => {
      if (this.halfPlayersTime) this.seek(this.halfPlayersTime);
    });
    document.getElementById('btn-jump-start')?.addEventListener('click', () => this.seek(this.matchStart));
    document.getElementById('btn-jump-stop')?.addEventListener('click', () => this.seek(this.matchStop));

    // Speed buttons
    const speedButtons = document.querySelectorAll('.btn-speed');
    speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.playbackSpeed = parseFloat(btn.getAttribute('data-speed')) || 1;
      });
    });

    // Slider user input
    this.slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const targetTime = Math.round(this.minTime + (val / 1000) * (this.maxTime - this.minTime));
      this.seek(targetTime);
    });

    // Scrubber hover tooltip
    this.slider.addEventListener('mousemove', (e) => {
      const rect = this.slider.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const hoverTime = Math.round(this.minTime + percent * (this.maxTime - this.minTime));

      this.tooltip.classList.remove('hidden');
      this.tooltip.style.left = `${e.clientX - rect.left}px`;
      this.tooltip.innerText = this.formatDuration(hoverTime - this.minTime) + ' (' + this.formatRealDate(hoverTime) + ')';
    });

    this.slider.addEventListener('mouseleave', () => {
      this.tooltip.classList.add('hidden');
    });

    // Keyboard Shortcuts (Spacebar, Left, Right)
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.step(-15);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.step(15);
      }
    });
  }

  setRange({ minTime, maxTime, matchStart, matchStop, halfPlayersTime, defaultStartTime, hasExplicitStart, rules = null, milestones = [] }) {
    this.minTime = minTime;
    this.maxTime = maxTime;
    this.matchStart = matchStart || minTime;
    this.matchStop = matchStop || maxTime;
    this.halfPlayersTime = halfPlayersTime;
    this.defaultStartTime = defaultStartTime;
    this.hasExplicitStart = hasExplicitStart;
    this.rules = rules || {
      pvp_day: 3,
      nether_day: 4,
      end_day: 5,
      assault_day: 7,
      day_duration_seconds: 1200
    };

    if (defaultStartTime) {
      this.currentTime = defaultStartTime;
    } else if (hasExplicitStart && matchStart) {
      this.currentTime = matchStart;
    } else if (halfPlayersTime) {
      this.currentTime = halfPlayersTime;
    } else {
      this.currentTime = this.matchStart || minTime;
    }

    this.totalText.innerText = this.formatDuration(this.maxTime - this.minTime);
    this.renderMilestones(milestones);
    this.updateUI();
  }

  renderMilestones(milestones) {
    if (!this.milestonesTrack) return;
    this.milestonesTrack.innerHTML = '';

    const totalRange = this.maxTime - this.minTime;
    if (totalRange <= 0) return;

    // 1. Render Dynamic Minecraft Day Divisions
    const start = this.matchStart || this.minTime;
    const duration = this.maxTime - start;
    const dayDuration = this.rules?.day_duration_seconds || 1200;
    const totalDays = Math.ceil(duration / dayDuration);

    const pvpDay = this.rules?.pvp_day || 3;
    const netherDay = this.rules?.nether_day || 4;
    const endDay = this.rules?.end_day || 5;
    const assaultDay = this.rules?.assault_day || 7;

    for (let d = 0; d <= totalDays; d++) {
      const dayTime = start + d * dayDuration;
      if (dayTime > this.maxTime) break;

      const pct = ((dayTime - this.minTime) / totalRange) * 100;
      if (pct < 0 || pct > 100) continue;

      const dayMarker = document.createElement('div');
      dayMarker.className = 'day-timeline-marker';
      dayMarker.style.left = `${pct}%`;

      const dayNum = d + 1;
      let dayBadgeText = `J${dayNum}`;
      let isSpecial = false;

      if (dayNum === assaultDay) {
        dayBadgeText = `J${dayNum} 💣`;
        isSpecial = true;
      } else if (dayNum === endDay && endDay > 0) {
        dayBadgeText = `J${dayNum} 🔮`;
        isSpecial = true;
      } else if (dayNum === netherDay) {
        dayBadgeText = `J${dayNum} 🔥`;
        isSpecial = true;
      } else if (dayNum === pvpDay) {
        dayBadgeText = `J${dayNum} ⚔️`;
        isSpecial = true;
      }

      if (isSpecial) dayMarker.classList.add('special-phase');

      dayMarker.innerHTML = `<span class="day-marker-tag">${dayBadgeText}</span>`;
      dayMarker.title = `Jour ${dayNum} (${this.formatDuration(dayTime - this.minTime)}) - Cliquer pour sauter`;
      dayMarker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seek(dayTime);
      });
      this.milestonesTrack.appendChild(dayMarker);
    }

    // 2. Render Event Milestones
    for (const m of milestones) {
      const pct = ((m.time - this.minTime) / totalRange) * 100;
      if (pct < 0 || pct > 100) continue;

      const pin = document.createElement('div');
      pin.className = 'milestone-pin';
      pin.style.left = `${pct}%`;
      pin.title = `${m.title} (${this.formatDuration(m.time - this.minTime)})`;

      let icon = '🚩';
      if (m.type === 'match_start') icon = '🚀';
      else if (m.type === 'first_diamond') icon = '💎';
      else if (m.type === 'first_blood') icon = '⚔️';
      else if (m.type === 'first_tnt') icon = '💣';
      else if (m.type === 'half_players') icon = '👥';
      else if (m.type === 'chest_looted') icon = '🚨';

      pin.innerHTML = `<span>${icon}</span>`;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seek(m.time);
      });
      this.milestonesTrack.appendChild(pin);
    }

    // Also render bookmarks on milestones track
    this.renderBookmarks();
  }

  loadBookmarks(bookmarks = []) {
    this.bookmarks = Array.isArray(bookmarks) ? [...bookmarks] : [];
    if (this.bookmarks.length === 0 && typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('fk_replay_bookmarks');
        if (saved) this.bookmarks = JSON.parse(saved);
      } catch (e) {
        this.bookmarks = [];
      }
    }
    this.renderBookmarks();
    return this.bookmarks;
  }

  addBookmark(time, label = 'Signet') {
    if (!this.bookmarks) this.bookmarks = [];
    this.bookmarks.push({ time, label, created_at: Date.now() });
    this.saveBookmarks();
    this.renderBookmarks();
  }

  saveBookmarks() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('fk_replay_bookmarks', JSON.stringify(this.bookmarks || []));
      } catch (e) {}
    }
  }

  renderBookmarks() {
    if (!this.milestonesTrack || !this.bookmarks || this.bookmarks.length === 0) return;
    const totalRange = this.maxTime - this.minTime;
    if (totalRange <= 0) return;

    for (const bm of this.bookmarks) {
      const pct = ((bm.time - this.minTime) / totalRange) * 100;
      if (pct < 0 || pct > 100) continue;

      const marker = document.createElement('div');
      marker.className = 'milestone-pin bookmark-pin';
      marker.style.left = `${pct}%`;
      marker.style.cursor = 'pointer';
      marker.title = `📌 Signet : ${bm.label || 'Signet'} (${this.formatDuration(bm.time - this.minTime)})`;
      marker.innerHTML = `<span class="pin-icon" style="font-size: 11px;">📌</span>`;
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.seek(bm.time);
      });
      this.milestonesTrack.appendChild(marker);
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.currentTime >= this.maxTime) {
      this.currentTime = this.matchStart || this.minTime;
    }
    this.isPlaying = true;
    this.playBtn.innerHTML = '⏸';
    this.playBtn.title = 'Pause (Espace)';
    this.lastFrameTimestamp = performance.now();
    this.loop();
    this.onPlayStateChange(true);
  }

  pause() {
    this.isPlaying = false;
    this.playBtn.innerHTML = '▶';
    this.playBtn.title = 'Lecture (Espace)';
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.onPlayStateChange(false);
  }

  loop() {
    if (!this.isPlaying) return;

    const now = performance.now();
    const deltaMs = now - (this.lastFrameTimestamp || now);
    this.lastFrameTimestamp = now;

    // Advance real match time
    const advanceSec = (deltaMs / 1000) * this.playbackSpeed;
    this.currentTime += advanceSec;

    if (this.currentTime >= this.maxTime) {
      this.currentTime = this.maxTime;
      this.updateUI();
      this.pause();
      return;
    }

    this.updateUI();
    this.onTick(this.currentTime);

    this.animationFrameId = requestAnimationFrame(() => this.loop());
  }

  step(seconds) {
    this.seek(this.currentTime + seconds);
  }

  seek(targetTime) {
    this.currentTime = Math.max(this.minTime, Math.min(this.maxTime, targetTime));
    this.updateUI();
    this.onTick(this.currentTime);
  }

  updateUI() {
    const totalRange = this.maxTime - this.minTime;
    if (totalRange > 0) {
      const sliderVal = ((this.currentTime - this.minTime) / totalRange) * 1000;
      this.slider.value = sliderVal;
    }

    // Time texts
    const elapsed = Math.max(0, this.currentTime - (this.matchStart || this.minTime));
    this.currentText.innerText = this.formatDuration(elapsed);
    this.realClockText.innerText = `(${this.formatRealDate(this.currentTime)})`;

    // In-game FK Day based on dynamic rules
    const daySec = this.rules?.day_duration_seconds || 1200;
    const matchElapsed = Math.max(0, this.currentTime - (this.matchStart || this.minTime));
    const dayIndex = Math.floor(matchElapsed / daySec) + 1;
    const dayRemainderSec = Math.floor(matchElapsed % daySec);

    const pvpDay = this.rules?.pvp_day || 3;
    const netherDay = this.rules?.nether_day || 4;
    const endDay = this.rules?.end_day || 5;
    const assaultDay = this.rules?.assault_day || 7;

    // Dynamic Day rule reminder
    let dayRules = 'Minage & Préparation';
    if (dayIndex >= assaultDay) {
      dayRules = 'Assauts & TNT Autorisés 💣';
    } else if (dayIndex >= endDay && endDay > 0) {
      dayRules = 'The End Ouvert 🔮';
    } else if (dayIndex >= netherDay) {
      dayRules = 'Nether Ouvert 🔥';
    } else if (dayIndex >= pvpDay) {
      dayRules = 'PVP Actif ⚔️';
    }

    if (this.gameDayText) {
      this.gameDayText.innerText = `Jour ${dayIndex} (${dayRules})`;
    }

    // Convert dayRemainderSec to Minecraft in-game clock (06:00 to 06:00 next day)
    const mcMinutesTotal = Math.floor((dayRemainderSec / daySec) * 1440);
    const mcHours = Math.floor((mcMinutesTotal + 360) / 60) % 24;
    const mcMins = Math.floor((mcMinutesTotal + 360) % 60);
    if (this.gameTimeText) {
      this.gameTimeText.innerText = `${String(mcHours).padStart(2, '0')}:${String(mcMins).padStart(2, '0')}`;
    }

    // ☀️ Day / 🌙 Night cycle (06:00 to 18:00 = Day, 18:00 to 06:00 = Night)
    const isNight = mcHours >= 18 || mcHours < 6;
    if (this.dayIcon) {
      this.dayIcon.innerText = isNight ? '🌙' : '☀️';
    }
    if (this.dayBadge) {
      this.dayBadge.classList.toggle('night-mode', isNight);
      this.dayBadge.classList.toggle('day-mode', !isNight);
    }

    // Trigger Dynamic Phase Transition Toast during playback
    if (this.isPlaying && this.lastNotifiedDay !== dayIndex) {
      if (this.lastNotifiedDay > 0) {
        if (dayIndex === pvpDay) {
          this.showPhaseToast(`⚔️ JOUR ${dayIndex} : LE PVP EST MAINTENANT ACTIVÉ !`, 'toast-pvp');
        } else if (dayIndex === netherDay) {
          this.showPhaseToast(`🔥 JOUR ${dayIndex} : LE NETHER EST MAINTENANT OUVERT !`, 'toast-nether');
        } else if (dayIndex === endDay && endDay > 0) {
          this.showPhaseToast(`🔮 JOUR ${dayIndex} : THE END EST MAINTENANT OUVERT !`, 'toast-end');
        } else if (dayIndex === assaultDay) {
          this.showPhaseToast(`💣 JOUR ${dayIndex} : LES ASSAUTS ET LA TNT SONT AUTORISÉS !`, 'toast-assaults');
        }
      }
      this.lastNotifiedDay = dayIndex;
    }
  }

  showPhaseToast(message, typeClass = '') {
    const toast = document.getElementById('phase-toast');
    if (!toast) return;
    toast.innerText = message;
    toast.className = `phase-toast show ${typeClass}`;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }

  formatDuration(sec) {
    const totalSec = Math.floor(sec);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  formatRealDate(unixTs) {
    const d = new Date(unixTs * 1000);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${mins}:${secs}`;
  }
}

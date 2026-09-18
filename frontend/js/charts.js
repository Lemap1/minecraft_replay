/**
 * High-Performance Interactive Canvas Charts Engine for Fallen Kingdoms Replay
 * Renders time-series evolution curves for teams (Diamonds, Ores, Kills, TNT, Score)
 * Synchronized with the replay timeline scrubber.
 */

export class ChartsEngine {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.container = canvasElement.parentElement;

    this.onSeekTime = options.onSeekTime || (() => {});

    this.analyticsData = null; // Data from /api/analytics
    this.currentMetric = 'diamonds'; // 'diamonds', 'ores', 'kills', 'tnt', 'score'
    this.currentTime = 0;
    this.hiddenTeams = new Set();

    // Visual layout padding
    this.padding = { top: 30, right: 30, bottom: 40, left: 60 };

    // Mouse state
    this.hoverPoint = null;
    this.mouseX = null;

    // Retina display scaling
    this.dpr = window.devicePixelRatio || 1;

    this.initEvents();
    this.resize();
  }

  initEvents() {
    // Resize observer
    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      if (this.container) {
        this.resizeObserver.observe(this.container);
      }
    } else {
      window.addEventListener('resize', () => this.resize());
    }

    // Canvas click to seek
    this.canvas.addEventListener('click', (e) => {
      if (!this.analyticsData || !this.analyticsData.series || this.analyticsData.series.length === 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const chartWidth = rect.width - this.padding.left - this.padding.right;
      if (chartWidth <= 0) return;

      const progress = Math.max(0, Math.min(1, (x - this.padding.left) / chartWidth));
      const targetTime = this.analyticsData.start_time + progress * (this.analyticsData.stop_time - this.analyticsData.start_time);
      this.onSeekTime(Math.round(targetTime));
    });

    // Canvas hover for tooltips
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.mouseX = null;
      this.mouseY = null;
      this.render();
    });
  }

  resize() {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(250, Math.floor(rect.height || 420));

    this.width = w;
    this.height = h;

    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  setData(analyticsData) {
    this.analyticsData = analyticsData;
    this.render();
  }

  setMetric(metric) {
    this.currentMetric = metric;
    this.render();
  }

  setTime(currentTime) {
    this.currentTime = currentTime;
    this.render();
  }

  toggleTeam(teamName) {
    if (this.hiddenTeams.has(teamName)) {
      this.hiddenTeams.delete(teamName);
    } else {
      this.hiddenTeams.add(teamName);
    }
    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    if (!ctx || !w || !h) return;

    // Clear
    ctx.clearRect(0, 0, w, h);

    if (!this.analyticsData || !this.analyticsData.series || this.analyticsData.series.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chargement des graphiques temporels...', w / 2, h / 2);
      return;
    }

    const { start_time, stop_time, teams, series } = this.analyticsData;
    const totalDuration = Math.max(1, stop_time - start_time);

    const chartX = this.padding.left;
    const chartY = this.padding.top;
    const chartW = w - this.padding.left - this.padding.right;
    const chartH = h - this.padding.top - this.padding.bottom;

    if (chartW <= 0 || chartH <= 0) return;

    // 1. Find Max Value across visible teams for currentMetric
    let maxVal = 1;
    for (const pt of series) {
      const dataMap = this.getMetricMap(pt);
      for (const t of teams) {
        if (this.hiddenTeams.has(t.name)) continue;
        const val = dataMap[t.name] || 0;
        if (val > maxVal) maxVal = val;
      }
    }
    maxVal = this.getNiceMax(maxVal);

    // 2. Draw Background Grid & Axis
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    // Horizontal grid lines (5 steps)
    const steps = 5;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= steps; i++) {
      const v = Math.round((maxVal / steps) * i);
      const y = chartY + chartH - (i / steps) * chartH;
      ctx.beginPath();
      ctx.moveTo(chartX, y);
      ctx.lineTo(chartX + chartW, y);
      ctx.stroke();

      ctx.fillText(this.formatMetricVal(v), chartX - 8, y + 3);
    }

    // Vertical grid lines (MC Days: 1200s intervals)
    const mcDayDuration = 1200;
    const totalDays = Math.ceil(totalDuration / mcDayDuration);
    ctx.textAlign = 'center';

    for (let d = 0; d <= totalDays; d++) {
      const daySec = d * mcDayDuration;
      const x = chartX + (daySec / totalDuration) * chartW;
      if (x < chartX || x > chartX + chartW) continue;

      ctx.strokeStyle = d === 0 ? '#334155' : 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(x, chartY);
      ctx.lineTo(x, chartY + chartH);
      ctx.stroke();

      let label = `J${d + 1}`;
      if (d === 2) label = `J3 ⚔️`;
      else if (d === 3) label = `J4 🔥`;
      else if (d === 6) label = `J7 💣`;

      ctx.fillStyle = (d === 2 || d === 3 || d === 6) ? '#fbbf24' : '#94a3b8';
      ctx.fillText(label, x, chartY + chartH + 16);
    }

    // 3. Draw Curves per Team
    for (const t of teams) {
      if (this.hiddenTeams.has(t.name)) continue;

      const color = t.color || '#3b82f6';

      // Path
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < series.length; i++) {
        const pt = series[i];
        const prog = (pt.time - start_time) / totalDuration;
        const x = chartX + prog * chartW;
        const val = (this.getMetricMap(pt)[t.name] || 0);
        const y = chartY + chartH - (val / maxVal) * chartH;

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Subtle gradient area under the curve
      const grad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
      grad.addColorStop(0, `${color}25`);
      grad.addColorStop(1, `${color}02`);
      ctx.lineTo(chartX + chartW, chartY + chartH);
      ctx.lineTo(chartX, chartY + chartH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // 4. Draw Current Replay Time Vertical Cursor Line
    if (this.currentTime >= start_time && this.currentTime <= stop_time) {
      const replayProgress = (this.currentTime - start_time) / totalDuration;
      const replayX = chartX + replayProgress * chartW;

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(replayX, chartY);
      ctx.lineTo(replayX, chartY + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Top indicator badge
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(replayX, chartY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText('Replay', replayX, chartY - 6);
    }

    // 5. Mouse Hover Cursor & Tooltip
    if (this.mouseX !== null && this.mouseX >= chartX && this.mouseX <= chartX + chartW) {
      const hoverProg = (this.mouseX - chartX) / chartW;
      const hoverTime = start_time + hoverProg * totalDuration;

      // Find closest series point
      let closestPt = series[0];
      let minDiff = Infinity;
      for (const pt of series) {
        const diff = Math.abs(pt.time - hoverTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = pt;
        }
      }

      if (closestPt) {
        const ptX = chartX + ((closestPt.time - start_time) / totalDuration) * chartW;

        // Hover vertical line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ptX, chartY);
        ctx.lineTo(ptX, chartY + chartH);
        ctx.stroke();

        // Draw point dots on each team's line
        const ptMap = this.getMetricMap(closestPt);
        for (const t of teams) {
          if (this.hiddenTeams.has(t.name)) continue;
          const val = ptMap[t.name] || 0;
          const ptY = chartY + chartH - (val / maxVal) * chartH;

          ctx.fillStyle = t.color || '#3b82f6';
          ctx.beginPath();
          ctx.arc(ptX, ptY, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Tooltip box
        this.renderTooltip(ctx, closestPt, ptX, chartY, chartW, chartH);
      }
    }
  }

  renderTooltip(ctx, pt, ptX, chartY, chartW, chartH) {
    const teams = this.analyticsData.teams;
    const ptMap = this.getMetricMap(pt);

    const elapsedSec = pt.elapsed || 0;
    const h = Math.floor(elapsedSec / 3600);
    const m = Math.floor((elapsedSec % 3600) / 60);
    const s = elapsedSec % 60;
    const timeStr = `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} (Jour ${pt.day || 1})`;

    const metricTitle = this.getMetricTitle();

    const rows = [
      { text: timeStr, color: '#f8fafc', bold: true },
      { text: metricTitle, color: '#94a3b8', bold: false }
    ];

    for (const t of teams) {
      if (this.hiddenTeams.has(t.name)) continue;
      const val = ptMap[t.name] || 0;
      rows.push({
        text: `${t.label || t.name} : ${val.toLocaleString('fr-FR')}`,
        color: t.color || '#3b82f6',
        bold: true
      });
    }

    ctx.font = '11px sans-serif';
    let maxW = 120;
    for (const r of rows) {
      const m = ctx.measureText(r.text).width;
      if (m > maxW) maxW = m;
    }
    const boxW = maxW + 20;
    const boxH = rows.length * 17 + 10;

    let boxX = ptX + 12;
    if (boxX + boxW > chartX + chartW) {
      boxX = ptX - boxW - 12;
    }
    const boxY = Math.max(chartY + 5, Math.min(chartY + chartH - boxH - 5, this.mouseY ? this.mouseY - boxH / 2 : chartY + 20));

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    let curY = boxY + 16;
    for (const r of rows) {
      ctx.font = r.bold ? 'bold 11px sans-serif' : '11px sans-serif';
      ctx.fillStyle = r.color;
      ctx.textAlign = 'left';
      ctx.fillText(r.text, boxX + 10, curY);
      curY += 17;
    }
  }

  getMetricMap(pt) {
    if (this.currentMetric === 'ores') {
      const ores = {};
      const iron = pt.iron || {};
      const gold = pt.gold || {};
      const ad = pt.ancient_debris || {};
      for (const t of this.analyticsData.teams) {
        ores[t.name] = (iron[t.name] || 0) + (gold[t.name] || 0) + (ad[t.name] || 0);
      }
      return ores;
    }
    return pt[this.currentMetric] || {};
  }

  getMetricTitle() {
    switch (this.currentMetric) {
      case 'diamonds': return '💎 Diamants Minés';
      case 'ores': return '⛏️ Minerais (Fer + Or)';
      case 'kills': return '⚔️ Kills PvP';
      case 'tnt': return '💥 TNT Détonées';
      case 'score': return '⭐ Score Global FK';
      default: return 'Statistique';
    }
  }

  getNiceMax(val) {
    if (val <= 5) return 5;
    if (val <= 10) return 10;
    if (val <= 20) return 20;
    if (val <= 50) return 50;
    if (val <= 100) return 100;
    const mag = Math.pow(10, Math.floor(Math.log10(val)));
    const norm = val / mag;
    let ceilNorm = 2;
    if (norm > 5) ceilNorm = 10;
    else if (norm > 2) ceilNorm = 5;
    return ceilNorm * mag;
  }

  formatMetricVal(v) {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }
}

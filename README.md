# Fallen Kingdoms Replay and Match Stats

An interactive 2D web replay and analytics viewer for Minecraft Fallen Kingdoms matches, powered by CoreProtect SQLite databases. This project was made while being assisted by AI.



---

## 1. What is this project?

This project is a web application that lets you replay a Minecraft Fallen Kingdoms game like a video. It uses the log database created by the CoreProtect plugin during the match to recreate everything that happened on a 2D map, with real-time statistics and team leaderboards.

---

## 2. What does it do?

- 2D Map Replay: Watch players move around the map with their real Minecraft skins and team colors at 60 FPS.
- World and Construction Tracking: See blocks appear as players build them, and watch TNT and Creeper explosions with animated shockwaves.
- Overworld and Nether Support: Switch between the Overworld and the Nether with one click, while keeping your exact playback position. Players only appear in the dimension where they actually are.
- Timeline and Game Days: Follow in-game Minecraft days (Day 1 to 7+) with automatic notifications when game rules change (Day 3: PvP enabled, Day 4: Nether open, Day 7: Assaults and TNT allowed).
- Interactive Scrubber and Milestones: Jump instantly to key moments (match start, first diamond mined, first PvP kill, first TNT primed, match end).
- Live Leaderboard and Stats: Filter by team or search for a player. Sort by score, kills, deaths, diamonds, gold, iron, placed blocks, and detonated TNT.
- PvP Duel Matrix and Rivalries: Check team-versus-team kill ratios, player duels, and see who was each player's Nemesis or Favorite Target.
- Progression Charts: Graph team progress over time for diamonds, ores, kills, and overall score.
- Chat and Killfeed: Replay in-game chat messages and death events synchronized second-by-second.
- Match Recap and Discord Export: Generate a complete match report with MVP, top miner, top killer, and copy it directly to Discord in one click.

---

## 3. How does it work?

1. Database Reading (Backend):
   - Built with Python and FastAPI.
   - It reads your CoreProtect SQLite database (.db file).
   - It automatically extracts teams, player names, UUIDs, base locations, and event timelines without changing any database data.
   - It computes player presence so players who disconnect or switch dimensions are never shown frozen in the wrong place.

2. 2D Canvas Rendering (Frontend):
   - Built with modern HTML5 Canvas, CSS, and JavaScript (no heavy frameworks needed).
   - Smoothly interpolates player positions between logged actions.
   - Supports custom map images (map.png generated from world region files) or falls back to an integrated tactical grid.

3. Multi-Database Support:
   - Put multiple match databases in the folder.
   - Switch between different games instantly using the dropdown menu in the top bar.

---

## 4. How to run it

### Option 1: Using Docker (Recommended)

1. Put your CoreProtect database file (for example database.db) in this folder.
2. Run:
   ```bash
   docker compose up
   ```
3. Open your browser at:
   http://localhost:8050

To stop it, press Ctrl + C or run:
```bash
docker compose down
```

---

### Option 2: Running Locally with Python

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate       # On Linux / macOS
   # or: .venv\Scripts\activate    # On Windows
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Start the server:
   ```bash
   uvicorn backend.main:app --host 0.0.0.0 --port 8050
   ```

4. Open your browser at:
   http://localhost:8050

---

## 5. Project Structure

```text
log_displayer/
|-- backend/
|   |-- main.py          # FastAPI web server and API routes
|   |-- db_reader.py     # CoreProtect SQLite parser, stats and logic
|   |-- render_map.py    # Optional: generates map.png from Minecraft .mca region files
|-- frontend/
|   |-- index.html       # Web interface
|   |-- css/style.css    # Styling and dark theme
|   |-- js/
|       |-- app.js       # Main controller and database switcher
|       |-- map_renderer.js # 2D Canvas engine (players, blocks, trails)
|       |-- timeline.js  # Video controls, scrubber and day cycles
|       |-- stats_panel.js # Leaderboard, PvP matrix and match recap
|       |-- charts.js    # Canvas graphs for team progression
|-- data/                # Put your .db files and custom map images here
|-- Dockerfile           # Docker build configuration
|-- docker-compose.yml   # One-command Docker setup
|-- requirements.txt     # Python requirements
```

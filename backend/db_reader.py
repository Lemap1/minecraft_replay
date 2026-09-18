import os
import glob
import sqlite3
import re
import time
import json
import math
from collections import defaultdict
from typing import Dict, List, Optional, Any, Tuple

# Supported database directories
SEARCH_DIRS = [".", "./data", "/app/data", os.environ.get("DATA_DIR", "data")]

# In-memory cache for metadata and connections
_cache: Dict[str, Any] = {}


def clear_cache():
    """Clear in-memory metadata and index cache."""
    global _cache
    _cache.clear()


def list_databases() -> List[Dict[str, Any]]:
    """Scan directories for SQLite databases, deduplicated by filename."""
    found = []
    seen_names = set()
    for directory in SEARCH_DIRS:
        if not directory or not os.path.exists(directory):
            continue
        patterns = ["*.db", "*.sqlite", "*.sqlite3"]
        for p in patterns:
            for file_path in glob.glob(os.path.join(directory, p)):
                norm = os.path.normpath(file_path)
                name = os.path.basename(norm)
                if name in seen_names:
                    continue
                seen_names.add(name)
                try:
                    stat = os.stat(norm)
                    size_mb = round(stat.st_size / (1024 * 1024), 2)
                    found.append({
                        "name": name,
                        "path": norm,
                        "size_mb": size_mb,
                        "modified": int(stat.st_mtime)
                    })
                except Exception:
                    pass
    # Sort with database.db first if present
    found.sort(key=lambda d: (0 if d["name"] == "database.db" else 1, d["name"]))
    return found


def resolve_db_path(db_name: Optional[str] = None) -> str:
    """Resolve database path from name or default to first available."""
    dbs = list_databases()
    if not dbs:
        # Fallback to database.db even if not listed yet
        return "database.db"
    if not db_name:
        return dbs[0]["path"]

    # Match by exact path or filename
    for d in dbs:
        if d["name"] == db_name or d["path"] == db_name:
            return d["path"]
    # If not found in list, check if path directly exists
    if os.path.exists(db_name):
        return db_name
    return dbs[0]["path"]


def resolve_map_image(db_path_or_name: Optional[str] = None, wid: int = 1) -> Optional[Tuple[str, int]]:
    """
    Find the most relevant and up-to-date custom map PNG image.
    Prioritizes <db_base>_map.png over generic map.png for Overworld (wid=1).
    For Nether (wid=2), looks for <db_base>_nether_map.png or nether_map.png.
    When multiple candidate locations exist, selects the most recently modified file.
    Returns (path, mtime) or None.
    """
    db_base = None
    if db_path_or_name:
        db_base = os.path.splitext(os.path.basename(db_path_or_name))[0]

    if wid == 2:
        # Dedicated Nether candidate maps
        dedicated_candidates = []
        if db_base:
            dedicated_candidates = [
                f"data/{db_base}_nether_map.png",
                f"{db_base}_nether_map.png",
                f"/app/data/data/{db_base}_nether_map.png",
                f"/app/data/{db_base}_nether_map.png",
                f"frontend/{db_base}_nether_map.png",
                f"/app/frontend/{db_base}_nether_map.png",
            ]
        generic_candidates = [
            "data/nether_map.png",
            "nether_map.png",
            "data/map_nether.png",
            "map_nether.png",
            "/app/data/data/nether_map.png",
            "/app/data/nether_map.png",
            "frontend/nether_map.png",
            "/app/frontend/nether_map.png",
        ]
    else:
        # Overworld candidates
        dedicated_candidates = []
        if db_base:
            dedicated_candidates = [
                f"data/{db_base}_map.png",
                f"{db_base}_map.png",
                f"/app/data/data/{db_base}_map.png",
                f"/app/data/{db_base}_map.png",
                f"frontend/{db_base}_map.png",
                f"/app/frontend/{db_base}_map.png",
            ]
        generic_candidates = [
            "data/map.png",
            "map.png",
            "/app/data/data/map.png",
            "/app/data/map.png",
            "frontend/map.png",
            "/app/frontend/map.png",
        ]

    # 1. Check dedicated candidates first
    found_dedicated = []
    for cand in dedicated_candidates:
        if os.path.isfile(cand):
            try:
                mtime = int(os.path.getmtime(cand))
                found_dedicated.append((cand, mtime))
            except Exception:
                pass

    if found_dedicated:
        found_dedicated.sort(key=lambda x: x[1], reverse=True)
        return found_dedicated[0]

    # 2. Fallback to generic candidates
    found_generic = []
    for cand in generic_candidates:
        if os.path.isfile(cand):
            try:
                mtime = int(os.path.getmtime(cand))
                found_generic.append((cand, mtime))
            except Exception:
                pass

    if found_generic:
        found_generic.sort(key=lambda x: x[1], reverse=True)
        return found_generic[0]

    return None


def resolve_map_config(db_path_or_name: Optional[str] = None, wid: int = 1) -> Optional[dict]:
    """
    Find and load the most relevant map_config.json bounding coordinates.
    Prioritizes <db_base>_map_config.json over generic map_config.json.
    Supports Nether (wid=2) configs if present.
    Returns config dict or None.
    """
    db_base = None
    if db_path_or_name:
        db_base = os.path.splitext(os.path.basename(db_path_or_name))[0]

    suffix = "_nether_map_config.json" if wid == 2 else "_map_config.json"
    gen_name = "nether_map_config.json" if wid == 2 else "map_config.json"

    dedicated_candidates = []
    if db_base:
        dedicated_candidates = [
            f"data/{db_base}{suffix}",
            f"{db_base}{suffix}",
            f"/app/data/data/{db_base}{suffix}",
            f"/app/data/{db_base}{suffix}",
        ]

    generic_candidates = [
        f"data/{gen_name}",
        f"{gen_name}",
        f"/app/data/data/{gen_name}",
        f"/app/data/{gen_name}",
    ]

    found_dedicated = []
    for cand in dedicated_candidates:
        if os.path.isfile(cand):
            try:
                mtime = int(os.path.getmtime(cand))
                found_dedicated.append((cand, mtime))
            except Exception:
                pass

    best_cfg_path = None
    if found_dedicated:
        found_dedicated.sort(key=lambda x: x[1], reverse=True)
        best_cfg_path = found_dedicated[0][0]
    else:
        found_generic = []
        for cand in generic_candidates:
            if os.path.isfile(cand):
                try:
                    mtime = int(os.path.getmtime(cand))
                    found_generic.append((cand, mtime))
                except Exception:
                    pass
        if found_generic:
            found_generic.sort(key=lambda x: x[1], reverse=True)
            best_cfg_path = found_generic[0][0]

    if best_cfg_path:
        try:
            with open(best_cfg_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return None


def get_connection(db_path: str) -> sqlite3.Connection:
    """Open SQLite connection and ensure helpful indexes exist."""
    # Check if file exists
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database not found: {db_path}")

    # Use timeout to avoid lock collisions
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.execute("PRAGMA journal_mode = WAL;")

    # Check if we already verified indexes on this db path
    idx_key = f"indexed_{db_path}_{os.path.getmtime(db_path)}"
    if idx_key not in _cache:
        try:
            # Check existing indexes
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='index'")
            existing = {r[0] for r in cur.fetchall()}
            if "co_block_time" not in existing:
                cur.execute("CREATE INDEX IF NOT EXISTS co_block_time ON co_block(time);")
            if "co_item_time" not in existing:
                cur.execute("CREATE INDEX IF NOT EXISTS co_item_time ON co_item(time);")
            if "co_chat_time" not in existing:
                cur.execute("CREATE INDEX IF NOT EXISTS co_chat_time ON co_chat(time);")
            conn.commit()
        except Exception as e:
            # Database might be read-only; proceed anyway
            pass
        _cache[idx_key] = True

    return conn


NORMALIZE_TEAM = {
    "jaune": "yellow",
    "yellow": "yellow",
    "vert": "green",
    "green": "green",
    "violet": "purple",
    "purple": "purple",
    "bleu": "blue",
    "blue": "blue",
    "rouge": "red",
    "red": "red",
    "cyan": "cyan",
    "orange": "orange",
    "rose": "pink",
    "pink": "pink",
}


TEAM_COLORS = {
    "yellow": "#eab308",
    "jaune": "#eab308",
    "purple": "#a855f7",
    "violet": "#a855f7",
    "green": "#22c55e",
    "vert": "#22c55e",
    "blue": "#3b82f6",
    "bleu": "#3b82f6",
    "red": "#ef4444",
    "rouge": "#ef4444",
    "cyan": "#06b6d4",
    "orange": "#f97316",
    "pink": "#ec4899",
    "rose": "#ec4899",
    "lime": "#84cc16",
    "vert_clair": "#84cc16",
    "magenta": "#d946ef",
    "light_blue": "#38bdf8",
    "bleu_ciel": "#38bdf8",
    "white": "#f8fafc",
    "blanc": "#f8fafc",
    "black": "#1e293b",
    "noir": "#1e293b",
    "gray": "#64748b",
    "gris": "#64748b",
    "brown": "#92400e",
    "marron": "#92400e",
}

DYNAMIC_PALETTE = [
    "#3b82f6", "#ef4444", "#22c55e", "#eab308",
    "#a855f7", "#06b6d4", "#f97316", "#ec4899",
    "#14b8a6", "#84cc16", "#6366f1", "#d946ef",
    "#0284c7", "#f43f5e", "#8b5cf6", "#10b981",
]

TEAM_LABELS_FR = {
    "yellow": "Jaune",
    "purple": "Violet",
    "green": "Vert",
    "blue": "Bleu",
    "red": "Rouge",
    "cyan": "Cyan",
    "orange": "Orange",
    "pink": "Rose",
    "white": "Blanc",
    "gray": "Gris",
    "lime": "Vert Clair",
    "magenta": "Magenta",
    "light_blue": "Bleu Ciel",
    "black": "Noir",
    "brown": "Marron"
}


def get_team_color(team_name: str) -> str:
    """Return a consistent hex color for any team name, whether standard or custom."""
    if not team_name or team_name == "neutral":
        return "#94a3b8"
    norm = NORMALIZE_TEAM.get(team_name.lower(), team_name.lower())
    if norm in TEAM_COLORS:
        return TEAM_COLORS[norm]
    # For custom / arbitrary team names, deterministically assign from palette
    h = sum(ord(c) for c in norm)
    return DYNAMIC_PALETTE[h % len(DYNAMIC_PALETTE)]


def get_metadata(db_path: str) -> Dict[str, Any]:
    """Extract game metadata, teams, players, bounds, and key milestones."""
    mtime = os.path.getmtime(db_path)
    cache_key = f"meta_{db_path}_{mtime}"
    if cache_key in _cache:
        cached = dict(_cache[cache_key])
        map_bounds = resolve_map_config(db_path, wid=1)
        map_info = resolve_map_image(db_path, wid=1)
        cached["map_bounds"] = map_bounds
        cached["has_custom_map"] = map_info is not None
        cached["custom_map_url"] = f"/api/map-image?db={os.path.basename(db_path)}&world=1&v={map_info[1]}" if map_info else None
        nether_map_bounds = resolve_map_config(db_path, wid=2)
        nether_map_info = resolve_map_image(db_path, wid=2)
        cached["nether_map_bounds"] = nether_map_bounds
        cached["has_nether_map"] = nether_map_info is not None
        cached["custom_nether_map_url"] = f"/api/map-image?db={os.path.basename(db_path)}&world=2&v={nether_map_info[1]}" if nether_map_info else None
        return cached

    conn = get_connection(db_path)
    c = conn.cursor()

    # 1. Worlds
    c.execute("SELECT id, world FROM co_world;")
    worlds = [{"id": r[0], "name": r[1]} for r in c.fetchall()]

    # 2. Real Players (exclude '#' entities)
    c.execute("SELECT id, user, uuid FROM co_user WHERE user NOT LIKE '#%' ORDER BY user ASC;")
    users_raw = c.fetchall()
    players_dict = {
        r[0]: {
            "id": r[0],
            "name": r[1],
            "uuid": r[2] or "",
            "team": "neutral",
            "team_color": "#94a3b8",
            "avatar_url": f"https://mc-heads.net/avatar/{r[2]}/32" if r[2] else f"https://mc-heads.net/avatar/{r[1]}/32"
        }
        for r in users_raw
    }

    # 3. Time Range & Match Bounds
    c.execute("SELECT min(time), max(time) FROM co_block;")
    t_min, t_max = c.fetchone()
    if t_min is None:
        t_min, t_max = 0, 0

    # Look for /fk game start and stop
    match_start = None
    match_stop = None
    has_explicit_start = False
    c.execute("""
        SELECT time, message FROM co_command
        WHERE message LIKE '/fk game start%' OR message LIKE '/fk game stop%'
           OR message LIKE '/game start%' OR message LIKE '/start%'
        ORDER BY time ASC
    """)
    for t, msg in c.fetchall():
        if "start" in msg and match_start is None:
            match_start = t
            has_explicit_start = True
        elif "stop" in msg:
            match_stop = t

    # If no explicit match start, default to first real player block event or t_min
    fallback_start = match_start
    if fallback_start is None:
        c.execute("""
            SELECT min(time) FROM co_block
            WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        """)
        r = c.fetchone()
        fallback_start = r[0] if r and r[0] else t_min

    if match_stop is None:
        match_stop = t_max

    effective_start = match_start or fallback_start

    # 4. Parse Teams and Bases from commands
    bases = {}
    team_elimination_times = {}
    player_team_timeline = defaultdict(list)

    c.execute("""
        SELECT time, message, x, y, z
        FROM co_command
        WHERE message LIKE '/fk team%' OR message LIKE '/team%' OR message LIKE '/scoreboard teams%'
        ORDER BY time ASC
    """)
    for t, msg, x, y, z in c.fetchall():
        # Team removal / elimination: /fk team remove <team>
        m_rem_team = re.match(r'/(?:fk\s+)?team\s+remove\s+([A-Za-z0-9_]+)', msg, re.IGNORECASE)
        if m_rem_team:
            raw_t = m_rem_team.group(1).lower()
            norm_t = NORMALIZE_TEAM.get(raw_t, raw_t)
            if norm_t not in team_elimination_times:
                team_elimination_times[norm_t] = t

        # Add player: /fk team addPlayer <player> <team>
        m_add = re.match(r'/fk team addPlayer\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)', msg, re.IGNORECASE)
        if m_add:
            p_name = m_add.group(1)
            raw_t = m_add.group(2).lower()
            norm_t = NORMALIZE_TEAM.get(raw_t, raw_t)
            if not norm_t.isdigit() and norm_t != "base":
                player_team_timeline[p_name].append((t, norm_t))
        else:
            m_join = re.match(r'/(?:scoreboard\s+teams|team)\s+join\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)', msg, re.IGNORECASE)
            if m_join:
                raw_t = m_join.group(1).lower()
                norm_t = NORMALIZE_TEAM.get(raw_t, raw_t)
                p_name = m_join.group(2)
                if not norm_t.isdigit() and norm_t != "base":
                    player_team_timeline[p_name].append((t, norm_t))

        # Remove player: /fk team removePlayer <player>
        m_rem = re.match(r'/(?:fk\s+team\s+removePlayer|team\s+leave|scoreboard\s+teams\s+leave)\s+([A-Za-z0-9_]+)', msg, re.IGNORECASE)
        if m_rem:
            p_name = m_rem.group(1)
            player_team_timeline[p_name].append((t, None))

        # Set base: /fk team setBase <team> [radius] [material]
        m_base = re.match(r'/(?:fk\s+)?team\s+setBase(?:\s+([A-Za-z0-9_]+))?', msg, re.IGNORECASE)
        if m_base:
            raw_team = (m_base.group(1) or "").lower()
            raw_team = NORMALIZE_TEAM.get(raw_team, raw_team)
            if raw_team and not raw_team.isdigit() and raw_team != "base":
                if x is not None and z is not None:
                    bases[raw_team] = {
                        "team": raw_team,
                        "x": x,
                        "y": y or 64,
                        "z": z,
                        "radius": 15,
                        "color": get_team_color(raw_team)
                    }

    # Filter out bases removed before match start
    bases = {
        b_name: b_data for b_name, b_data in bases.items()
        if b_name not in team_elimination_times or team_elimination_times[b_name] >= effective_start
    }

    # Resolve definitive match team for each player
    for uid, p in players_dict.items():
        name = p["name"]
        timeline = player_team_timeline.get(name, [])
        final_team = None

        if timeline:
            # 1. State at match start (or within 180s after start)
            start_entries = [entry for entry in timeline if entry[0] <= effective_start + 180]
            if start_entries:
                final_team = start_entries[-1][1]

            # 2. If no team at start (late joiner), evaluate active duration during match
            if not final_team:
                durations = defaultdict(float)
                for i, (t_cur, t_team) in enumerate(timeline):
                    t_next = timeline[i + 1][0] if i + 1 < len(timeline) else match_stop
                    if t_team in team_elimination_times:
                        t_next = min(t_next, team_elimination_times[t_team])
                    seg_start = max(effective_start, t_cur)
                    seg_end = min(match_stop, t_next)
                    if seg_end > seg_start and t_team:
                        durations[t_team] += (seg_end - seg_start)
                if durations:
                    final_team = max(durations.items(), key=lambda x: x[1])[0]

        # 3. Spatial fallback ONLY if no command timeline was logged in database
        elif not player_team_timeline and bases:
            c.execute("SELECT b.x, b.z FROM co_block b WHERE b.user = ? AND b.action = 1", (uid,))
            placed = c.fetchall()
            base_counts = defaultdict(int)
            for bx, bz in placed:
                for b_name, b_data in bases.items():
                    if math.hypot(bx - b_data["x"], bz - b_data["z"]) <= 50:
                        base_counts[b_name] += 1
            if base_counts:
                best_team, best_cnt = max(base_counts.items(), key=lambda x: x[1])
                if best_cnt >= 15:
                    final_team = best_team

        t_name = final_team or "neutral"
        p["team"] = t_name
        p["team_color"] = get_team_color(t_name)

    # Calculate moment when at least half of real players are connected
    total_real_players = len(players_dict)
    half_threshold = (total_real_players + 1) // 2 if total_real_players > 0 else 1
    half_players_time = None

    c.execute("""
        SELECT time, user, action
        FROM co_session
        WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        ORDER BY time ASC
    """)
    online_uids = set()
    for st, suid, saction in c.fetchall():
        if saction == 1:
            online_uids.add(suid)
        elif saction == 0:
            online_uids.discard(suid)
        if len(online_uids) >= half_threshold:
            half_players_time = st
            break

    # If sessions did not capture it, fallback to activity buckets
    if half_players_time is None:
        c.execute("""
            SELECT DISTINCT (time / 300) * 300 as bucket, user
            FROM (
                SELECT time, user FROM co_block WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
                UNION ALL
                SELECT time, user FROM co_session WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
            )
            ORDER BY bucket ASC
        """)
        bucket_users = {}
        for b, u in c.fetchall():
            bucket_users.setdefault(b, set()).add(u)
        for b in sorted(bucket_users.keys()):
            if len(bucket_users[b]) >= half_threshold:
                half_players_time = b
                break

    if half_players_time is None:
        half_players_time = match_start or fallback_start

    # 4b. Player Dimension Presence Intervals (Overworld wid=1 vs Nether wid=2 vs Logged Out)
    c.execute("""
        SELECT user, time, wid, 0 as is_logout FROM co_block WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        UNION ALL
        SELECT user, time, wid, 0 as is_logout FROM co_container WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        UNION ALL
        SELECT user, time, wid, 0 as is_logout FROM co_item WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        UNION ALL
        SELECT user, time, wid, 0 as is_logout FROM co_chat WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        UNION ALL
        SELECT user, time, wid, (CASE WHEN action = 0 THEN 1 ELSE 0 END) as is_logout 
        FROM co_session WHERE user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        ORDER BY user, time ASC
    """)
    presence_rows = c.fetchall()
    by_user_events = defaultdict(list)
    for u, t, wid, is_logout in presence_rows:
        by_user_events[u].append((t, wid, is_logout))

    player_dimensions = {}
    for u, events in by_user_events.items():
        spans = []
        cur_wid = None
        cur_start = None
        cur_end = None
        is_online = False

        for t, wid, is_logout in events:
            if is_logout == 1:
                if is_online and cur_wid is not None:
                    spans.append({"wid": cur_wid, "start": cur_start, "end": t})
                    cur_wid = None
                    cur_start = None
                    cur_end = None
                is_online = False
            else:
                is_online = True
                if cur_wid is None:
                    cur_wid = wid
                    cur_start = t
                    cur_end = t
                elif cur_wid == wid:
                    cur_end = t
                else:
                    spans.append({"wid": cur_wid, "start": cur_start, "end": t})
                    cur_wid = wid
                    cur_start = t
                    cur_end = t

        if is_online and cur_wid is not None:
            spans.append({"wid": cur_wid, "start": cur_start, "end": cur_end})

        player_dimensions[u] = spans

    # 5. Coordinate Bounds per World (wid = 1 Overworld, wid = 2 Nether)
    bounds = {}
    for w in worlds:
        wid = w["id"]
        c.execute("""
            SELECT min(x), max(x), min(z), max(z)
            FROM co_block
            WHERE wid = ? AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        """, (wid,))
        row = c.fetchone()
        if row and row[0] is not None:
            # Add a 50 block buffer
            bounds[wid] = {
                "min_x": row[0] - 30,
                "max_x": row[1] + 30,
                "min_z": row[2] - 30,
                "max_z": row[3] + 30,
            }
        else:
            bounds[wid] = {"min_x": -500, "max_x": 500, "min_z": -500, "max_z": 500}

    # 6. Key milestones (First diamond, First blood / kill, TNT, etc.)
    milestones = []

    # First diamond ore mined
    c.execute("""
        SELECT b.time, u.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 0 AND m.material LIKE '%diamond_ore%' AND u.user NOT LIKE '#%'
        ORDER BY b.time ASC
        LIMIT 1
    """)
    first_diamond = c.fetchone()
    if first_diamond:
        milestones.append({
            "type": "first_diamond",
            "title": "💎 Premier Diamant miné",
            "time": first_diamond[0],
            "player": first_diamond[1],
            "x": first_diamond[2],
            "y": first_diamond[3],
            "z": first_diamond[4],
            "desc": f"{first_diamond[1]} a miné le 1er minerai de diamant !"
        })

    # First PvP Kill (player kills player)
    c.execute("""
        SELECT b.time, killer.user, victim.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user killer ON b.user = killer.id
        JOIN co_user victim ON b.data = victim.id
        WHERE b.action = 3 AND b.type = 0
          AND killer.user NOT LIKE '#%'
          AND victim.user NOT LIKE '#%'
        ORDER BY b.time ASC
        LIMIT 1
    """)
    first_kill = c.fetchone()
    if first_kill:
        milestones.append({
            "type": "first_blood",
            "title": "⚔️ Premier Sang (First Blood)",
            "time": first_kill[0],
            "player": first_kill[1],
            "victim": first_kill[2],
            "x": first_kill[3],
            "y": first_kill[4],
            "z": first_kill[5],
            "desc": f"{first_kill[1]} a éliminé {first_kill[2]} !"
        })

    # First TNT placed
    c.execute("""
        SELECT b.time, u.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 1 AND m.material LIKE '%:tnt' AND u.user NOT LIKE '#%'
        ORDER BY b.time ASC
        LIMIT 1
    """)
    first_tnt = c.fetchone()
    if first_tnt:
        milestones.append({
            "type": "first_tnt",
            "title": "💣 Première TNT posée",
            "time": first_tnt[0],
            "player": first_tnt[1],
            "x": first_tnt[2],
            "y": first_tnt[3],
            "z": first_tnt[4],
            "desc": f"{first_tnt[1]} a posé la 1ère TNT !"
        })

    # First TNT detonated/primed
    c.execute("""
        SELECT b.time, u.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 0 AND m.material LIKE '%:tnt' AND u.user NOT LIKE '#%'
        ORDER BY b.time ASC
        LIMIT 1
    """)
    first_detonated = c.fetchone()
    if first_detonated:
        milestones.append({
            "type": "first_tnt_detonated",
            "title": "💥 Première TNT amorcée",
            "time": first_detonated[0],
            "player": first_detonated[1],
            "x": first_detonated[2],
            "y": first_detonated[3],
            "z": first_detonated[4],
            "desc": f"{first_detonated[1]} a amorcé la 1ère TNT !"
        })

    if has_explicit_start and match_start:
        milestones.append({
            "type": "match_start",
            "title": "🚀 Lancement officiel (/fk game start)",
            "time": match_start,
            "desc": "Lancement officiel de la partie Fallen Kingdoms !"
        })

    if half_players_time:
        milestones.append({
            "type": "half_players",
            "title": f"👥 Moitié des joueurs connectée ({half_threshold}/{total_real_players})",
            "time": half_players_time,
            "desc": f"Au moins {half_threshold} joueurs sont présents sur le serveur."
        })

    # Sort milestones by time
    milestones.sort(key=lambda m: m["time"])

    # Resolve custom map configuration and image
    map_bounds = resolve_map_config(db_path, wid=1)
    map_info = resolve_map_image(db_path, wid=1)
    has_custom_map = map_info is not None
    custom_map_url = f"/api/map-image?db={os.path.basename(db_path)}&world=1&v={map_info[1]}" if map_info else None

    nether_map_bounds = resolve_map_config(db_path, wid=2)
    nether_map_info = resolve_map_image(db_path, wid=2)
    has_nether_map = nether_map_info is not None
    custom_nether_map_url = f"/api/map-image?db={os.path.basename(db_path)}&world=2&v={nether_map_info[1]}" if nether_map_info else None

    # Determine default cursor start time:
    # 1. Official FK start if found
    # 2. Otherwise when 50% of players are connected
    # 3. Otherwise fallback start or min_time
    if has_explicit_start and match_start:
        default_start_time = match_start
    elif half_players_time:
        default_start_time = half_players_time
    else:
        default_start_time = fallback_start or t_min

    effective_start = match_start if has_explicit_start else fallback_start

    result = {
        "db_name": os.path.basename(db_path),
        "db_path": db_path,
        "worlds": worlds,
        "players": list(players_dict.values()),
        "bases": list(bases.values()),
        "time_range": {
            "min_time": t_min,
            "max_time": t_max,
            "match_start": effective_start,
            "match_stop": match_stop,
            "has_explicit_start": has_explicit_start,
            "fk_start_time": match_start if has_explicit_start else None,
            "half_players_time": half_players_time,
            "default_start_time": default_start_time,
            "duration_seconds": (match_stop - effective_start) if (effective_start and match_stop) else 0
        },
        "bounds": bounds,
        "map_bounds": map_bounds,
        "milestones": milestones,
        "has_custom_map": has_custom_map,
        "custom_map_url": custom_map_url,
        "nether_map_bounds": nether_map_bounds,
        "has_nether_map": has_nether_map,
        "custom_nether_map_url": custom_nether_map_url,
        "player_dimensions": player_dimensions
    }
    _cache[cache_key] = result
    return result


def get_player_trajectories(db_path: str, wid: int = 1, start_time: Optional[int] = None, end_time: Optional[int] = None) -> List[List[Any]]:
    """
    Get compact spatial points [time, user_id, x, y, z, action_code] for real players.
    action_code:
      0: break, 1: place, 2: interact, 3: kill/death, 4: container, 5: item, 6: chat, 7: session
    """
    conn = get_connection(db_path)
    c = conn.cursor()

    time_filter = ""
    params: List[Any] = [wid]
    if start_time is not None and end_time is not None:
        time_filter = "AND time BETWEEN ? AND ?"
        params.extend([start_time, end_time])

    # Fetch combined spatial events
    query = f"""
        SELECT time, user, x, y, z, action FROM (
            SELECT time, user, x, y, z, action FROM co_block 
            WHERE wid = ? {time_filter.replace('time', 'time')} AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
            UNION ALL
            SELECT time, user, x, y, z, 4 as action FROM co_container 
            WHERE wid = ? {time_filter.replace('time', 'time')} AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
            UNION ALL
            SELECT time, user, x, y, z, 5 as action FROM co_item 
            WHERE wid = ? {time_filter.replace('time', 'time')} AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
            UNION ALL
            SELECT time, user, x, y, z, 6 as action FROM co_chat 
            WHERE wid = ? {time_filter.replace('time', 'time')} AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
            UNION ALL
            SELECT time, user, x, y, z, 7 as action FROM co_session 
            WHERE wid = ? {time_filter.replace('time', 'time')} AND user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        )
        ORDER BY time ASC
    """
    # Duplicate params 5 times for the 5 union tables
    full_params = params * 5
    c.execute(query, full_params)
    rows = c.fetchall()

    # Deduplicate redundant stationary micro-events while preserving moves, endpoints, and all kills
    compressed = []
    last_by_user = {}
    for r in rows:
        u = r[1]
        if u not in last_by_user:
            compressed.append(list(r))
            last_by_user[u] = r
            continue

        prev = last_by_user[u]
        dt = r[0] - prev[0]
        # If same user, exact same x and z, within 4 seconds, and not a kill event (action 3):
        if r[2] == prev[2] and r[4] == prev[4] and dt < 4 and r[5] != 3:
            continue

        compressed.append(list(r))
        last_by_user[u] = r

    return compressed


def get_placed_blocks(db_path: str, wid: int = 1, start_time: Optional[int] = None, end_time: Optional[int] = None) -> List[List[Any]]:
    """
    Retrieve unique 2D surface placed blocks [x, z, y, time, material_name, user_id]
    to render base constructions evolving over time on the canvas.
    """
    conn = get_connection(db_path)
    c = conn.cursor()

    time_clause = ""
    params: List[Any] = [wid]
    if start_time is not None and end_time is not None:
        time_clause = "AND b.time BETWEEN ? AND ?"
        params.extend([start_time, end_time])

    query = f"""
        SELECT b.x, b.z, max(b.y) as y, min(b.time) as first_time, m.material, b.user
        FROM co_block b
        JOIN co_material_map m ON b.type = m.id
        JOIN co_user u ON b.user = u.id
        WHERE b.wid = ? AND b.action = 1 {time_clause}
          AND u.user NOT LIKE '#%'
        GROUP BY b.x, b.z
        ORDER BY first_time ASC
    """
    c.execute(query, params)
    return [list(r) for r in c.fetchall()]


def get_events(db_path: str, wid: int = 1, start_time: Optional[int] = None, end_time: Optional[int] = None) -> Dict[str, Any]:
    """Retrieve kills/deaths, chat messages, and explosions."""
    conn = get_connection(db_path)
    c = conn.cursor()

    time_filter = ""
    params: List[Any] = [wid]
    if start_time is not None and end_time is not None:
        time_filter = "AND b.time BETWEEN ? AND ?"
        params.extend([start_time, end_time])

    # 1. Kills / Deaths
    c.execute(f"""
        SELECT b.time, killer.user, victim.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user killer ON b.user = killer.id
        JOIN co_user victim ON b.data = victim.id
        WHERE b.wid = ? AND b.action = 3 AND b.type = 0 {time_filter}
        ORDER BY b.time ASC
    """, params)
    deaths = [
        {
            "time": r[0],
            "killer": r[1],
            "victim": r[2],
            "x": r[3],
            "y": r[4],
            "z": r[5],
            "is_pvp": not r[1].startswith("#") and not r[2].startswith("#")
        }
        for r in c.fetchall()
    ]

    # 2. Chat messages
    chat_params: List[Any] = [wid]
    chat_filter = ""
    if start_time is not None and end_time is not None:
        chat_filter = "AND c.time BETWEEN ? AND ?"
        chat_params.extend([start_time, end_time])

    c.execute(f"""
        SELECT c.time, u.user, c.message, c.x, c.y, c.z
        FROM co_chat c
        JOIN co_user u ON c.user = u.id
        WHERE c.wid = ? {chat_filter}
        ORDER BY c.time ASC
    """, chat_params)
    chats = [
        {"time": r[0], "user": r[1], "message": r[2], "x": r[3], "y": r[4], "z": r[5]}
        for r in c.fetchall()
    ]

    # 3. Truly Detonated Explosions (TNT & Creeper)
    # 3a. Real #tnt damage blasts
    c.execute(f"""
        SELECT b.time, round(b.x / 10.0) * 10 as gx, round(b.z / 10.0) * 10 as gz,
               avg(b.x), avg(b.y), avg(b.z), count(*)
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        WHERE b.wid = ? AND u.user = '#tnt' AND b.action = 0 {time_filter}
        GROUP BY b.time, round(b.x / 10.0), round(b.z / 10.0)
        ORDER BY b.time ASC
    """, params)
    raw_tnt_blasts = c.fetchall()

    by_time_tnt = defaultdict(list)
    for r in raw_tnt_blasts:
        by_time_tnt[r[0]].append({'time': r[0], 'x': r[3], 'y': r[4], 'z': r[5], 'blocks': r[6]})

    tnt_explosions = []
    for t, items in by_time_tnt.items():
        clusters = []
        for item in items:
            found = False
            for cl in clusters:
                if math.hypot(cl['x'] - item['x'], cl['z'] - item['z']) <= 16:
                    total_cnt = cl['blocks'] + item['blocks']
                    cl['x'] = (cl['x'] * cl['blocks'] + item['x'] * item['blocks']) / total_cnt
                    cl['y'] = (cl['y'] * cl['blocks'] + item['y'] * item['blocks']) / total_cnt
                    cl['z'] = (cl['z'] * cl['blocks'] + item['z'] * item['blocks']) / total_cnt
                    cl['blocks'] = total_cnt
                    found = True
                    break
            if not found:
                clusters.append(item)
        for cl in clusters:
            cl['type'] = 'tnt'
            cl['user'] = '#tnt'
            tnt_explosions.append(cl)

    # 3b. Player TNT ignitions: attribute blasts and capture water/propellant explosions
    c.execute(f"""
        SELECT b.time, u.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        JOIN co_material_map m ON b.type = m.id
        WHERE b.wid = ? AND b.action = 0 AND m.material LIKE '%:tnt' AND u.user NOT LIKE '#%' {time_filter}
        ORDER BY b.time ASC
    """, params)
    player_tnts = c.fetchall()

    # Attribute #tnt blasts to players who lit TNT within 7 seconds and 40 blocks
    for exp in tnt_explosions:
        t_exp = exp['time']
        for p_time, p_user, px, py, pz in player_tnts:
            if 0 <= (t_exp - p_time) <= 7 and math.hypot(exp['x'] - px, exp['z'] - pz) <= 40:
                exp['user'] = p_user
                break

    # Add water/propellant detonations (ignitions that produced no nearby #tnt block damage)
    for p_time, p_user, px, py, pz in player_tnts:
        det_time = p_time + 4  # Standard Minecraft TNT fuse is 4.0s (80 ticks)
        has_nearby_blast = any(
            0 <= (exp['time'] - p_time) <= 6 and math.hypot(exp['x'] - px, exp['z'] - pz) <= 25
            for exp in tnt_explosions
        )
        if not has_nearby_blast:
            tnt_explosions.append({
                'time': det_time,
                'x': float(px),
                'y': float(py),
                'z': float(pz),
                'blocks': 0,
                'type': 'tnt',
                'user': p_user
            })

    # 3c. Real #creeper damage blasts
    c.execute(f"""
        SELECT b.time, round(b.x / 10.0) * 10 as gx, round(b.z / 10.0) * 10 as gz,
               avg(b.x), avg(b.y), avg(b.z), count(*)
        FROM co_block b
        JOIN co_user u ON b.user = u.id
        WHERE b.wid = ? AND u.user = '#creeper' AND b.action = 0 {time_filter}
        GROUP BY b.time, round(b.x / 10.0), round(b.z / 10.0)
        ORDER BY b.time ASC
    """, params)
    raw_creeper = c.fetchall()

    by_time_cr = defaultdict(list)
    for r in raw_creeper:
        by_time_cr[r[0]].append({'time': r[0], 'x': r[3], 'y': r[4], 'z': r[5], 'blocks': r[6]})

    creeper_explosions = []
    for t, items in by_time_cr.items():
        clusters = []
        for item in items:
            found = False
            for cl in clusters:
                if math.hypot(cl['x'] - item['x'], cl['z'] - item['z']) <= 16:
                    total_cnt = cl['blocks'] + item['blocks']
                    cl['x'] = (cl['x'] * cl['blocks'] + item['x'] * item['blocks']) / total_cnt
                    cl['y'] = (cl['y'] * cl['blocks'] + item['y'] * item['blocks']) / total_cnt
                    cl['z'] = (cl['z'] * cl['blocks'] + item['z'] * item['blocks']) / total_cnt
                    cl['blocks'] = total_cnt
                    found = True
                    break
            if not found:
                clusters.append(item)
        for cl in clusters:
            cl['type'] = 'creeper'
            cl['user'] = '#creeper'
            creeper_explosions.append(cl)

    explosions = tnt_explosions + creeper_explosions
    explosions.sort(key=lambda x: x['time'])

    return {
        "deaths": deaths,
        "chats": chats,
        "explosions": explosions
    }


def get_stats_at_time(db_path: str, target_time: int, player_filter: Optional[str] = None, team_filter: Optional[str] = None) -> Dict[str, Any]:
    """Calculate cumulative stats up to target_time."""
    conn = get_connection(db_path)
    c = conn.cursor()

    # Get meta to know players and teams
    meta = get_metadata(db_path)
    players_by_name = {p["name"]: p for p in meta["players"]}
    players_by_id = {p["id"]: p for p in meta["players"]}

    # Filtered player IDs
    allowed_uids = set(players_by_id.keys())
    if player_filter:
        allowed_uids = {uid for uid, p in players_by_id.items() if p["name"].lower() == player_filter.lower()}
    elif team_filter and team_filter.lower() != "all":
        allowed_uids = {uid for uid, p in players_by_id.items() if p["team"].lower() == team_filter.lower()}

    # Initialize stats per player
    stats = {}
    for uid in allowed_uids:
        p = players_by_id[uid]
        stats[p["name"]] = {
            "name": p["name"],
            "team": p["team"],
            "team_color": p["team_color"],
            "avatar_url": p["avatar_url"],
            "diamonds": 0,
            "iron": 0,
            "gold": 0,
            "ancient_debris": 0,
            "blocks_broken": 0,
            "blocks_placed": 0,
            "tnt_placed": 0,
            "tnt_detonated": 0,
            "kills": 0,
            "deaths": 0,
            "score": 0
        }

    # 1. Ores & Blocks Broken / TNT Detonated
    c.execute("""
        SELECT b.user, m.material, count(*)
        FROM co_block b
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 0 AND b.time <= ? AND b.user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        GROUP BY b.user, m.material
    """, (target_time,))
    for uid, mat, count in c.fetchall():
        if uid not in players_by_id:
            continue
        pname = players_by_id[uid]["name"]
        if pname not in stats:
            continue
        stats[pname]["blocks_broken"] += count
        if ":tnt" in mat:
            stats[pname]["tnt_detonated"] += count
        elif "diamond_ore" in mat:
            stats[pname]["diamonds"] += count
        elif "iron_ore" in mat:
            stats[pname]["iron"] += count
        elif "gold_ore" in mat:
            stats[pname]["gold"] += count
        elif "ancient_debris" in mat:
            stats[pname]["ancient_debris"] += count

    # 2. Blocks Placed & TNT
    c.execute("""
        SELECT b.user, m.material, count(*)
        FROM co_block b
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 1 AND b.time <= ? AND b.user IN (SELECT id FROM co_user WHERE user NOT LIKE '#%')
        GROUP BY b.user, m.material
    """, (target_time,))
    for uid, mat, count in c.fetchall():
        if uid not in players_by_id:
            continue
        pname = players_by_id[uid]["name"]
        if pname not in stats:
            continue
        stats[pname]["blocks_placed"] += count
        if ":tnt" in mat:
            stats[pname]["tnt_placed"] += count

    # 3. Kills (PvP kills by player)
    c.execute("""
        SELECT killer.user, count(*)
        FROM co_block b
        JOIN co_user killer ON b.user = killer.id
        JOIN co_user victim ON b.data = victim.id
        WHERE b.action = 3 AND b.type = 0 AND b.time <= ?
          AND killer.user NOT LIKE '#%'
          AND victim.user NOT LIKE '#%'
        GROUP BY killer.user
    """, (target_time,))
    for killer_name, count in c.fetchall():
        if killer_name in stats:
            stats[killer_name]["kills"] += count

    # 4. Deaths
    c.execute("""
        SELECT victim.user, count(*)
        FROM co_block b
        JOIN co_user victim ON b.data = victim.id
        WHERE b.action = 3 AND b.type = 0 AND b.time <= ?
          AND victim.user NOT LIKE '#%'
        GROUP BY victim.user
    """, (target_time,))
    for victim_name, count in c.fetchall():
        if victim_name in stats:
            stats[victim_name]["deaths"] += count

    # Compute custom FK Score: Diamonds*50 + Kills*100 + Iron*5 + Gold*10 + TNT_placed*15 + TNT_detonated*20 - Deaths*25
    for s in stats.values():
        s["score"] = (
            s["diamonds"] * 50
            + s["kills"] * 100
            + s["ancient_debris"] * 75
            + s["gold"] * 10
            + s["iron"] * 5
            + s["tnt_placed"] * 15
            + s["tnt_detonated"] * 20
            - s["deaths"] * 25
        )

    # Leaderboard sorted by score / diamonds
    leaderboard = sorted(stats.values(), key=lambda x: (x["score"], x["diamonds"], x["kills"]), reverse=True)

    # Totals
    totals = {
        "diamonds": sum(s["diamonds"] for s in stats.values()),
        "iron": sum(s["iron"] for s in stats.values()),
        "gold": sum(s["gold"] for s in stats.values()),
        "ancient_debris": sum(s["ancient_debris"] for s in stats.values()),
        "blocks_broken": sum(s["blocks_broken"] for s in stats.values()),
        "blocks_placed": sum(s["blocks_placed"] for s in stats.values()),
        "tnt_placed": sum(s["tnt_placed"] for s in stats.values()),
        "tnt_detonated": sum(s["tnt_detonated"] for s in stats.values()),
        "kills": sum(s["kills"] for s in stats.values()),
        "deaths": sum(s["deaths"] for s in stats.values())
    }

    return {
        "timestamp": target_time,
        "totals": totals,
        "leaderboard": leaderboard
    }


def get_timeline_analytics(db_path: str, bucket_sec: int = 60) -> Dict[str, Any]:
    """
    Generate time series analytics for resource mining, kills, TNT explosions and FK score
    grouped by team in fixed time intervals (buckets).
    """
    conn = get_connection(db_path)
    c = conn.cursor()
    meta = get_metadata(db_path)

    match_start = meta["time_range"]["match_start"] or meta["time_range"]["min_time"]
    match_stop = meta["time_range"]["match_stop"] or meta["time_range"]["max_time"]
    if match_stop <= match_start:
        match_stop = match_start + 3600

    # Player to team mapping
    player_teams = {}
    for p in meta["players"]:
        player_teams[p["id"]] = p["team"]
        player_teams[p["name"]] = p["team"]

    # Active teams list with colors and labels
    teams_map = {}
    for p in meta["players"]:
        t = p["team"]
        if t != "neutral" and t not in teams_map:
            teams_map[t] = {
                "name": t,
                "color": p["team_color"],
                "label": TEAM_LABELS_FR.get(t, t.capitalize())
            }
    active_team_keys = list(teams_map.keys())

    # Build bucket bounds
    duration = match_stop - match_start
    if duration > 18000 and bucket_sec < 120:
        bucket_sec = 120

    num_buckets = max(1, math.ceil(duration / bucket_sec))

    # Pre-fetch all relevant events
    # 1. Ores mined (diamond, iron, gold, ancient_debris)
    c.execute("""
        SELECT b.time, b.user, m.material
        FROM co_block b
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 0 AND b.time BETWEEN ? AND ?
          AND (m.material LIKE '%diamond_ore%' OR m.material LIKE '%iron_ore%' 
               OR m.material LIKE '%gold_ore%' OR m.material LIKE '%ancient_debris%')
        ORDER BY b.time ASC
    """, (match_start, match_stop))
    ore_events = c.fetchall()

    # 2. PvP Kills
    c.execute("""
        SELECT b.time, killer.user
        FROM co_block b
        JOIN co_user killer ON b.user = killer.id
        JOIN co_user victim ON b.data = victim.id
        WHERE b.action = 3 AND b.type = 0 AND b.time BETWEEN ? AND ?
          AND killer.user NOT LIKE '#%' AND victim.user NOT LIKE '#%'
        ORDER BY b.time ASC
    """, (match_start, match_stop))
    kill_events = c.fetchall()

    # 3. TNT Detonated
    c.execute("""
        SELECT b.time, b.user
        FROM co_block b
        JOIN co_material_map m ON b.type = m.id
        WHERE b.action = 0 AND m.material LIKE '%:tnt' AND b.time BETWEEN ? AND ?
        ORDER BY b.time ASC
    """, (match_start, match_stop))
    tnt_events = c.fetchall()

    ore_idx = 0
    kill_idx = 0
    tnt_idx = 0
    num_ores = len(ore_events)
    num_kills = len(kill_events)
    num_tnt = len(tnt_events)

    cum_diamonds = {t: 0 for t in active_team_keys}
    cum_gold = {t: 0 for t in active_team_keys}
    cum_iron = {t: 0 for t in active_team_keys}
    cum_ancient_debris = {t: 0 for t in active_team_keys}
    cum_kills = {t: 0 for t in active_team_keys}
    cum_tnt = {t: 0 for t in active_team_keys}

    series = []
    for i in range(num_buckets + 1):
        bucket_time = match_start + i * bucket_sec
        if bucket_time > match_stop:
            bucket_time = match_stop

        # Advance ores up to bucket_time
        while ore_idx < num_ores and ore_events[ore_idx][0] <= bucket_time:
            ot, uid, mat = ore_events[ore_idx]
            team = player_teams.get(uid, "neutral")
            if team in cum_diamonds:
                if "diamond_ore" in mat:
                    cum_diamonds[team] += 1
                elif "gold_ore" in mat:
                    cum_gold[team] += 1
                elif "iron_ore" in mat:
                    cum_iron[team] += 1
                elif "ancient_debris" in mat:
                    cum_ancient_debris[team] += 1
            ore_idx += 1

        # Advance kills
        while kill_idx < num_kills and kill_events[kill_idx][0] <= bucket_time:
            kt, kname = kill_events[kill_idx]
            team = player_teams.get(kname, "neutral")
            if team in cum_kills:
                cum_kills[team] += 1
            kill_idx += 1

        # Advance TNT
        while tnt_idx < num_tnt and tnt_events[tnt_idx][0] <= bucket_time:
            tt, uid = tnt_events[tnt_idx]
            team = player_teams.get(uid, "neutral")
            if team in cum_tnt:
                cum_tnt[team] += 1
            tnt_idx += 1

        # Calculate scores
        scores = {}
        for t in active_team_keys:
            scores[t] = (
                cum_diamonds[t] * 50
                + cum_kills[t] * 100
                + cum_ancient_debris[t] * 75
                + cum_gold[t] * 10
                + cum_iron[t] * 5
                + cum_tnt[t] * 20
            )

        elapsed = bucket_time - match_start
        day = math.floor(elapsed / 1200) + 1

        series.append({
            "time": bucket_time,
            "elapsed": elapsed,
            "day": day,
            "diamonds": dict(cum_diamonds),
            "gold": dict(cum_gold),
            "iron": dict(cum_iron),
            "kills": dict(cum_kills),
            "tnt": dict(cum_tnt),
            "score": scores
        })

        if bucket_time >= match_stop:
            break

    return {
        "start_time": match_start,
        "stop_time": match_stop,
        "bucket_sec": bucket_sec,
        "teams": list(teams_map.values()),
        "series": series
    }


def get_pvp_duel_matrix(db_path: str) -> Dict[str, Any]:
    """
    Generate team vs team kill/death matrix, player vs player duels,
    and individual Nemesis / Favorite Victim badges.
    """
    conn = get_connection(db_path)
    c = conn.cursor()
    meta = get_metadata(db_path)

    players_by_name = {p["name"]: p for p in meta["players"]}
    teams_set = {p["team"] for p in meta["players"] if p["team"] != "neutral"}
    active_teams = sorted(list(teams_set))

    c.execute("""
        SELECT b.time, killer.user, victim.user, b.x, b.y, b.z
        FROM co_block b
        JOIN co_user killer ON b.user = killer.id
        JOIN co_user victim ON b.data = victim.id
        WHERE b.action = 3 AND b.type = 0
          AND killer.user NOT LIKE '#%' AND victim.user NOT LIKE '#%'
        ORDER BY b.time ASC
    """)
    kills_data = c.fetchall()

    team_vs_team = {kt: {vt: 0 for vt in active_teams} for kt in active_teams}
    player_duels = defaultdict(lambda: defaultdict(int))
    player_kills = defaultdict(int)
    player_deaths = defaultdict(int)

    for r in kills_data:
        kt_time, killer, victim, kx, ky, kz = r
        if killer in players_by_name and victim in players_by_name:
            k_team = players_by_name[killer]["team"]
            v_team = players_by_name[victim]["team"]

            if k_team in team_vs_team and v_team in team_vs_team[k_team]:
                team_vs_team[k_team][v_team] += 1

            player_duels[killer][victim] += 1
            player_kills[killer] += 1
            player_deaths[victim] += 1

    duels_list = []
    # Freeze dictionary to prevent defaultdict mutation during iteration
    duels_dict = {k: dict(v) for k, v in player_duels.items()}
    for killer, victims in duels_dict.items():
        k_obj = players_by_name.get(killer, {})
        for victim, count in victims.items():
            v_obj = players_by_name.get(victim, {})
            reverse_count = duels_dict.get(victim, {}).get(killer, 0)
            duels_list.append({
                "killer": killer,
                "killer_team": k_obj.get("team", "neutral"),
                "killer_team_color": k_obj.get("team_color", "#94a3b8"),
                "killer_avatar": k_obj.get("avatar_url", ""),
                "victim": victim,
                "victim_team": v_obj.get("team", "neutral"),
                "victim_team_color": v_obj.get("team_color", "#94a3b8"),
                "victim_avatar": v_obj.get("avatar_url", ""),
                "kills": count,
                "deaths_to_victim": reverse_count
            })

    duels_list.sort(key=lambda d: (d["kills"], -d["deaths_to_victim"]), reverse=True)

    rivalries = {}
    for p in meta["players"]:
        pname = p["name"]
        nemesis_name = None
        nemesis_count = 0
        for killer, victims in duels_dict.items():
            if victims.get(pname, 0) > nemesis_count:
                nemesis_count = victims[pname]
                nemesis_name = killer

        victim_name = None
        victim_count = 0
        for v, cnt in duels_dict.get(pname, {}).items():
            if cnt > victim_count:
                victim_count = cnt
                victim_name = v

        rivalries[pname] = {
            "nemesis": {"name": nemesis_name, "count": nemesis_count, "color": players_by_name[nemesis_name]["team_color"] if nemesis_name in players_by_name else "#94a3b8"} if nemesis_name else None,
            "favorite_victim": {"name": victim_name, "count": victim_count, "color": players_by_name[victim_name]["team_color"] if victim_name in players_by_name else "#94a3b8"} if victim_name else None,
            "kills": player_kills[pname],
            "deaths": player_deaths[pname],
            "kd_ratio": round(player_kills[pname] / max(1, player_deaths[pname]), 2)
        }

    return {
        "teams": active_teams,
        "team_matrix": team_vs_team,
        "duels": duels_list,
        "rivalries": rivalries,
        "total_pvp_kills": len(kills_data)
    }


def get_match_recap(db_path: str) -> Dict[str, Any]:
    """
    Generate an exhaustive post-match summary report with rankings,
    MVPs, key records and a formatted Discord Markdown export.
    """
    meta = get_metadata(db_path)

    match_start = meta["time_range"]["match_start"] or meta["time_range"]["min_time"]
    match_stop = meta["time_range"]["match_stop"] or meta["time_range"]["max_time"]

    final_stats_res = get_stats_at_time(db_path, match_stop)
    leaderboard = final_stats_res["leaderboard"]
    totals = final_stats_res["totals"]

    team_stats = defaultdict(lambda: {
        "score": 0, "diamonds": 0, "kills": 0, "deaths": 0,
        "tnt_detonated": 0, "iron": 0, "gold": 0, "ancient_debris": 0,
        "players": []
    })
    for p in leaderboard:
        t = p["team"]
        if t == "neutral":
            continue
        team_stats[t]["score"] += p["score"]
        team_stats[t]["diamonds"] += p["diamonds"]
        team_stats[t]["kills"] += p["kills"]
        team_stats[t]["deaths"] += p["deaths"]
        team_stats[t]["tnt_detonated"] += p.get("tnt_detonated", 0)
        team_stats[t]["iron"] += p["iron"]
        team_stats[t]["gold"] += p["gold"]
        team_stats[t]["ancient_debris"] += p.get("ancient_debris", 0)
        team_stats[t]["players"].append(p["name"])

    team_rankings = []
    for t_name, s in team_stats.items():
        team_rankings.append({
            "team": t_name,
            "label": TEAM_LABELS_FR.get(t_name, t_name.capitalize()),
            "color": get_team_color(t_name),
            "score": s["score"],
            "diamonds": s["diamonds"],
            "kills": s["kills"],
            "deaths": s["deaths"],
            "tnt_detonated": s["tnt_detonated"],
            "kd_ratio": round(s["kills"] / max(1, s["deaths"]), 2),
            "players": s["players"]
        })
    team_rankings.sort(key=lambda x: (x["score"], x["kills"], x["diamonds"]), reverse=True)

    mvp = leaderboard[0] if leaderboard else None
    mining_king = max(leaderboard, key=lambda x: x["diamonds"]) if leaderboard else None
    weapons_master = max(leaderboard, key=lambda x: x["kills"]) if leaderboard else None
    blaster = max(leaderboard, key=lambda x: x.get("tnt_detonated", 0)) if leaderboard else None

    duel_data = get_pvp_duel_matrix(db_path)

    duration_sec = max(0, match_stop - match_start)
    h = duration_sec // 3600
    m = (duration_sec % 3600) // 60
    s = duration_sec % 60
    duration_str = f"{h:02d}h {m:02d}m {s:02d}s"
    mc_days = math.floor(duration_sec / 1200) + 1

    team_emojis = {
        "yellow": "🟡",
        "purple": "🟣",
        "green": "🟢",
        "blue": "🔵",
        "red": "🔴",
        "cyan": "🔷",
        "orange": "🟠",
        "pink": "🌸",
        "white": "⚪",
        "gray": "🔘"
    }

    lines = [
        "════════════════════════════════════════",
        "🏆 **RÉCAPITULATIF DU MATCH FALLEN KINGDOMS** 🏆",
        "════════════════════════════════════════",
        f"⏱️ **Durée :** {duration_str} ({mc_days} Jours Minecraft)",
        f"👥 **Combattants :** {len(leaderboard)} joueurs | {len(team_rankings)} équipes",
        f"⚔️ **Total Kills PvP :** {totals.get('kills', 0)} | 💎 **Diamants :** {totals.get('diamonds', 0)} | 💥 **TNT :** {totals.get('tnt_detonated', 0)}",
        "",
        "🥇 **CLASSEMENT FINAL DES ÉQUIPES :**"
    ]

    medals = ["🥇", "🥈", "🥉", "🎖️"]
    for idx, tr in enumerate(team_rankings):
        medal = medals[idx] if idx < len(medals) else "•"
        emoji = team_emojis.get(tr["team"], "⚔️")
        lines.append(
            f"{medal} {emoji} **Équipe {tr['label']}** — **{tr['score']:,} pts**\n"
            f"   └ ⚔️ {tr['kills']} kills | 💀 {tr['deaths']} morts (K/D {tr['kd_ratio']}) | 💎 {tr['diamonds']} diamants | 💥 {tr['tnt_detonated']} TNT"
        )

    lines.extend([
        "",
        "⭐ **DISTINCTIONS INDIVIDUELLES (AWARDS) :**"
    ])
    if mvp:
        t_emoji = team_emojis.get(mvp["team"], "")
        lines.append(f"👑 **MVP du Match :** {mvp['name']} ({t_emoji} {mvp['team'].capitalize()}) — **{mvp['score']:,} pts**")
    if weapons_master and weapons_master["kills"] > 0:
        t_emoji = team_emojis.get(weapons_master["team"], "")
        lines.append(f"⚔️ **Maître d'Armes :** {weapons_master['name']} ({t_emoji} {weapons_master['team'].capitalize()}) — **{weapons_master['kills']} kills**")
    if mining_king and mining_king["diamonds"] > 0:
        t_emoji = team_emojis.get(mining_king["team"], "")
        lines.append(f"💎 **Roi du Minage :** {mining_king['name']} ({t_emoji} {mining_king['team'].capitalize()}) — **{mining_king['diamonds']} diamants**")
    if blaster and blaster.get("tnt_detonated", 0) > 0:
        t_emoji = team_emojis.get(blaster["team"], "")
        lines.append(f"💥 **Artificier en Chef :** {blaster['name']} ({t_emoji} {blaster['team'].capitalize()}) — **{blaster['tnt_detonated']} TNT détonées**")

    if duel_data.get("duels"):
        lines.extend([
            "",
            "⚔️ **DUELS MAJEURS :**"
        ])
        for d in duel_data["duels"][:5]:
            if d["kills"] >= 2:
                lines.append(f"• **{d['killer']}** a éliminé **{d['victim']}** **{d['kills']} fois** (réplique: {d['deaths_to_victim']} fois)")

    lines.extend([
        "════════════════════════════════════════",
        "📊 *Généré automatiquement par Fallen Kingdoms Replay 2D*"
    ])

    discord_md = "\n".join(lines)

    return {
        "summary": {
            "duration_seconds": duration_sec,
            "duration_formatted": duration_str,
            "minecraft_days": mc_days,
            "match_start": match_start,
            "match_stop": match_stop,
            "total_players": len(leaderboard),
            "total_kills": totals.get("kills", 0),
            "total_diamonds": totals.get("diamonds", 0),
            "total_tnt_detonated": totals.get("tnt_detonated", 0)
        },
        "team_rankings": team_rankings,
        "awards": {
            "mvp": mvp,
            "mining_king": mining_king,
            "weapons_master": weapons_master,
            "blaster": blaster
        },
        "discord_markdown": discord_md
    }

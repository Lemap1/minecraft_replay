import os
import glob
import shutil
from typing import Optional
from fastapi import FastAPI, Query, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend import db_reader

app = FastAPI(
    title="Fallen Kingdoms - Match Replay 2D",
    description="2D Visualizer and Replay System for Minecraft Fallen Kingdoms CoreProtect Logs",
    version="1.0.0"
)

# Enable CORS and GZip for high-speed compressed JSON responses
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.get("/api/databases")
def get_databases():
    """List all available SQLite databases."""
    try:
        return {"databases": db_reader.list_databases()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/meta")
def get_metadata(db: Optional[str] = Query(None)):
    """Get match metadata, players, teams, bases, bounds and milestones."""
    try:
        db_path = db_reader.resolve_db_path(db)
        meta = db_reader.get_metadata(db_path)
        return meta
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/trajectories")
def get_trajectories(
    db: Optional[str] = Query(None),
    world: int = Query(1),
    start: Optional[int] = Query(None),
    end: Optional[int] = Query(None)
):
    """Retrieve player movement and spatial action points."""
    try:
        db_path = db_reader.resolve_db_path(db)
        points = db_reader.get_player_trajectories(db_path, wid=world, start_time=start, end_time=end)
        return {"world": world, "count": len(points), "points": points}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/placed-blocks")
def get_placed_blocks(
    db: Optional[str] = Query(None),
    world: int = Query(1),
    start: Optional[int] = Query(None),
    end: Optional[int] = Query(None)
):
    """Retrieve surface placed blocks to render base constructions evolving over time."""
    try:
        db_path = db_reader.resolve_db_path(db)
        blocks = db_reader.get_placed_blocks(db_path, wid=world, start_time=start, end_time=end)
        return {"world": world, "count": len(blocks), "blocks": blocks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/events")
def get_events(
    db: Optional[str] = Query(None),
    world: int = Query(1),
    start: Optional[int] = Query(None),
    end: Optional[int] = Query(None)
):
    """Retrieve match events: kills/deaths, chats, and explosions."""
    try:
        db_path = db_reader.resolve_db_path(db)
        evts = db_reader.get_events(db_path, wid=world, start_time=start, end_time=end)
        return evts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats")
def get_stats(
    db: Optional[str] = Query(None),
    time: int = Query(..., description="Timestamp to calculate cumulative stats up to"),
    player: Optional[str] = Query(None),
    team: Optional[str] = Query(None)
):
    """Retrieve live stats up to specified timestamp."""
    try:
        db_path = db_reader.resolve_db_path(db)
        stats = db_reader.get_stats_at_time(db_path, target_time=time, player_filter=player, team_filter=team)
        return stats
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics")
def get_analytics(
    db: Optional[str] = Query(None),
    bucket: int = Query(60, description="Bucket interval in seconds (default: 60s)")
):
    """Retrieve time-series analytics (ores, kills, TNT, scores) per team."""
    try:
        db_path = db_reader.resolve_db_path(db)
        data = db_reader.get_timeline_analytics(db_path, bucket_sec=bucket)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/duel-matrix")
def get_duel_matrix(db: Optional[str] = Query(None)):
    """Retrieve PvP team matrix, player head-to-head duels, and nemesis/victim badges."""
    try:
        db_path = db_reader.resolve_db_path(db)
        data = db_reader.get_pvp_duel_matrix(db_path)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/match-recap")
def get_match_recap(db: Optional[str] = Query(None)):
    """Retrieve end-of-game awards, rankings, summary, and Discord Markdown text."""
    try:
        db_path = db_reader.resolve_db_path(db)
        recap = db_reader.get_match_recap(db_path)
        return recap
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/map-image")
def get_map_image(db: Optional[str] = Query(None), world: int = Query(1)):
    """Return custom map image if available for the specified world (1=Overworld, 2=Nether)."""
    db_path = db_reader.resolve_db_path(db)
    map_info = db_reader.resolve_map_image(db_path, wid=world)
    if not map_info:
        raise HTTPException(status_code=404, detail="No custom map image found for this world")

    image_path, mtime = map_info
    return FileResponse(
        image_path,
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "ETag": f'"{mtime}"'
        }
    )


@app.post("/api/upload-database")
async def upload_database(file: UploadFile = File(...)):
    """Upload a new SQLite database file."""
    if not file.filename.endswith((".db", ".sqlite", ".sqlite3")):
        raise HTTPException(status_code=400, detail="Only .db or .sqlite files are allowed")

    os.makedirs("data", exist_ok=True)
    target_path = os.path.join("data", file.filename)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db_reader.clear_cache()
    return {
        "success": True,
        "filename": file.filename,
        "path": target_path,
        "databases": db_reader.list_databases()
    }


@app.post("/api/upload-map")
async def upload_map(file: UploadFile = File(...), db: Optional[str] = Query(None)):
    """Upload a custom map PNG image and synchronize across all target locations."""
    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg")):
        raise HTTPException(status_code=400, detail="Only PNG or JPG image files are allowed")

    os.makedirs("data", exist_ok=True)
    db_base = os.path.splitext(os.path.basename(db))[0] if db else None
    if db_base:
        target_path = os.path.join("data", f"{db_base}_map.png")
    else:
        target_path = os.path.join("data", "map.png")

    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    def _safe_copy(src: str, dst: str):
        if not os.path.exists(src) or os.path.abspath(src) == os.path.abspath(dst):
            return
        try:
            d = os.path.dirname(dst)
            if d:
                os.makedirs(d, exist_ok=True)
            shutil.copyfile(src, dst)
        except Exception:
            pass

    # Synchronize to root and Docker volume locations cleanly
    sync_targets = ["map.png", "/app/data/map.png", "/app/data/data/map.png", "frontend/map.png", "/app/frontend/map.png"]
    if db_base:
        sync_targets.extend([
            f"{db_base}_map.png",
            f"/app/data/{db_base}_map.png",
            f"/app/data/data/{db_base}_map.png",
            f"frontend/{db_base}_map.png",
            f"/app/frontend/{db_base}_map.png"
        ])

    for t in sync_targets:
        _safe_copy(target_path, t)

    db_reader.clear_cache()
    return {"success": True, "path": target_path}


@app.post("/api/save-map-bounds")
def save_map_bounds(bounds: dict, db: Optional[str] = Query(None)):
    """Save custom coordinate bounds for map.png overlay."""
    import json
    os.makedirs("data", exist_ok=True)
    db_base = os.path.splitext(os.path.basename(db))[0] if db else None
    if db_base:
        target = os.path.join("data", f"{db_base}_map_config.json")
    else:
        target = os.path.join("data", "map_config.json")

    with open(target, "w", encoding="utf-8") as f:
        json.dump(bounds, f, indent=2)

    def _safe_copy(src: str, dst: str):
        if not os.path.exists(src) or os.path.abspath(src) == os.path.abspath(dst):
            return
        try:
            d = os.path.dirname(dst)
            if d:
                os.makedirs(d, exist_ok=True)
            shutil.copyfile(src, dst)
        except Exception:
            pass

    sync_targets = ["map_config.json", "/app/data/map_config.json", "/app/data/data/map_config.json"]
    if db_base:
        sync_targets.extend([
            f"{db_base}_map_config.json",
            f"/app/data/{db_base}_map_config.json",
            f"/app/data/data/{db_base}_map_config.json"
        ])

    for t in sync_targets:
        _safe_copy(target, t)

    db_reader.clear_cache()
    return {"success": True, "bounds": bounds}


@app.post("/api/regenerate-map")
def regenerate_map(db: Optional[str] = Query(None)):
    """Regenerate map.png from region files in data/map/region/ or server-specific region folder."""
    db_base = os.path.splitext(os.path.basename(db))[0] if db else None

    region_candidates = []
    if db_base:
        region_candidates.extend([
            f"data/map/{db_base}/region",
            f"data/{db_base}/region",
            f"data/{db_base}/map/region",
            f"/app/data/data/map/{db_base}/region",
            f"/app/data/data/{db_base}/region",
            f"/app/data/map/{db_base}/region",
            f"/app/data/{db_base}/region",
        ])

    region_candidates.extend([
        "data/map/region",
        "map/region",
        "data/region",
        "/app/data/data/map/region",
        "/app/data/map/region",
        "/app/data/data/region",
        "/app/data/region",
    ])

    region_dir = None
    for d in region_candidates:
        if os.path.exists(d) and glob.glob(os.path.join(d, "r.*.*.mca")):
            region_dir = d
            break

    if not region_dir:
        target_name = f"pour le serveur '{db_base}' " if db_base else ""
        raise HTTPException(
            status_code=404,
            detail=f"Aucun fichier de région (.mca) trouvé {target_name}dans data/map/region/."
        )

    try:
        from backend import render_map
        config = render_map.render_all_regions(
            region_dir=region_dir,
            output_png="data/map.png",
            db_name=db
        )
        db_reader.clear_cache()
        return {
            "success": True,
            "message": f"Carte regénérée avec succès ({config['width']}x{config['height']} px) !",
            "bounds": config
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du rendu de la carte : {str(e)}")


# Serve static frontend files
app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
def serve_index():
    """Serve frontend index.html."""
    return FileResponse("frontend/index.html")

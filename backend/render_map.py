"""
Renderer for Minecraft 1.21 Anvil .mca Region Files
Converts region/*.mca files into a high-definition 2D top-down map image (PNG)
with block colors, water transparency, and relief hill-shading.
"""

import os
import re
import glob
import io
import zlib
import time
import json
import shutil
import numpy as np
from PIL import Image
import nbtlib

# Color palette for Minecraft blocks (RGB)
BLOCK_COLORS = {
    # Grass & Foliage
    "minecraft:grass_block": (91, 142, 58),
    "minecraft:short_grass": (91, 142, 58),
    "minecraft:tall_grass": (91, 142, 58),
    "minecraft:fern": (91, 142, 58),
    "minecraft:large_fern": (91, 142, 58),
    "minecraft:moss_block": (89, 109, 45),
    "minecraft:moss_carpet": (89, 109, 45),
    "minecraft:oak_leaves": (60, 105, 40),
    "minecraft:spruce_leaves": (51, 80, 51),
    "minecraft:birch_leaves": (80, 107, 51),
    "minecraft:jungle_leaves": (48, 98, 25),
    "minecraft:acacia_leaves": (78, 102, 37),
    "minecraft:dark_oak_leaves": (40, 75, 25),
    "minecraft:mangrove_leaves": (60, 100, 35),
    "minecraft:cherry_leaves": (235, 175, 195),
    "minecraft:azalea_leaves": (90, 115, 45),
    "minecraft:flowering_azalea_leaves": (130, 105, 75),

    # Earth & Stone
    "minecraft:dirt": (134, 96, 67),
    "minecraft:coarse_dirt": (119, 85, 59),
    "minecraft:rooted_dirt": (144, 103, 76),
    "minecraft:mud": (60, 57, 63),
    "minecraft:farmland": (100, 70, 48),
    "minecraft:podzol": (90, 63, 40),
    "minecraft:mycelium": (111, 99, 105),
    "minecraft:sand": (219, 211, 160),
    "minecraft:red_sand": (190, 103, 33),
    "minecraft:gravel": (136, 126, 126),
    "minecraft:clay": (160, 166, 179),
    "minecraft:stone": (125, 125, 125),
    "minecraft:smooth_stone": (158, 158, 158),
    "minecraft:smooth_stone_slab": (158, 158, 158),
    "minecraft:granite": (153, 113, 98),
    "minecraft:polished_granite": (155, 115, 100),
    "minecraft:diorite": (185, 185, 187),
    "minecraft:polished_diorite": (190, 190, 192),
    "minecraft:andesite": (136, 136, 138),
    "minecraft:polished_andesite": (136, 136, 138),
    "minecraft:deepslate": (67, 67, 71),
    "minecraft:cobbled_deepslate": (75, 75, 78),
    "minecraft:polished_deepslate": (70, 70, 74),
    "minecraft:deepslate_bricks": (60, 60, 63),
    "minecraft:deepslate_tiles": (55, 55, 58),
    "minecraft:tuff": (108, 109, 102),
    "minecraft:cobblestone": (120, 120, 120),
    "minecraft:mossy_cobblestone": (110, 125, 105),
    "minecraft:stone_bricks": (122, 122, 122),
    "minecraft:mossy_stone_bricks": (112, 124, 108),
    "minecraft:bricks": (150, 97, 83),
    "minecraft:mud_bricks": (138, 105, 78),
    "minecraft:sandstone": (216, 203, 155),
    "minecraft:red_sandstone": (181, 97, 31),
    "minecraft:calcite": (224, 225, 220),

    # Water & Ice
    "minecraft:water": (46, 103, 168),
    "minecraft:ice": (144, 186, 252),
    "minecraft:packed_ice": (165, 200, 252),
    "minecraft:blue_ice": (116, 167, 253),
    "minecraft:snow": (240, 248, 255),
    "minecraft:snow_block": (240, 248, 255),
    "minecraft:powder_snow": (245, 250, 255),

    # Wood & Planks
    "minecraft:oak_planks": (162, 130, 78),
    "minecraft:spruce_planks": (104, 78, 48),
    "minecraft:birch_planks": (196, 180, 124),
    "minecraft:jungle_planks": (160, 115, 80),
    "minecraft:acacia_planks": (168, 90, 50),
    "minecraft:dark_oak_planks": (66, 43, 20),
    "minecraft:mangrove_planks": (117, 54, 48),
    "minecraft:cherry_planks": (226, 178, 172),
    "minecraft:bamboo_planks": (195, 172, 74),
    "minecraft:oak_log": (109, 85, 52),
    "minecraft:spruce_log": (59, 39, 19),
    "minecraft:birch_log": (214, 214, 210),
    "minecraft:jungle_log": (85, 68, 25),
    "minecraft:acacia_log": (103, 96, 86),
    "minecraft:dark_oak_log": (60, 48, 26),

    # Construction & Colored
    "minecraft:white_wool": (233, 236, 236),
    "minecraft:orange_wool": (240, 118, 19),
    "minecraft:magenta_wool": (189, 68, 179),
    "minecraft:light_blue_wool": (58, 175, 217),
    "minecraft:yellow_wool": (248, 197, 39),
    "minecraft:lime_wool": (112, 185, 25),
    "minecraft:pink_wool": (237, 141, 172),
    "minecraft:gray_wool": (62, 68, 71),
    "minecraft:light_gray_wool": (142, 142, 134),
    "minecraft:cyan_wool": (21, 137, 145),
    "minecraft:purple_wool": (121, 42, 172),
    "minecraft:blue_wool": (53, 57, 157),
    "minecraft:brown_wool": (114, 71, 40),
    "minecraft:green_wool": (84, 109, 27),
    "minecraft:red_wool": (160, 39, 34),
    "minecraft:black_wool": (20, 21, 25),

    # Terracotta
    "minecraft:terracotta": (152, 94, 68),
    "minecraft:white_terracotta": (209, 178, 161),
    "minecraft:orange_terracotta": (161, 83, 37),
    "minecraft:magenta_terracotta": (149, 88, 109),
    "minecraft:light_blue_terracotta": (113, 109, 138),
    "minecraft:yellow_terracotta": (186, 133, 35),
    "minecraft:lime_terracotta": (103, 117, 52),
    "minecraft:pink_terracotta": (161, 78, 78),
    "minecraft:gray_terracotta": (57, 42, 35),
    "minecraft:light_gray_terracotta": (135, 107, 98),
    "minecraft:cyan_terracotta": (87, 91, 91),
    "minecraft:purple_terracotta": (118, 70, 86),
    "minecraft:blue_terracotta": (74, 60, 91),
    "minecraft:brown_terracotta": (77, 51, 36),
    "minecraft:green_terracotta": (76, 83, 42),
    "minecraft:red_terracotta": (143, 61, 46),
    "minecraft:black_terracotta": (37, 22, 16),

    # Specials
    "minecraft:obsidian": (25, 20, 40),
    "minecraft:nether_portal": (110, 45, 175),
    "minecraft:lava": (217, 88, 28),
    "minecraft:glass": (200, 225, 235),
    "minecraft:sea_lantern": (172, 216, 210),
    "minecraft:glowstone": (190, 145, 80),
    "minecraft:tnt": (219, 60, 48),
    "minecraft:chest": (165, 115, 45),
    "minecraft:iron_block": (215, 215, 215),
    "minecraft:gold_block": (245, 205, 45),
    "minecraft:diamond_block": (95, 235, 225),
    "minecraft:emerald_block": (45, 185, 100),
    "minecraft:copper_block": (192, 107, 80),
    "minecraft:netherrack": (110, 38, 38),
    "minecraft:bedrock": (36, 36, 36)
}

# Color cache for fast lookup
_color_cache = {}


def get_block_color(block_name: str) -> tuple:
    """Resolve an RGB color tuple for any Minecraft block."""
    if block_name in _color_cache:
        return _color_cache[block_name]

    if block_name in BLOCK_COLORS:
        c = BLOCK_COLORS[block_name]
        _color_cache[block_name] = c
        return c

    # Heuristic match
    bn = block_name.lower()
    if "water" in bn: c = (46, 103, 168)
    elif "grass" in bn or "leaves" in bn or "vine" in bn or "plant" in bn or "fern" in bn: c = (70, 115, 45)
    elif "stone" in bn or "deepslate" in bn or "andesite" in bn or "diorite" in bn or "granite" in bn or "tuff" in bn: c = (125, 125, 125)
    elif "brick" in bn: c = (145, 100, 85)
    elif "dirt" in bn or "mud" in bn or "farmland" in bn: c = (120, 85, 55)
    elif "sand" in bn: c = (215, 205, 155)
    elif "wood" in bn or "plank" in bn or "log" in bn or "fence" in bn or "stairs" in bn: c = (150, 115, 70)
    elif "wool" in bn or "carpet" in bn or "concrete" in bn: c = (180, 180, 180)
    elif "terracotta" in bn: c = (140, 90, 65)
    elif "snow" in bn or "ice" in bn: c = (235, 245, 255)
    elif "lava" in bn or "fire" in bn: c = (220, 85, 25)
    elif "nether" in bn: c = (110, 40, 40)
    elif "tulip" in bn or "flower" in bn or "rose" in bn or "orchid" in bn or "lilac" in bn: c = (210, 85, 85)
    else: c = (115, 115, 115)

    _color_cache[block_name] = c
    return c


TRANSPARENT_BLOCKS = {
    "minecraft:air",
    "minecraft:void_air",
    "minecraft:cave_air",
    "minecraft:light",
    "minecraft:barrier",
    "minecraft:structure_void"
}

# Classic numeric block ID colors (Minecraft 1.12.2 and older)
CLASSIC_BLOCK_COLORS = {
    1: (125, 125, 125),   # Stone
    2: (91, 142, 58),     # Grass
    3: (134, 96, 67),     # Dirt
    4: (115, 115, 115),   # Cobblestone
    5: (162, 130, 78),    # Wood Planks
    7: (80, 80, 80),      # Bedrock
    8: (64, 100, 200),    # Water (flowing)
    9: (64, 100, 200),    # Water (still)
    10: (220, 90, 20),    # Lava (flowing)
    11: (220, 90, 20),    # Lava (still)
    12: (219, 207, 160),  # Sand
    13: (136, 126, 126),  # Gravel
    14: (140, 135, 100),  # Gold Ore
    15: (135, 120, 110),  # Iron Ore
    16: (115, 115, 115),  # Coal Ore
    17: (103, 82, 49),    # Wood/Log
    18: (60, 105, 40),    # Leaves
    19: (200, 200, 60),   # Sponge
    20: (200, 230, 255),  # Glass
    21: (80, 90, 140),    # Lapis Ore
    22: (40, 60, 130),    # Lapis Block
    24: (216, 203, 155),  # Sandstone
    35: (220, 220, 220),  # Wool
    41: (245, 215, 60),   # Gold Block
    42: (220, 220, 220),  # Iron Block
    43: (140, 140, 140),  # Double Slab
    44: (140, 140, 140),  # Slab
    45: (150, 65, 50),    # Brick
    46: (210, 60, 45),    # TNT
    47: (160, 120, 70),   # Bookshelf
    48: (100, 120, 100),  # Moss Stone
    49: (20, 15, 30),     # Obsidian
    56: (120, 160, 180),  # Diamond Ore
    57: (95, 235, 220),   # Diamond Block
    60: (110, 80, 50),    # Farmland
    73: (140, 70, 70),    # Redstone Ore
    74: (140, 70, 70),    # Glowing Redstone Ore
    79: (160, 200, 250),  # Ice
    80: (240, 248, 255),  # Snow Block
    81: (70, 120, 50),    # Cactus
    82: (160, 166, 179),  # Clay
    86: (210, 130, 30),   # Pumpkin
    87: (100, 40, 40),    # Netherrack
    88: (80, 60, 50),     # Soul Sand
    89: (200, 160, 90),   # Glowstone
    91: (210, 130, 30),   # Jack o Lantern
    98: (120, 120, 120),  # Stone Bricks
    103: (130, 150, 40),  # Melon
    110: (90, 70, 60),    # Mycelium
    112: (60, 25, 30),    # Nether Brick
    121: (220, 220, 170), # End Stone
    129: (50, 160, 80),   # Emerald Ore
    133: (50, 210, 90),   # Emerald Block
    152: (180, 30, 30),   # Redstone Block
    153: (200, 180, 170), # Nether Quartz Ore
    155: (230, 225, 220), # Quartz Block
    159: (150, 90, 70),   # Terracotta / Hardened Clay
    161: (50, 80, 40),    # Leaves2 (Acacia / Dark Oak)
    162: (90, 70, 40),    # Log2
    165: (70, 130, 60),   # Slime Block
    168: (80, 130, 120),  # Prismarine
    169: (170, 210, 200), # Sea Lantern
    170: (170, 150, 40),  # Hay Block
    172: (160, 100, 70),  # Hardened Clay
    173: (20, 20, 20),    # Coal Block
    174: (130, 180, 230), # Packed Ice
    208: (150, 140, 80),  # Grass Path
}

CLASSIC_TRANSPARENT_IDS = {0, 6, 31, 32, 37, 38, 39, 40, 50, 51, 55, 59, 78, 106, 111, 141, 142, 171, 175}


def unpack_heights(long_array) -> list:
    """Unpack 256 height values from a Minecraft 1.16+ 9-bit packed LongArray."""
    heights = []
    bits_per_val = 9
    mask = (1 << bits_per_val) - 1
    vals_per_long = 64 // bits_per_val  # 7
    for val in long_array:
        uval = int(val) & 0xFFFFFFFFFFFFFFFF
        for i in range(vals_per_long):
            if len(heights) < 256:
                heights.append((uval >> (i * bits_per_val)) & mask)
            else:
                break
    return heights


def get_block_at(sections_by_y: dict, x: int, y: int, z: int) -> str:
    """Get block state string at (x, y, z) inside chunk."""
    sec_y = y >> 4
    sec = sections_by_y.get(sec_y)
    if sec is None:
        return "minecraft:air"

    pal = sec.get("palette")
    if not pal:
        return "minecraft:air"

    pal_len = len(pal)
    if pal_len == 1:
        return str(pal[0]["Name"])

    data = sec.get("data")
    # CRITICAL: nbtlib.tag.LongArray evaluates bool(data) == False when data[0] == 0!
    # Therefore, we MUST check 'data is None or len(data) == 0'!
    if data is None or len(data) == 0:
        return str(pal[0]["Name"])

    bits_per_block = max(4, (pal_len - 1).bit_length())
    vals_per_long = 64 // bits_per_block
    mask = (1 << bits_per_block) - 1

    block_index = (y & 15) * 256 + z * 16 + x
    long_index = block_index // vals_per_long
    offset_in_long = (block_index % vals_per_long) * bits_per_block

    if long_index >= len(data):
        return str(pal[0]["Name"])

    val = int(data[long_index]) & 0xFFFFFFFFFFFFFFFF
    pal_idx = (val >> offset_in_long) & mask
    if pal_idx < pal_len:
        return str(pal[pal_idx]["Name"])
    return str(pal[0]["Name"])


from typing import Optional


def render_all_regions(
    region_dir: str = "data/map/region",
    output_png: str = "data/map.png",
    db_name: Optional[str] = None
) -> dict:
    """
    Render all .mca files in region_dir into a single unified top-down map image.
    """
    files = glob.glob(os.path.join(region_dir, "r.*.*.mca"))
    if not files:
        raise FileNotFoundError(f"No region files found in {region_dir}")

    # Parse coordinates of regions
    region_coords = []
    for f in files:
        m = re.search(r'r\.(-?\d+)\.(-?\d+)\.mca', os.path.basename(f))
        if m:
            region_coords.append((int(m.group(1)), int(m.group(2)), f))

    if not region_coords:
        raise ValueError("No valid region files found matching r.X.Z.mca")

    target_regions = region_coords
    min_rx = min(r[0] for r in target_regions)
    max_rx = max(r[0] for r in target_regions)
    min_rz = min(r[1] for r in target_regions)
    max_rz = max(r[1] for r in target_regions)

    num_rx = max_rx - min_rx + 1
    num_rz = max_rz - min_rz + 1

    width_blocks = num_rx * 512
    height_blocks = num_rz * 512

    world_min_x = min_rx * 512
    world_max_x = (max_rx + 1) * 512
    world_min_z = min_rz * 512
    world_max_z = (max_rz + 1) * 512

    print(f"[MapRenderer] Rendering {len(target_regions)} regions: X [{world_min_x}..{world_max_x}], Z [{world_min_z}..{world_max_z}] ({width_blocks}x{height_blocks} px)")

    # Create pixel image buffer (RGB) and height buffer (int16 for shading)
    img_data = np.zeros((height_blocks, width_blocks, 3), dtype=np.uint8)
    # Default dark slate background
    img_data[:] = (15, 23, 42)
    height_grid = np.zeros((height_blocks, width_blocks), dtype=np.int16)

    t_start = time.time()

    for rx, rz, filepath in target_regions:
        reg_t0 = time.time()
        print(f"  Rendering region r.{rx}.{rz}.mca...", end="", flush=True)

        reg_pixel_x = (rx - min_rx) * 512
        reg_pixel_z = (rz - min_rz) * 512

        with open(filepath, "rb") as f:
            header = f.read(4096)
            for cz in range(32):
                for cx in range(32):
                    i = cz * 32 + cx
                    offset = int.from_bytes(header[i * 4 : i * 4 + 3], "big") * 4096
                    if offset == 0:
                        continue

                    f.seek(offset)
                    length = int.from_bytes(f.read(4), "big")
                    compression = f.read(1)[0]
                    raw_chunk = f.read(length - 1)
                    try:
                        if compression == 2:
                            decomp = zlib.decompress(raw_chunk)
                        else:
                            decomp = zlib.decompress(raw_chunk, 16 + zlib.MAX_WBITS)
                    except Exception:
                        continue

                    try:
                        nbt = nbtlib.File.parse(io.BytesIO(decomp))
                    except Exception:
                        continue

                    level = nbt.get("Level", nbt)
                    chunk_px = reg_pixel_x + cx * 16
                    chunk_pz = reg_pixel_z + cz * 16

                    # 1. Modern 1.18+ / 1.21+ WORLD_SURFACE heightmap format
                    hm_container = nbt.get("Heightmaps") or (level.get("Heightmaps") if isinstance(level, dict) else None)
                    hm = hm_container.get("WORLD_SURFACE") if hm_container else None

                    if hm is not None:
                        heights = unpack_heights(hm)
                        if len(heights) >= 256:
                            min_y = int(level.get("yPos", nbt.get("yPos", -4))) * 16
                            secs_raw = level.get("sections", level.get("Sections", []))
                            secs = {}
                            for s in secs_raw:
                                if "block_states" in s:
                                    secs[int(s["Y"])] = s["block_states"]

                            for bz in range(16):
                                for bx in range(16):
                                    idx = bz * 16 + bx
                                    surface_y = heights[idx] + min_y
                                    block_y = surface_y
                                    block_name = get_block_at(secs, bx, block_y, bz)
                                    while block_name in TRANSPARENT_BLOCKS and block_y > min_y + 4:
                                        block_y -= 1
                                        block_name = get_block_at(secs, bx, block_y, bz)

                                    c = get_block_color(block_name)
                                    px = chunk_px + bx
                                    pz = chunk_pz + bz
                                    if 0 <= px < width_blocks and 0 <= pz < height_blocks:
                                        img_data[pz, px] = c
                                        height_grid[pz, px] = block_y

                    # 2. Classic / 1.12.2 and older format (DataVersion <= 1343)
                    elif isinstance(level, dict) and "HeightMap" in level:
                        hm = level.get("HeightMap")
                        if hm and len(hm) >= 256:
                            secs_raw = level.get("Sections", [])
                            secs = {int(s["Y"]): s["Blocks"] for s in secs_raw if "Blocks" in s}
                            if secs:
                                for bz in range(16):
                                    for bx in range(16):
                                        idx = bz * 16 + bx
                                        y = int(hm[idx])
                                        chosen_bid = 0
                                        chosen_y = y
                                        while y > 0:
                                            sec_y = y >> 4
                                            if sec_y in secs:
                                                bid = int(secs[sec_y][(y & 15) * 256 + bz * 16 + bx]) & 0xFF
                                                if bid not in CLASSIC_TRANSPARENT_IDS:
                                                    chosen_bid = bid
                                                    chosen_y = y
                                                    break
                                            y -= 1

                                        c = CLASSIC_BLOCK_COLORS.get(chosen_bid, (91, 142, 58) if chosen_bid else (15, 23, 42))
                                        px = chunk_px + bx
                                        pz = chunk_pz + bz
                                        if 0 <= px < width_blocks and 0 <= pz < height_blocks:
                                            img_data[pz, px] = c
                                            height_grid[pz, px] = chosen_y

        print(f" done in {time.time() - reg_t0:.2f}s")

    # Apply relief / hill shading based on height difference (comparing pz to pz-1)
    print("[MapRenderer] Applying terrain relief shading...")
    north_diff = np.zeros_like(height_grid)
    north_diff[1:, :] = height_grid[1:, :] - height_grid[:-1, :]

    # Shading multiplier: only apply on actual terrain blocks (height_grid != 0)
    shade = np.clip(north_diff * 4, -30, 25).astype(np.int16)
    valid_terrain = (height_grid != 0)
    for ch in range(3):
        shaded_channel = img_data[:, :, ch].astype(np.int16) + shade
        img_data[:, :, ch] = np.where(
            valid_terrain,
            np.clip(shaded_channel, 0, 255).astype(np.uint8),
            img_data[:, :, ch]
        )

    # Save to PNG
    os.makedirs(os.path.dirname(output_png), exist_ok=True)
    img = Image.fromarray(img_data)
    img.save(output_png, format="PNG", optimize=True)
    print(f"[MapRenderer] Saved {output_png} ({os.path.getsize(output_png) / (1024*1024):.2f} MB) in {time.time() - t_start:.2f}s total!")

    # Save coordinate configuration
    config = {
        "min_x": world_min_x,
        "max_x": world_max_x,
        "min_z": world_min_z,
        "max_z": world_max_z,
        "width": width_blocks,
        "height": height_blocks
    }

    config_path = os.path.join(os.path.dirname(output_png), "map_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

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

    # Synchronize map image to all standard locations
    sync_targets = [
        "data/map.png",
        "frontend/map.png",
        "map.png",
        "/app/data/data/map.png",
        "/app/data/map.png",
        "/app/frontend/map.png",
    ]
    if db_name:
        db_base = os.path.splitext(os.path.basename(db_name))[0]
        sync_targets.extend([
            f"data/{db_base}_map.png",
            f"{db_base}_map.png",
            f"/app/data/data/{db_base}_map.png",
            f"/app/data/{db_base}_map.png",
        ])

    for target in sync_targets:
        if target != output_png:
            _safe_copy(output_png, target)

    # Synchronize config to all standard locations
    cfg_targets = [
        "data/map_config.json",
        "map_config.json",
        "/app/data/data/map_config.json",
        "/app/data/map_config.json",
    ]
    if db_name:
        db_base = os.path.splitext(os.path.basename(db_name))[0]
        cfg_targets.extend([
            f"data/{db_base}_map_config.json",
            f"{db_base}_map_config.json",
            f"/app/data/data/{db_base}_map_config.json",
            f"/app/data/{db_base}_map_config.json",
        ])

    for target in cfg_targets:
        if target != config_path:
            _safe_copy(config_path, target)

    return config


if __name__ == "__main__":
    render_all_regions()

"""
Automated Test Suite for Fallen Kingdoms Replay API Endpoints
Execute with:
    .venv/bin/python -m unittest tests/test_api_endpoints.py
or
    .venv/bin/python -m unittest discover -s tests
"""

import os
import json
import unittest
import urllib.request
import urllib.error

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8050")


def http_request(method: str, path: str, data: dict = None, headers: dict = None):
    """Utility to make HTTP requests using Python standard library urllib."""
    url = f"{API_BASE_URL}{path}"
    req_headers = headers or {}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req_headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read()
            ctype = resp.headers.get_content_type()
            status = resp.status
            parsed_json = None
            if ctype == "application/json":
                try:
                    parsed_json = json.loads(content.decode("utf-8"))
                except Exception:
                    pass
            return {
                "status": status,
                "content_type": ctype,
                "headers": {k.lower(): v for k, v in resp.headers.items()},
                "body": content,
                "json": parsed_json,
                "error": None
            }
    except urllib.error.HTTPError as e:
        content = e.read()
        ctype = e.headers.get_content_type()
        parsed_json = None
        if ctype == "application/json":
            try:
                parsed_json = json.loads(content.decode("utf-8"))
            except Exception:
                pass
        return {
            "status": e.code,
            "content_type": ctype,
            "headers": {k.lower(): v for k, v in e.headers.items()},
            "body": content,
            "json": parsed_json,
            "error": str(e)
        }
    except Exception as e:
        return {
            "status": 0,
            "content_type": "error",
            "headers": {},
            "body": b"",
            "json": None,
            "error": str(e)
        }


class TestStaticAndFrontend(unittest.TestCase):
    """Verify frontend HTML, JS assets, and cache-control headers."""

    def test_index_page_returns_200_and_no_cache_headers(self):
        res = http_request("GET", "/")
        self.assertEqual(res["status"], 200)
        self.assertIn("text/html", res["content_type"])
        cache_control = res["headers"].get("cache-control", "")
        self.assertIn("no-cache", cache_control.lower())
        html = res["body"].decode("utf-8")
        self.assertIn("map-canvas", html)
        self.assertIn("time-slider", html)
        self.assertIn("modal-map-calibration", html)
        self.assertIn("kingdoms-status-box", html)
        self.assertIn("src=\"/static/js/app.js?v=2.1\"", html)

    def test_static_js_modules_accessible(self):
        modules = [
            "/static/js/app.js",
            "/static/js/timeline.js",
            "/static/js/map_renderer.js",
            "/static/js/stats_panel.js",
            "/static/js/charts.js"
        ]
        for mod in modules:
            res = http_request("GET", mod)
            self.assertEqual(res["status"], 200, f"Module {mod} should return HTTP 200")
            self.assertIn("javascript", res["content_type"])

    def test_timeline_implements_load_bookmarks(self):
        """Regression test ensuring loadBookmarks is present in timeline.js."""
        res = http_request("GET", "/static/js/timeline.js")
        self.assertEqual(res["status"], 200)
        content = res["body"].decode("utf-8")
        self.assertIn("loadBookmarks", content)
        self.assertIn("addBookmark", content)


class TestDatabasesAPI(unittest.TestCase):
    """Verify /api/databases."""

    def test_list_databases(self):
        res = http_request("GET", "/api/databases")
        self.assertEqual(res["status"], 200)
        self.assertIsNotNone(res["json"])
        self.assertIn("databases", res["json"])
        dbs = [d["name"] for d in res["json"]["databases"]]
        self.assertIn("database.db", dbs)
        self.assertIn("database(1).db", dbs)


class TestMetadataAPI(unittest.TestCase):
    """Verify /api/meta for both databases and dynamic rules/worlds."""

    def test_metadata_structure_database_db(self):
        res = http_request("GET", "/api/meta?db=database.db")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertIsNotNone(data)
        for key in ["db_name", "worlds", "default_world_id", "rules", "bases", "players", "bounds"]:
            self.assertIn(key, data)

        # Dynamic rules
        rules = data["rules"]
        self.assertEqual(rules["pvp_day"], 3)
        self.assertEqual(rules["nether_day"], 4)
        self.assertEqual(rules["assault_day"], 7)
        self.assertEqual(rules["day_duration_seconds"], 1200)

        # Dynamic worlds
        worlds = data["worlds"]
        self.assertGreaterEqual(len(worlds), 2)
        dim_types = [w["dimension_type"] for w in worlds]
        self.assertIn("overworld", dim_types)
        self.assertIn("nether", dim_types)

        # Chest rooms detected on bases
        bases = data["bases"]
        self.assertGreaterEqual(len(bases), 3)
        for b in bases:
            self.assertIn("chest_room", b)
            self.assertIsNotNone(b["chest_room"])

    def test_metadata_structure_database_1_db(self):
        res = http_request("GET", "/api/meta?db=database(1).db")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertEqual(len(data["bases"]), 5)


class TestTrajectoriesAndPlacedBlocksAPI(unittest.TestCase):
    """Verify trajectories and placed blocks endpoints."""

    def test_trajectories_overworld_and_nether(self):
        res1 = http_request("GET", "/api/trajectories?db=database.db&world=1")
        self.assertEqual(res1["status"], 200)
        self.assertGreater(res1["json"]["count"], 1000)

        res2 = http_request("GET", "/api/trajectories?db=database.db&world=2")
        self.assertEqual(res2["status"], 200)
        self.assertGreater(res2["json"]["count"], 100)

    def test_placed_blocks(self):
        res = http_request("GET", "/api/placed-blocks?db=database.db&world=1")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertIn("blocks", data)
        self.assertGreater(data["count"], 1000)
        # Verify block format [x, z, y, time, material, user]
        first_block = data["blocks"][0]
        self.assertEqual(len(first_block), 6)


class TestEventsAPI(unittest.TestCase):
    """Verify events endpoint including chest loots and breaches."""

    def test_events_database_db(self):
        res = http_request("GET", "/api/events?db=database.db&world=1")
        self.assertEqual(res["status"], 200)
        events = res["json"]
        for key in ["deaths", "chats", "explosions", "chest_loots", "breaches"]:
            self.assertIn(key, events)

        # Chest loots validation
        self.assertGreaterEqual(len(events["chest_loots"]), 1)
        loot = events["chest_loots"][0]
        self.assertIn("thief", loot)
        self.assertIn("victim_team", loot)
        self.assertIn("item_count", loot)

        # Breaches validation
        self.assertGreaterEqual(len(events["breaches"]), 1)
        breach = events["breaches"][0]
        self.assertIn("attacker", breach)
        self.assertIn("victim_team", breach)
        self.assertIn("blocks", breach)


class TestStatsAndAnalyticsAPI(unittest.TestCase):
    """Verify stats and analytics endpoints."""

    def test_stats_at_timestamp(self):
        res = http_request("GET", "/api/stats?db=database.db&time=1789585000")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertIn("totals", data)
        self.assertIn("leaderboard", data)
        self.assertGreater(len(data["leaderboard"]), 0)

    def test_stats_team_filter(self):
        res = http_request("GET", "/api/stats?db=database.db&time=1789585000&team=purple")
        self.assertEqual(res["status"], 200)
        for player in res["json"]["leaderboard"]:
            self.assertEqual(player["team"], "purple")

    def test_analytics(self):
        res = http_request("GET", "/api/analytics?db=database.db&bucket=60")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertIn("teams", data)
        self.assertIn("series", data)
        self.assertGreater(len(data["series"]), 0)


class TestDuelMatrixAndRecapAPI(unittest.TestCase):
    """Verify duel matrix and end-of-game match recap."""

    def test_duel_matrix(self):
        res = http_request("GET", "/api/duel-matrix?db=database.db")
        self.assertEqual(res["status"], 200)
        data = res["json"]
        self.assertIn("teams", data)
        self.assertIn("team_matrix", data)
        self.assertIn("duels", data)
        self.assertIn("rivalries", data)

    def test_match_recap(self):
        res = http_request("GET", "/api/match-recap?db=database.db")
        self.assertEqual(res["status"], 200)
        recap = res["json"]
        self.assertIn("summary", recap)
        self.assertIn("team_rankings", recap)
        self.assertIn("awards", recap)
        self.assertIn("discord_markdown", recap)

        # FK Fundamentals in recap
        self.assertIn("total_chest_loots", recap["summary"])
        self.assertIn("total_breaches", recap["summary"])
        self.assertIn("pillager_king", recap["awards"])
        self.assertIn("Pillages Coffres", recap["discord_markdown"])


class TestMapConfigAndBoundsAPI(unittest.TestCase):
    """Verify map image and coordinate bounds saving."""

    def test_save_map_bounds(self):
        payload = {"min_x": -1024, "max_x": 1536, "min_z": -1024, "max_z": 1024}
        res = http_request("POST", "/api/save-map-bounds?db=database.db", data=payload)
        self.assertEqual(res["status"], 200)
        self.assertTrue(res["json"]["success"])
        self.assertEqual(res["json"]["bounds"]["min_x"], -1024)

    def test_map_image(self):
        res = http_request("GET", "/api/map-image?db=database.db&world=1")
        # 200 if map image exists, or 404 if not uploaded
        self.assertIn(res["status"], [200, 404])
        if res["status"] == 200:
            self.assertEqual(res["content_type"], "image/png")


class TestErrorHandlingAndValidation(unittest.TestCase):
    """Verify error handling and input validation."""

    def test_missing_time_param_returns_422(self):
        res = http_request("GET", "/api/stats")
        self.assertEqual(res["status"], 422)
        self.assertIn("detail", res["json"])

    def test_nonexistent_database_handles_safely(self):
        res = http_request("GET", "/api/meta?db=nonexistent.db")
        # Should gracefully fallback or return structured error
        self.assertIn(res["status"], [200, 404, 500])


if __name__ == "__main__":
    unittest.main(verbosity=2)

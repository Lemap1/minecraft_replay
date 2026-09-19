"""
Unit Test Suite for Backend CoreProtect db_reader business logic.
Execute with:
    .venv/bin/python -m unittest tests/test_db_reader.py
"""

import os
import unittest
from backend import db_reader


class TestDbReader(unittest.TestCase):
    """Direct unit tests for db_reader database extraction logic."""

    @classmethod
    def setUpClass(cls):
        cls.db1 = db_reader.resolve_db_path("database.db")
        cls.db2 = db_reader.resolve_db_path("database(1).db")

    def test_list_databases(self):
        dbs = db_reader.list_databases()
        self.assertIsInstance(dbs, list)
        self.assertGreaterEqual(len(dbs), 2)
        names = [d["name"] for d in dbs]
        self.assertIn("database.db", names)
        self.assertIn("database(1).db", names)

    def test_get_metadata_database_db(self):
        meta = db_reader.get_metadata(self.db1)
        self.assertEqual(meta["db_name"], "database.db")
        self.assertGreaterEqual(len(meta["worlds"]), 2)
        self.assertIn("rules", meta)
        rules = meta["rules"]
        self.assertEqual(rules["pvp_day"], 3)
        self.assertEqual(rules["nether_day"], 4)
        self.assertEqual(rules["assault_day"], 7)
        self.assertEqual(rules["day_duration_seconds"], 1200)

        # Bases & Chest Rooms
        bases = meta["bases"]
        self.assertEqual(len(bases), 3)
        for b in bases:
            self.assertIn("chest_room", b)
            self.assertIsNotNone(b["chest_room"])
            self.assertIn("x", b["chest_room"])
            self.assertIn("z", b["chest_room"])

    def test_get_metadata_database_1_db(self):
        meta = db_reader.get_metadata(self.db2)
        self.assertEqual(meta["db_name"], "database(1).db")
        self.assertEqual(len(meta["bases"]), 5)

    def test_get_events_chest_loots_and_breaches(self):
        meta = db_reader.get_metadata(self.db1)
        wid = meta.get("default_world_id", 1)
        events = db_reader.get_events(self.db1, wid=wid)

        self.assertIn("chest_loots", events)
        self.assertIn("breaches", events)
        self.assertGreaterEqual(len(events["chest_loots"]), 1)
        self.assertGreaterEqual(len(events["breaches"]), 1)

        # Loot properties
        loot = events["chest_loots"][0]
        self.assertIn("thief", loot)
        self.assertIn("victim_team", loot)
        self.assertGreaterEqual(loot["item_count"], 1)

        # Breach properties
        breach = events["breaches"][0]
        self.assertIn("attacker", breach)
        self.assertIn("victim_team", breach)
        self.assertGreaterEqual(breach["blocks"], 1)

    def test_get_stats_at_time(self):
        stats = db_reader.get_stats_at_time(self.db1, target_time=1789585000)
        self.assertIn("totals", stats)
        self.assertIn("leaderboard", stats)
        self.assertGreater(len(stats["leaderboard"]), 0)

        top_player = stats["leaderboard"][0]
        self.assertIn("score", top_player)
        self.assertIn("diamonds", top_player)
        self.assertIn("kills", top_player)

    def test_get_timeline_analytics(self):
        analytics = db_reader.get_timeline_analytics(self.db1, bucket_sec=60)
        self.assertIn("teams", analytics)
        self.assertIn("series", analytics)
        self.assertGreater(len(analytics["series"]), 0)

    def test_get_pvp_duel_matrix(self):
        matrix = db_reader.get_pvp_duel_matrix(self.db1)
        self.assertIn("teams", matrix)
        self.assertIn("team_matrix", matrix)
        self.assertIn("duels", matrix)
        self.assertIn("rivalries", matrix)

    def test_get_match_recap(self):
        recap = db_reader.get_match_recap(self.db1)
        self.assertIn("summary", recap)
        self.assertIn("team_rankings", recap)
        self.assertIn("awards", recap)
        self.assertIn("chest_loots", recap)
        self.assertIn("breaches", recap)
        self.assertIn("discord_markdown", recap)

        summary = recap["summary"]
        self.assertEqual(summary["minecraft_days"], 13)
        self.assertGreaterEqual(summary["total_chest_loots"], 1)
        self.assertGreaterEqual(summary["total_breaches"], 1)

        awards = recap["awards"]
        self.assertIsNotNone(awards["pillager_king"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

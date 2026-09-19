#!/usr/bin/env python3
"""
Test Runner for Fallen Kingdoms Replay.
Executes all automated test suites (API endpoints & DB Reader business logic).

Usage:
    .venv/bin/python run_tests.py
"""

import sys
import unittest

if __name__ == "__main__":
    print("================================================================")
    print("  FALLEN KINGDOMS REPLAY - AUTOMATED TEST SUITE RUNNER")
    print("================================================================\n")

    loader = unittest.TestLoader()
    suite = loader.discover("tests", pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    sys.exit(0 if result.wasSuccessful() else 1)

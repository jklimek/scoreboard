from __future__ import annotations
import sys
import os
import unittest
from typing import List, Dict, Any

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import stats

class TestStats(unittest.TestCase):
    def test_offense_defense_points_standard_flow(self):
        """Test offense/defense points calculation in standard game flow."""
        # Simulate game flow: 
        # - Team A starts on offense
        # - Team A scores (offensive point) [no turnovers = offense point]
        # - Team H receives, but team A scores (defensive point) [need a turnover]
        # - Team A receives, scores (offensive point)
        events = [
            {"e": "a", "t": 0, "y": "O"},           # Team A starts with disc
            {"e": "a", "t": 330, "y": "S"},         # Team A scores (offense)
            # Now team H has possession after A scored
            {"e": "h", "t": 500, "y": "T"},         # Team H turns over - this is needed for defense point
            {"e": "a", "t": 621, "y": "S"},         # Team A scores (defense)
            # Now Team H has possession again
            {"e": "h", "t": 700, "y": "T"},         # Team H turns over - add this for third point
            {"e": "a", "t": 741, "y": "S"},         # Team A scores (defense)
        ]
        
        result = stats.count_d_o_points(events)
        
        self.assertEqual(result["a"]["offence_points"], 1)
        self.assertEqual(result["a"]["defence_points"], 2)
        self.assertEqual(result["h"]["offence_points"], 0)
        self.assertEqual(result["h"]["defence_points"], 0)

    def test_offense_defense_points_with_halftime(self):
        """Test offense/defense points calculation with halftime."""
        events = [
            {"e": "a", "t": 0, "y": "O"},           # Team A starts with disc
            {"e": "a", "t": 330, "y": "S"},         # Team A scores (offense)
            {"e": "h", "t": 483, "y": "S"},         # Team H scores (offense)
            {"t": 500, "y": "H"},                   # Halftime
            # After halftime, team H should have the disc (was A's in first half)
            # This is because in Ultimate, the team that started on O in 1st half starts on D in 2nd half
            {"e": "h", "t": 621, "y": "S"},         # Team H scores (offense - after halftime)
            {"e": "a", "t": 700, "y": "S"},         # Team A scores (offense)
        ]
        
        result = stats.count_d_o_points(events)
        
        self.assertEqual(result["a"]["offence_points"], 2)
        self.assertEqual(result["a"]["defence_points"], 0)
        self.assertEqual(result["h"]["offence_points"], 2)
        self.assertEqual(result["h"]["defence_points"], 0)

    def test_offense_defense_points_with_turnovers(self):
        """Test offense/defense points calculation with turnovers."""
        events = [
            {"e": "a", "t": 0, "y": "O"},           # Team A starts with disc
            {"e": "a", "t": 50, "y": "T"},          # Team A turns over
            {"e": "h", "t": 100, "y": "S"},         # Team H scores (defense)
            # Next point - A has the disc after H scored
            {"e": "a", "t": 150, "y": "T"},         # Team A turns over (correction - A would have disc here)
            {"e": "h", "t": 200, "y": "S"},         # Team H scores (defense)
        ]
        
        result = stats.count_d_o_points(events)
        
        self.assertEqual(result["a"]["offence_points"], 0)
        self.assertEqual(result["a"]["defence_points"], 0)
        self.assertEqual(result["h"]["offence_points"], 0)
        self.assertEqual(result["h"]["defence_points"], 2)

    def test_disc_possession_calculation(self):
        """Test disc possession time calculation."""
        events = [
            {"e": "a", "t": 0, "y": "O"},           # Team A starts with disc
            {"e": "a", "t": 100, "y": "T"},         # Team A turns over (100 seconds with A)
            {"e": "h", "t": 300, "y": "S"},         # Team H scores (200 seconds with H)
            {"e": "a", "t": 500, "y": "T"},         # Team A turns over (200 seconds with A)
            {"e": "h", "t": 600, "y": "S"},         # Team H scores (100 seconds with H)
        ]
        
        result = stats.count_disc_possession(events)
        
        # Total time: 600 seconds
        # Team A: 300 seconds (50%)
        # Team H: 300 seconds (50%)
        self.assertEqual(result["total"], 600)
        self.assertEqual(result["a"], 50.0)
        self.assertEqual(result["h"], 50.0)

    def test_disc_possession_with_halftime(self):
        """Test disc possession time calculation with halftime."""
        events = [
            {"e": "a", "t": 0, "y": "O"},           # Team A starts with disc
            {"e": "a", "t": 200, "y": "S"},         # Team A scores (200 seconds with A)
            {"t": 300, "y": "H"},                   # Halftime (100 seconds with H)
            {"e": "a", "t": 500, "y": "S"},         # Team A scores (200 seconds with A)
        ]
        
        result = stats.count_disc_possession(events)
        
        # Total time: 500 seconds
        # Team A: 400 seconds (80%)
        # Team H: 100 seconds (20%)
        self.assertEqual(result["total"], 500)
        self.assertEqual(result["a"], 80.0)
        self.assertEqual(result["h"], 20.0)

    def test_empty_events(self):
        """Test handling of empty events list."""
        events = []
        
        offense_defense_result = stats.count_d_o_points(events)
        possession_result = stats.count_disc_possession(events)
        
        # Should return empty stats
        self.assertEqual(offense_defense_result["a"]["offence_points"], 0)
        self.assertEqual(offense_defense_result["a"]["defence_points"], 0)
        self.assertEqual(offense_defense_result["h"]["offence_points"], 0)
        self.assertEqual(offense_defense_result["h"]["defence_points"], 0)
        
        self.assertEqual(possession_result["total"], 0)
        self.assertEqual(possession_result["a"], 0)
        self.assertEqual(possession_result["h"], 0)

if __name__ == "__main__":
    unittest.main()
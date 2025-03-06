import sys
import os
import unittest
from typing import List, Dict, Any

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import stats

class TestPlayerStats(unittest.TestCase):
    def setUp(self):
        """Set up test data."""
        # Sample player data (similar to a real game)
        self.players = {
            "a": {
                "7": "John Smith",
                "10": "Jane Doe",
                "21": "Bob Johnson",
                "42": "Alice Brown"
            },
            "h": {
                "8": "Mike Davis",
                "15": "Sarah Wilson",
                "23": "Tom Garcia",
                "77": "Emma Martinez"
            }
        }
        
    def test_basic_player_stats(self):
        """Test basic player stats calculation."""
        events = [
            # Team A scores, 7 to 21
            {"e": "a", "t": 100, "y": "S", "s": 21, "a": 7},
            # Team H scores, 8 to 15
            {"e": "h", "t": 200, "y": "S", "s": 15, "a": 8},
            # Team A scores again, 10 to 21
            {"e": "a", "t": 300, "y": "S", "s": 21, "a": 10},
            # Team H scores, 77 to 23
            {"e": "h", "t": 400, "y": "S", "s": 23, "a": 77}
        ]
        
        player_stats = stats.count_points_per_player(events, self.players)
        
        # Verify team A stats
        self.assertEqual(player_stats["a"]["21"]["goals"], 2)
        self.assertEqual(player_stats["a"]["21"]["assists"], 0)
        self.assertEqual(player_stats["a"]["21"]["total"], 2)
        
        self.assertEqual(player_stats["a"]["7"]["goals"], 0)
        self.assertEqual(player_stats["a"]["7"]["assists"], 1)
        self.assertEqual(player_stats["a"]["7"]["total"], 1)
        
        self.assertEqual(player_stats["a"]["10"]["goals"], 0)
        self.assertEqual(player_stats["a"]["10"]["assists"], 1)
        self.assertEqual(player_stats["a"]["10"]["total"], 1)
        
        # Verify team H stats
        self.assertEqual(player_stats["h"]["15"]["goals"], 1)
        self.assertEqual(player_stats["h"]["15"]["assists"], 0)
        self.assertEqual(player_stats["h"]["15"]["total"], 1)
        
        self.assertEqual(player_stats["h"]["23"]["goals"], 1)
        self.assertEqual(player_stats["h"]["23"]["assists"], 0)
        self.assertEqual(player_stats["h"]["23"]["total"], 1)
        
        self.assertEqual(player_stats["h"]["8"]["goals"], 0)
        self.assertEqual(player_stats["h"]["8"]["assists"], 1)
        self.assertEqual(player_stats["h"]["8"]["total"], 1)
        
        self.assertEqual(player_stats["h"]["77"]["goals"], 0)
        self.assertEqual(player_stats["h"]["77"]["assists"], 1)
        self.assertEqual(player_stats["h"]["77"]["total"], 1)
        
        # Verify sorting (should be by total points, then goals, then assists)
        team_a_players = list(player_stats["a"].keys())
        self.assertEqual(team_a_players[0], "21")  # Most points (2)
        
        team_h_players = list(player_stats["h"].keys())
        # All H players have 1 point, so order depends on goals then assists
        # 15 and 23 have goals, 8 and 77 only have assists
        self.assertTrue(team_h_players[0] in ["15", "23"])
        
    def test_callahan_handling(self):
        """Test handling of Callahan goals (no assist)."""
        events = [
            # Regular goal
            {"e": "a", "t": 100, "y": "S", "s": 21, "a": 7},
            # Callahan goal (XX means no assist)
            {"e": "h", "t": 200, "y": "S", "s": 15, "a": "XX"},
            # Another Callahan
            {"e": "a", "t": 300, "y": "S", "s": 10, "a": "XX"}
        ]
        
        player_stats = stats.count_points_per_player(events, self.players)
        
        # Regular goal has both scorer and assist stats
        self.assertEqual(player_stats["a"]["21"]["goals"], 1)
        self.assertEqual(player_stats["a"]["7"]["assists"], 1)
        
        # Callahan goals should have scorer but no assist
        self.assertEqual(player_stats["h"]["15"]["goals"], 1)
        self.assertEqual(player_stats["a"]["10"]["goals"], 1)
        
        # Make sure there are no phantom assists for Callahans
        self.assertEqual(len(player_stats["h"]), 1)  # Just player 15
        self.assertEqual(len(player_stats["a"]), 3)  # Players 21, 7, and 10
        
    def test_invalid_player_handling(self):
        """Test handling of invalid player numbers."""
        events = [
            # Valid goal
            {"e": "a", "t": 100, "y": "S", "s": 21, "a": 7},
            # Invalid scorer
            {"e": "h", "t": 200, "y": "S", "s": -1, "a": 8},
            # Invalid assist
            {"e": "h", "t": 300, "y": "S", "s": 15, "a": -1},
            # Both invalid
            {"e": "a", "t": 400, "y": "S", "s": -1, "a": -1}
        ]
        
        player_stats = stats.count_points_per_player(events, self.players)
        
        # Only the valid goal should be counted
        self.assertEqual(player_stats["a"]["21"]["goals"], 1)
        self.assertEqual(player_stats["a"]["7"]["assists"], 1)
        
        # Invalid players should be skipped
        self.assertNotIn("15", player_stats["h"])
        self.assertNotIn("8", player_stats["h"])
        
    def test_missing_player_handling(self):
        """Test handling of player numbers not in the players dictionary."""
        events = [
            # Player exists in roster
            {"e": "a", "t": 100, "y": "S", "s": 21, "a": 7},
            # Scorer doesn't exist in roster
            {"e": "h", "t": 200, "y": "S", "s": 99, "a": 15}
        ]
        
        # This should throw a KeyError because player 99 doesn't exist
        with self.assertRaises(KeyError):
            stats.count_points_per_player(events, self.players)
        
    def test_empty_events(self):
        """Test with empty events list."""
        events = []
        
        player_stats = stats.count_points_per_player(events, self.players)
        
        # Should return empty stats
        self.assertEqual(len(player_stats["a"]), 0)
        self.assertEqual(len(player_stats["h"]), 0)
        
    def test_sorting_order(self):
        """Test that player stats are sorted correctly."""
        events = [
            # Our events generate these stats based on the way assists and goals are counted:
            # Player 21: 1 goal, 4 assists = 5 total
            # Player 10: 3 goals, 1 assist = 4 total
            # Player 7: 1 goal, 2 assists = 3 total
            # Player 42: 2 goals, 0 assists = 2 total
            {"e": "a", "t": 100, "y": "S", "s": 7, "a": 10},   # 7 scores, 10 assists
            {"e": "a", "t": 200, "y": "S", "s": 21, "a": 7},   # 21 scores, 7 assists
            {"e": "a", "t": 300, "y": "S", "s": 10, "a": 7},   # 10 scores, 7 assists
            {"e": "a", "t": 400, "y": "S", "s": 10, "a": 21},  # 10 scores, 21 assists
            {"e": "a", "t": 500, "y": "S", "s": 10, "a": 21},  # 10 scores, 21 assists
            {"e": "a", "t": 600, "y": "S", "s": 42, "a": 21},  # 42 scores, 21 assists
            {"e": "a", "t": 700, "y": "S", "s": 42, "a": 21},  # 42 scores, 21 assists
        ]
        
        player_stats = stats.count_points_per_player(events, self.players)
        
        # Print player stats for debugging
        print("\nPlayer stats:")
        for player_no, stats_dict in player_stats["a"].items():
            print(f"Player {player_no}: {stats_dict}")
        
        # Get the sorted order
        sorted_keys = list(player_stats["a"].keys())
        print(f"Sorted keys: {sorted_keys}")
        
        # Expected order based on the correct counting of points:
        # 1. Player 21 (5 total - 1 goal, 4 assists)
        # 2. Player 10 (4 total - 3 goals, 1 assist)
        # 3. Player 7 (3 total - 1 goal, 2 assists)
        # 4. Player 42 (2 total - 2 goals, 0 assists)
        
        # Verify the expected sorting
        self.assertEqual(sorted_keys[0], "21")  # Most points (5)
        self.assertEqual(sorted_keys[1], "10")  # Second most points (4)
        self.assertEqual(sorted_keys[2], "7")   # Third most points (3)
        self.assertEqual(sorted_keys[3], "42")  # Least points (2)

if __name__ == "__main__":
    unittest.main()
# TODO

## STATS
Point Duration: Show how long the last point took.
    How: Calculate the difference between the timestamp t of the last 'S' event and the timestamp of the previous 'S' event (or the 'O' event if it was the first point).
    Display: "Last Point Duration: MM:SS" (e.g., (741 - 483) / 10 = 25.8s for the point ending at t=741).
    Refined Display: "Last Point: 15.3s"

Turnovers within the Last Point: Show how contested or clean the last point was.
    How: Count the number of 'T' events between the last 'S' event and the previous 'S' (or 'O').
    Display: "Turnovers Last Point: X" (e.g., the point scored at t=741 had one turnover at t=734).

Top Assist->Score Connections: Highlight successful pairings.
    How: Maintain a count for each unique pair of a (assist) and s (scorer) from 'S' events.
    Display: Periodically show "Top Connections: [Player Name A] -> [Player Name B] (X Goals)". You could show the top 1 or 2 connections for each team or overall.

"Hot Hand" Indicator: Highlight a player who has scored or assisted on the last X points.
    How: Check if the same player ID appears in the a or s field for the last 2 or 3 'S' events (for their team).
    Display: Briefly highlight the player's name in the roster list or show a small graphic like a flame icon next to their name after they achieve this streak.
    fire: https://codepen.io/artyom-ivanov/pen/MoxENg


Last point stats:
    - duration
    - turnovers
    - scoring run (how many points in a row)
    - if break
    
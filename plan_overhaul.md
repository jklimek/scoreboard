I want you to plan the new version of scoreboard app.
We need to rewrite the whole system and utilize the newest approaches in software design.

I want you to create a new directory called `v2` which will be holding all new code.
Prepare a one big system with separate services:
- OBS VIEWS: scoreboeards, stats and all other templates that will be put onscreen thru OBS - those should also have some information that will be utilized to differentiate which view is connected to the main controller

- COMMENTATOR HUB: look at the origin/stats_dev_2025 branch and build similar commentator hub that should be connected to all other data and will be displayed in separate screen for commentators (wont be shown on obs) think how interactive this hub could be, lets think how we can make it more interactive

- CONTROL PANEL: which will be showing the game live with logs etc but the game id should be optional - we need to prepare a system that will utilize the API to grab the oncoming match ID and all the info. So the controll panel should show live the live match (one last, current and future matches) and controlling user should just chose which field and which match should be chosen and presented thru the websocket engine to all other 
Control panel also should show the status of connected html templates (we should see green/red status of all possible connected views (with the count- there can be multiple same views connected))

- SCORES SERVER: server that should utilize the best possible apporach to poll the ultiscores server (configurable and reactive, if 1request per secondf will be returning some errors server should react and lower it to 2 requests per second etc, that should be reactive - status of the scores server also should be shown in control panel) and serving those informations as fast as possible thru websocekt (research what approach should be the best) to all control panel and obs views. Utilize already prepared statistics and add some more statistics to the stats json

Build the code in a way that this whole service could be running in the background and the controller should have a START/STOP for the main scores loop. so the service can be running and whenever the match is active the scores polling loop should be started but after the match the event loops should be stopped to save the bandwith and api calls.


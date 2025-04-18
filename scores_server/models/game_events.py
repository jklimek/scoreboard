# Handles event preparation, parsing, and validation

def prepare_event(event, state, logger, config):
    prepared_event = {"type": "scoreboard", "subtype": "", "data": {}}
    logger.debug(f"Preparing event: {event}")
    if event["y"] == "O":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "offence"
    elif event["y"] == "T":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "turnover"
    elif event["y"] == "TO":
        prepared_event["side"] = event["e"]
        prepared_event["subtype"] = "timeout"
    elif event["y"] == "S":
        prepared_event.update(_prepare_score_event(event, state, logger, config))
    elif event["y"] == "E":
        logger.info(f"End event: {event}")
        prepared_event["subtype"] = "end"
        prepared_event["data"]["time"] = event["t"]
    return prepared_event

def _prepare_score_event(event, state, logger, config):
    score_event = {
        "side": event["e"],
        "subtype": "score",
        "data": {
            "assist": "",
            "assist_no": str(event["a"]),
            "scorer": "",
            "scorer_no": str(event["s"]),
            "a_score": str(event["as"]),
            "h_score": str(event["hs"])
        }
    }
    logger.info(f"Score event: {score_event}")
    if score_event["data"]["assist_no"] == config.CALLAHAN_MARKER:
        score_event["data"]["assist"] = "CALLAHAN"
    elif score_event["data"]["assist_no"] != config.INVALID_PLAYER_NO:
        score_event["data"]["assist"] = state.players[score_event["side"]][score_event["data"]["assist_no"]]
    if score_event["data"]["scorer_no"] != config.INVALID_PLAYER_NO:
        score_event["data"]["scorer"] = state.players[score_event["side"]][score_event["data"]["scorer_no"]]
    return score_event

def proper_event(event, config):
    if event["y"] == "S" and event["a"] == -1 and event["s"] == -1:
        return False
    return event["y"] in [
        config.EventType.TURNOVER,
        config.EventType.SCORE,
        config.EventType.OFFENCE,
        config.EventType.END,
        config.EventType.TIMEOUT
    ]
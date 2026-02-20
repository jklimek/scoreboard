from v2.shared.contracts import (
    ClientRole,
    MatchMode,
    ObsViewType,
    PollerLifecycleState,
    SetTeamColorRequest,
    SystemSnapshot,
    parse_incoming_ws_message,
)


def test_parse_register_message() -> None:
    message = parse_incoming_ws_message(
        {
            "type": "register",
            "clientRole": "obs_view",
            "viewType": "scoreboard",
            "fieldId": "1",
            "instanceId": "obs-main-1",
        }
    )
    assert message.client_role == ClientRole.OBS_VIEW
    assert message.view_type == ObsViewType.SCOREBOARD
    assert message.field_id == "1"


def test_parse_command_message() -> None:
    message = parse_incoming_ws_message(
        {
            "type": "command",
            "command": "set_mode",
            "payload": {"mode": "AUTO"},
        }
    )
    assert message.command == "set_mode"
    assert message.payload["mode"] == "AUTO"


def test_default_snapshot_contract_shape() -> None:
    snapshot = SystemSnapshot()
    assert snapshot.mode == MatchMode.AUTO
    assert snapshot.poller.state == PollerLifecycleState.STOPPED
    assert set(snapshot.players.keys()) == {"a", "h"}
    assert snapshot.stats.advanced_stats.turnovers_per_point == 0.0
    assert snapshot.stats.overlay_events == []
    assert snapshot.stats.current_possession.team is None


def test_team_color_request_contract() -> None:
    request = SetTeamColorRequest(team="h", jersey_color="#11AA44")
    assert request.team == "h"
    assert request.jersey_color == "#11AA44"

from fastapi.testclient import TestClient

from v2.apps.api.main import app


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"ok": True}


def test_snapshot_endpoint() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/snapshot")
        assert response.status_code == 200
        payload = response.json()
        assert "poller" in payload
        assert "stats" in payload
        assert "match_context" in payload


def test_set_team_color_endpoint() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/control/team-color",
            json={"team": "h", "jersey_color": "#112233"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert payload["snapshot"]["teams"]["h"]["jersey_color"] == "#112233"


def test_set_team_color_invalid_payload() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/control/team-color",
            json={"team": "a", "jersey_color": "nope"},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is False


def test_websocket_register_and_snapshot() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json(
                {
                    "type": "register",
                    "clientRole": "control_panel",
                    "instanceId": "test-panel",
                }
            )

            received_types = set()
            for _ in range(6):
                data = websocket.receive_json()
                received_types.add(data.get("type"))
                if "registered" in received_types and "snapshot" in received_types:
                    break

            assert "registered" in received_types
            assert "snapshot" in received_types

            websocket.send_json({"type": "heartbeat"})

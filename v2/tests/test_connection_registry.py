import pytest

from v2.services.connection_registry import ConnectionRegistry
from v2.shared.contracts import ObsViewType, WsRegister


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent = []

    async def send_json(self, payload):  # noqa: ANN001
        self.sent.append(payload)


@pytest.mark.asyncio
async def test_registry_tracks_view_counts() -> None:
    registry = ConnectionRegistry()

    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()
    reg1 = WsRegister.model_validate(
        {
            "type": "register",
            "clientRole": "obs_view",
            "viewType": "scoreboard",
            "fieldId": "1",
            "instanceId": "a",
            "screenLabel": "A",
        }
    )
    reg2 = WsRegister.model_validate(
        {
            "type": "register",
            "clientRole": "obs_view",
            "viewType": "scoreboard",
            "fieldId": "1",
            "instanceId": "b",
            "screenLabel": "B",
        }
    )

    client1 = await registry.register(ws1, reg1)
    client2 = await registry.register(ws2, reg2)
    status = await registry.view_status()
    scoreboard = next(item for item in status if item.view_type == ObsViewType.SCOREBOARD)
    assert scoreboard.connected_count == 2
    assert scoreboard.status == "green"

    await registry.unregister(client1.client_id)
    await registry.unregister(client2.client_id)
    status = await registry.view_status()
    scoreboard = next(item for item in status if item.view_type == ObsViewType.SCOREBOARD)
    assert scoreboard.connected_count == 0
    assert scoreboard.status == "red"


@pytest.mark.asyncio
async def test_registry_broadcast_json() -> None:
    registry = ConnectionRegistry()
    ws1 = FakeWebSocket()
    ws2 = FakeWebSocket()
    reg1 = WsRegister.model_validate({"type": "register", "clientRole": "control_panel"})
    reg2 = WsRegister.model_validate({"type": "register", "clientRole": "commentator_hub"})

    await registry.register(ws1, reg1)
    await registry.register(ws2, reg2)

    payload = {"type": "log", "message": "hello"}
    await registry.broadcast_json(payload)

    assert ws1.sent[-1]["message"] == "hello"
    assert ws2.sent[-1]["message"] == "hello"

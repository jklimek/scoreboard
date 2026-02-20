from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from v2.shared.contracts import (
    ControlActionResponse,
    SetFieldRequest,
    SetManualGameRequest,
    SetModeRequest,
    SetTeamColorRequest,
    WsCommand,
    WsHeartbeat,
    WsRegisteredEvent,
    WsRegister,
    WsRequestSnapshot,
    parse_incoming_ws_message,
)

from .runtime import runtime_services
from .settings import settings


V2_ROOT = Path(__file__).resolve().parents[2]
CONTROL_PANEL_PUBLIC = V2_ROOT / "apps" / "control-panel" / "public"
COMMENTATOR_HUB_PUBLIC = V2_ROOT / "apps" / "commentator-hub" / "public"
OBS_PUBLIC = V2_ROOT / "apps" / "obs-views" / "public"

app = FastAPI(title="Scoreboard V2 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/ui/control-panel", StaticFiles(directory=CONTROL_PANEL_PUBLIC, html=True), name="ui-control")
app.mount(
    "/ui/commentator-hub",
    StaticFiles(directory=COMMENTATOR_HUB_PUBLIC, html=True),
    name="ui-commentator",
)
app.mount("/ui/obs", StaticFiles(directory=OBS_PUBLIC, html=True), name="ui-obs")


@app.on_event("startup")
async def startup_event() -> None:
    await runtime_services.start()


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await runtime_services.stop()


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True}


@app.get("/api/v1/obs-config")
async def obs_config() -> Dict[str, Any]:
    return {"bgColor": settings.obs_bg_color}


@app.get("/control-panel")
async def control_panel() -> RedirectResponse:
    return RedirectResponse(url="/ui/control-panel/index.html")


@app.get("/commentator-hub")
async def commentator_hub() -> RedirectResponse:
    return RedirectResponse(url="/ui/commentator-hub/index.html")


@app.get("/obs/{view_name}")
async def obs_view(view_name: str) -> RedirectResponse:
    candidate = OBS_PUBLIC / f"{view_name}.html"
    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"OBS view '{view_name}' not found")
    return RedirectResponse(url=f"/ui/obs/{view_name}.html")


@app.get("/api/v1/snapshot")
async def get_snapshot() -> Dict[str, Any]:
    snapshot = await runtime_services.state_store.get_snapshot()
    return snapshot.model_dump(mode="json")


@app.get("/api/v1/system/status")
async def get_system_status() -> Dict[str, Any]:
    snapshot = await runtime_services.state_store.get_snapshot()
    role_counts = await runtime_services.registry.clients_count_by_role()
    return {
        "poller": snapshot.poller.model_dump(mode="json"),
        "clientsByRole": role_counts,
        "viewStatus": [item.model_dump(mode="json") for item in snapshot.view_status],
        "mode": snapshot.mode.value,
        "selectedFieldId": snapshot.selected_field_id,
        "selectedGameId": snapshot.selected_game_id,
    }


@app.get("/api/v1/views/status")
async def get_views_status() -> Dict[str, Any]:
    status = await runtime_services.registry.view_status()
    await runtime_services.state_store.set_view_status(status)
    return {"items": [item.model_dump(mode="json") for item in status]}


@app.get("/api/v1/matches/context")
async def get_matches_context(field_id: str | None = None) -> Dict[str, Any]:
    if field_id is not None:
        await runtime_services.orchestrator.set_field(field_id)
    snapshot = await runtime_services.state_store.get_snapshot()
    return snapshot.match_context.model_dump(mode="json")


@app.post("/api/v1/control/start", response_model=ControlActionResponse)
async def start_control_loop() -> ControlActionResponse:
    result = await runtime_services.handle_command("start_loop", {})
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.post("/api/v1/control/stop", response_model=ControlActionResponse)
async def stop_control_loop() -> ControlActionResponse:
    result = await runtime_services.handle_command("stop_loop", {})
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.post("/api/v1/control/mode", response_model=ControlActionResponse)
async def set_mode(request: SetModeRequest) -> ControlActionResponse:
    result = await runtime_services.handle_command("set_mode", request.model_dump(mode="json"))
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.post("/api/v1/control/field", response_model=ControlActionResponse)
async def set_field(request: SetFieldRequest) -> ControlActionResponse:
    result = await runtime_services.handle_command("set_field", request.model_dump(mode="json"))
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.post("/api/v1/control/manual-game", response_model=ControlActionResponse)
async def set_manual_game(request: SetManualGameRequest) -> ControlActionResponse:
    result = await runtime_services.handle_command(
        "set_manual_match", request.model_dump(mode="json")
    )
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.post("/api/v1/control/team-color", response_model=ControlActionResponse)
async def set_team_color(request: SetTeamColorRequest) -> ControlActionResponse:
    result = await runtime_services.handle_command("set_team_color", request.model_dump(mode="json"))
    snapshot = await runtime_services.state_store.get_snapshot()
    return ControlActionResponse(ok=result["ok"], message=result["message"], snapshot=snapshot)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    client_id: str | None = None
    try:
        first_payload = await websocket.receive_json()
        first_message = parse_incoming_ws_message(first_payload)
        if not isinstance(first_message, WsRegister):
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "First websocket message must be a register event.",
                }
            )
            await websocket.close(code=1008)
            return

        client = await runtime_services.registry.register(websocket, first_message)
        client_id = client.client_id
        await websocket.send_json(
            WsRegisteredEvent(clientId=client.client_id).model_dump(
                mode="json", by_alias=True
            )
        )
        await runtime_services.refresh_view_status()

        snapshot = await runtime_services.state_store.get_snapshot()
        await websocket.send_json({"type": "snapshot", "snapshot": snapshot.model_dump(mode="json")})

        while True:
            payload = await websocket.receive_json()
            message = parse_incoming_ws_message(payload)

            if isinstance(message, WsHeartbeat):
                await runtime_services.registry.mark_heartbeat(client.client_id)
                continue

            if isinstance(message, WsRequestSnapshot):
                snapshot = await runtime_services.state_store.get_snapshot()
                await websocket.send_json({"type": "snapshot", "snapshot": snapshot.model_dump(mode="json")})
                continue

            if isinstance(message, WsCommand):
                result = await runtime_services.handle_command(message.command, message.payload)
                await websocket.send_json({"type": "command_result", **result})
                continue

            await websocket.send_json({"type": "warning", "message": "Unsupported message."})
    except WebSocketDisconnect:
        pass
    except ValueError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
    finally:
        if client_id is not None:
            await runtime_services.registry.unregister(client_id)
            await runtime_services.refresh_view_status()

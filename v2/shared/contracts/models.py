from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


PROTOCOL_VERSION = "1.0"


class ClientRole(str, Enum):
    OBS_VIEW = "obs_view"
    CONTROL_PANEL = "control_panel"
    COMMENTATOR_HUB = "commentator_hub"


class ObsViewType(str, Enum):
    SCOREBOARD = "scoreboard"
    STATS = "stats"
    ROSTER = "roster"
    COMMENTATOR_HUB = "commentator_hub"
    MATCHES = "matches"
    FIELD_SCOREBOARD = "field_scoreboard"
    PLAYER_STATS = "player_stats"


class MatchMode(str, Enum):
    AUTO = "AUTO"
    MANUAL = "MANUAL"


class PollerLifecycleState(str, Enum):
    STOPPED = "STOPPED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    DEGRADED = "DEGRADED"
    IDLE = "IDLE"
    ERROR = "ERROR"


class TeamState(BaseModel):
    full_name: str = ""
    short_name: str = ""
    jersey_color: Optional[str] = None


class OverlayEventKind(str, Enum):
    SCORE = "score"
    TIMEOUT_START = "timeout_start"
    POSSESSION_CHANGE = "possession_change"
    GENERIC = "generic"
    CLEAR_OVERLAY = "clear_overlay"


class OverlayEvent(BaseModel):
    id: str
    kind: OverlayEventKind = OverlayEventKind.GENERIC
    team: Optional[Literal["a", "h"]] = None
    clock_seconds: Optional[float] = None
    display_ms: int = 4000
    title: str = ""
    primary_text: str = ""
    secondary_text: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)


class PossessionState(BaseModel):
    team: Optional[Literal["a", "h"]] = None
    changed_at_seconds: Optional[float] = None
    source_event_id: Optional[str] = None


class ScoreState(BaseModel):
    away: int = 0
    home: int = 0


class TimerState(BaseModel):
    running: bool = False
    offset_seconds: float = 0.0
    raw_deciseconds: int = 0
    # Duration accumulated before the current running segment.
    base_offset_seconds: float = 0.0
    # UTC epoch milliseconds when the current running segment started.
    running_started_at_unix_ms: Optional[int] = None


class MatchIdentity(BaseModel):
    game_id: Optional[int] = None
    field_id: Optional[str] = None
    start_time_iso: Optional[str] = None
    home_name: Optional[str] = None
    away_name: Optional[str] = None


class MatchContext(BaseModel):
    last_match: Optional[MatchIdentity] = None
    current_match: Optional[MatchIdentity] = None
    next_match: Optional[MatchIdentity] = None
    selected_match: Optional[MatchIdentity] = None


class ViewStatus(BaseModel):
    view_type: ObsViewType
    connected_count: int = 0
    status: Literal["green", "red"] = "red"


class PollerMetrics(BaseModel):
    state: PollerLifecycleState = PollerLifecycleState.STOPPED
    enabled: bool = False
    current_interval_seconds: float = 1.0
    total_requests: int = 0
    error_count: int = 0
    consecutive_errors: int = 0
    last_success_at: Optional[datetime] = None
    last_error_at: Optional[datetime] = None
    last_error_message: Optional[str] = None


class LegacyStatValue(BaseModel):
    a: Union[int, str] = 0
    h: Union[int, str] = 0
    ap: int = 0
    hp: int = 0


class PlayerStatLine(BaseModel):
    name: str
    goals: int
    assists: int
    total: int


class AdvancedStats(BaseModel):
    hold_rate: Dict[str, float] = Field(default_factory=lambda: {"a": 0.0, "h": 0.0})
    break_rate: Dict[str, float] = Field(default_factory=lambda: {"a": 0.0, "h": 0.0})
    avg_point_duration: float = 0.0
    turnovers_per_point: float = 0.0
    scoring_runs: Dict[str, int] = Field(default_factory=lambda: {"a": 0, "h": 0})
    top_contributors: Dict[str, List[Dict[str, Any]]] = Field(
        default_factory=lambda: {"a": [], "h": []}
    )


class StatsPayload(BaseModel):
    points: LegacyStatValue = Field(default_factory=LegacyStatValue)
    o_points: LegacyStatValue = Field(default_factory=LegacyStatValue)
    d_points: LegacyStatValue = Field(default_factory=LegacyStatValue)
    o_time: LegacyStatValue = Field(default_factory=LegacyStatValue)
    turnovers: LegacyStatValue = Field(default_factory=LegacyStatValue)
    timeouts: LegacyStatValue = Field(default_factory=LegacyStatValue)
    player_stats: Dict[str, Dict[str, PlayerStatLine]] = Field(
        default_factory=lambda: {"a": {}, "h": {}}
    )
    game_events: List[Dict[str, Any]] = Field(default_factory=list)
    overlay_events: List[OverlayEvent] = Field(default_factory=list)
    current_possession: PossessionState = Field(default_factory=PossessionState)
    advanced_stats: AdvancedStats = Field(default_factory=AdvancedStats)


class SystemSnapshot(BaseModel):
    protocol_version: str = PROTOCOL_VERSION
    mode: MatchMode = MatchMode.AUTO
    selected_field_id: Optional[str] = None
    selected_game_id: Optional[int] = None
    teams: Dict[str, TeamState] = Field(
        default_factory=lambda: {"a": TeamState(), "h": TeamState()}
    )
    players: Dict[str, Dict[str, str]] = Field(default_factory=lambda: {"a": {}, "h": {}})
    score: ScoreState = Field(default_factory=ScoreState)
    timer: TimerState = Field(default_factory=TimerState)
    match_context: MatchContext = Field(default_factory=MatchContext)
    poller: PollerMetrics = Field(default_factory=PollerMetrics)
    view_status: List[ViewStatus] = Field(default_factory=list)
    stats: StatsPayload = Field(default_factory=StatsPayload)
    last_updated_at: Optional[datetime] = None


# Incoming websocket messages
class WsRegister(BaseModel):
    type: Literal["register"] = "register"
    client_role: ClientRole = Field(alias="clientRole")
    view_type: Optional[ObsViewType] = Field(default=None, alias="viewType")
    field_id: Optional[str] = Field(default=None, alias="fieldId")
    instance_id: Optional[str] = Field(default=None, alias="instanceId")
    screen_label: Optional[str] = Field(default=None, alias="screenLabel")


class WsHeartbeat(BaseModel):
    type: Literal["heartbeat"] = "heartbeat"
    timestamp: Optional[datetime] = None


class WsCommand(BaseModel):
    type: Literal["command"] = "command"
    command: str
    payload: Dict[str, Any] = Field(default_factory=dict)


class WsRequestSnapshot(BaseModel):
    type: Literal["request_snapshot"] = "request_snapshot"


IncomingWsMessage = Union[WsRegister, WsHeartbeat, WsCommand, WsRequestSnapshot]


# Outgoing websocket events
class WsRegisteredEvent(BaseModel):
    type: Literal["registered"] = "registered"
    protocol_version: str = PROTOCOL_VERSION
    client_id: str = Field(alias="clientId")


class WsSnapshotEvent(BaseModel):
    type: Literal["snapshot"] = "snapshot"
    snapshot: SystemSnapshot


class WsViewStatusEvent(BaseModel):
    type: Literal["view_status"] = "view_status"
    items: List[ViewStatus]


class WsMatchUpdateEvent(BaseModel):
    type: Literal["match_update"] = "match_update"
    context: MatchContext
    selected_game_id: Optional[int] = None
    selected_field_id: Optional[str] = None
    mode: MatchMode


class WsStatsUpdateEvent(BaseModel):
    type: Literal["stats_update"] = "stats_update"
    stats: StatsPayload
    score: ScoreState
    timer: TimerState
    teams: Dict[str, TeamState]


class WsPollerStatusEvent(BaseModel):
    type: Literal["poller_status"] = "poller_status"
    poller: PollerMetrics


class WsLogEvent(BaseModel):
    type: Literal["log"] = "log"
    level: Literal["debug", "info", "warning", "error"] = "info"
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# REST DTOs
class SetModeRequest(BaseModel):
    mode: MatchMode


class SetFieldRequest(BaseModel):
    field_id: str


class SetManualGameRequest(BaseModel):
    game_id: Optional[int] = None


class SetTeamColorRequest(BaseModel):
    team: Literal["a", "h"]
    jersey_color: Optional[str] = None


class EmitCustomOverlayRequest(BaseModel):
    enabled: bool = True
    title: str = "INFO"
    primary_text: str = ""
    secondary_text: str = ""
    display_ms: int = 5000
    player_team: Optional[Literal["a", "h"]] = None
    player_number: Optional[str] = None


class ControlActionResponse(BaseModel):
    ok: bool = True
    message: str = "ok"
    snapshot: Optional[SystemSnapshot] = None


def parse_incoming_ws_message(payload: Dict[str, Any]) -> IncomingWsMessage:
    message_type = payload.get("type")
    if message_type == "register":
        return WsRegister.model_validate(payload)
    if message_type == "heartbeat":
        return WsHeartbeat.model_validate(payload)
    if message_type == "command":
        return WsCommand.model_validate(payload)
    if message_type == "request_snapshot":
        return WsRequestSnapshot.model_validate(payload)
    raise ValueError(f"Unsupported websocket message type: {message_type}")

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set
from uuid import uuid4

from fastapi import WebSocket

from v2.shared.contracts import ClientRole, ObsViewType, ViewStatus, WsRegister


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


@dataclass
class ConnectedClient:
    client_id: str
    websocket: WebSocket
    role: ClientRole
    view_type: Optional[ObsViewType]
    field_id: Optional[str]
    instance_id: Optional[str]
    screen_label: Optional[str]
    connected_at: datetime
    last_seen_at: datetime

    def touch(self) -> None:
        self.last_seen_at = _utcnow()


class ConnectionRegistry:
    def __init__(self) -> None:
        self._clients: Dict[str, ConnectedClient] = {}
        self._lock = asyncio.Lock()

    async def register(self, websocket: WebSocket, registration: WsRegister) -> ConnectedClient:
        client = ConnectedClient(
            client_id=str(uuid4()),
            websocket=websocket,
            role=registration.client_role,
            view_type=registration.view_type,
            field_id=registration.field_id,
            instance_id=registration.instance_id,
            screen_label=registration.screen_label,
            connected_at=_utcnow(),
            last_seen_at=_utcnow(),
        )
        async with self._lock:
            self._clients[client.client_id] = client
        return client

    async def unregister(self, client_id: str) -> Optional[ConnectedClient]:
        async with self._lock:
            return self._clients.pop(client_id, None)

    async def mark_heartbeat(self, client_id: str) -> None:
        async with self._lock:
            client = self._clients.get(client_id)
            if client is not None:
                client.touch()

    async def get_client(self, client_id: str) -> Optional[ConnectedClient]:
        async with self._lock:
            return self._clients.get(client_id)

    async def list_clients(self) -> List[ConnectedClient]:
        async with self._lock:
            return list(self._clients.values())

    async def clients_count_by_role(self) -> Dict[str, int]:
        counts: Dict[str, int] = {role.value: 0 for role in ClientRole}
        for client in await self.list_clients():
            counts[client.role.value] += 1
        return counts

    async def view_status(self) -> List[ViewStatus]:
        clients = await self.list_clients()
        view_counts: Dict[ObsViewType, int] = {view: 0 for view in ObsViewType}
        for client in clients:
            if client.role == ClientRole.OBS_VIEW and client.view_type is not None:
                view_counts[client.view_type] += 1

        status: List[ViewStatus] = []
        for view, count in view_counts.items():
            status.append(
                ViewStatus(
                    view_type=view,
                    connected_count=count,
                    status="green" if count > 0 else "red",
                )
            )
        return status

    async def prune_stale(self, timeout_seconds: float) -> List[str]:
        stale_ids: List[str] = []
        cutoff = _utcnow() - timedelta(seconds=timeout_seconds)
        async with self._lock:
            for client_id, client in self._clients.items():
                if client.last_seen_at < cutoff:
                    stale_ids.append(client_id)
            for client_id in stale_ids:
                self._clients.pop(client_id, None)
        return stale_ids

    async def broadcast_json(
        self,
        payload: Dict[str, Any],
        roles: Optional[Iterable[ClientRole]] = None,
    ) -> None:
        role_filter: Optional[Set[ClientRole]] = set(roles) if roles is not None else None
        clients = await self.list_clients()

        disconnected: List[str] = []
        for client in clients:
            if role_filter is not None and client.role not in role_filter:
                continue
            try:
                await client.websocket.send_json(payload)
            except Exception:
                disconnected.append(client.client_id)

        if disconnected:
            async with self._lock:
                for client_id in disconnected:
                    self._clients.pop(client_id, None)

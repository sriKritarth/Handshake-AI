"""Tamper-evident audit logging service using SHA-256 hash chaining."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import structlog

log = structlog.get_logger()


class AuditService:
    """Service to compute cryptographic hash chains and record audit log entries."""

    @staticmethod
    def calculate_hash(
        previous_hash: Optional[str],
        session_id: str,
        event_id: Optional[str],
        snapshot_data: Dict[str, Any],
        logged_at: str,
    ) -> str:
        """Compute SHA-256 hash chaining previous hash and event snapshot."""
        prev = previous_hash or "GENESIS"
        ev_str = event_id or "NONE"
        snapshot_str = json.dumps(snapshot_data, sort_keys=True)
        raw = f"{prev}|{session_id}|{ev_str}|{snapshot_str}|{logged_at}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @classmethod
    def create_log_entry(
        cls,
        session_id: str,
        event_type: str,
        snapshot_data: Dict[str, Any],
        previous_hash: Optional[str] = None,
        event_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a complete audit log record with chained cryptographic hash."""
        logged_at = datetime.now(timezone.utc).isoformat()
        
        # Embed event_type in snapshot for complete verification
        payload = dict(snapshot_data)
        payload["event_type"] = event_type

        current_hash = cls.calculate_hash(
            previous_hash=previous_hash,
            session_id=session_id,
            event_id=event_id,
            snapshot_data=payload,
            logged_at=logged_at,
        )

        log.info(
            "audit_entry_created",
            session_id=session_id,
            event_type=event_type,
            current_hash=current_hash[:16],
            previous_hash=(previous_hash or "GENESIS")[:16],
        )

        return {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "event_id": event_id,
            "previous_hash": previous_hash or "GENESIS",
            "current_hash": current_hash,
            "snapshot_data": payload,
            "logged_at": logged_at,
        }

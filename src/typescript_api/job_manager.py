from __future__ import annotations

import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from ..core.jobs import JobController


@dataclass(slots=True)
class JobState:
    id: str
    kind: str
    status: str = "queued"
    progress: float = 0.0
    message: str = "Queued"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: dict[str, Any] | None = None
    error: str = ""
    traceback: str = ""
    controller: JobController = field(default_factory=JobController, repr=False)

    def public(self) -> dict[str, Any]:
        # Do not use dataclasses.asdict(self): JobController owns threading.Event
        # and Lock instances, and asdict() deep-copies them before a field can be
        # removed. Build the API document explicitly so synchronization objects
        # can never enter JSON serialization.
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "result": self.result,
            "error": self.error,
            "traceback": self.traceback,
        }


_LOCK = threading.Lock()
_JOBS: dict[str, JobState] = {}
_ACTIVE_ID: str | None = None


def active_job_id() -> str | None:
    with _LOCK:
        return _ACTIVE_ID


def get_job(job_id: str) -> JobState | None:
    with _LOCK:
        return _JOBS.get(job_id)


def update(job: JobState, *, progress: float | None = None, message: str | None = None) -> None:
    with _LOCK:
        if progress is not None:
            job.progress = max(0.0, min(1.0, float(progress)))
        if message is not None:
            job.message = str(message)
        job.updated_at = time.time()


def start_job(kind: str, runner: Callable[[JobState], dict[str, Any]]) -> JobState:
    global _ACTIVE_ID
    with _LOCK:
        if _ACTIVE_ID is not None:
            active = _JOBS.get(_ACTIVE_ID)
            if active is not None and active.status in {"queued", "running"}:
                raise RuntimeError(f"Another GPU job is already running ({active.kind}, {active.id}).")
        job = JobState(id=uuid.uuid4().hex, kind=kind)
        _JOBS[job.id] = job
        _ACTIVE_ID = job.id

    def worker() -> None:
        global _ACTIVE_ID
        try:
            job.status = "running"
            update(job, progress=0.0, message="Starting")
            result = runner(job)
            if job.controller.cancel.is_set():
                job.status = "cancelled"
                update(job, message="Cancelled")
            else:
                job.result = result
                job.status = "complete"
                update(job, progress=1.0, message="Complete")
        except BaseException as exc:
            if job.controller.cancel.is_set():
                job.status = "cancelled"
                job.error = str(exc)
                update(job, message="Cancelled")
            else:
                job.status = "failed"
                job.error = f"{type(exc).__name__}: {exc}"
                job.traceback = traceback.format_exc()
                update(job, message=job.error)
        finally:
            with _LOCK:
                if _ACTIVE_ID == job.id:
                    _ACTIVE_ID = None

    threading.Thread(target=worker, daemon=True, name=f"dlss5-ts-{kind}-{job.id[:8]}").start()
    return job


def cancel_job(job_id: str) -> JobState:
    job = get_job(job_id)
    if job is None:
        raise KeyError(job_id)
    if job.status in {"queued", "running"}:
        job.controller.stop()
        update(job, message="Stop requested")
    return job


def prune_jobs(max_age_seconds: float = 86400.0, keep: int = 100) -> None:
    cutoff = time.time() - max_age_seconds
    with _LOCK:
        finished = [
            (job.updated_at, job_id)
            for job_id, job in _JOBS.items()
            if job.status not in {"queued", "running"} and job.updated_at < cutoff
        ]
        if len(finished) > keep:
            for _updated, job_id in sorted(finished)[: len(finished) - keep]:
                _JOBS.pop(job_id, None)

"""
cutroom → Hermes AI gateway (Phase 3 — contract locked now, wire later).

Drop-in FastAPI router for the existing Hermes service. Hermes injects
voice/taste/brand context on ITS side and calls Claude; the editor never
touches an LLM key.

Deployment note (PLAN-FIXES §8): Hermes is currently an APScheduler/Telegram
process. Run uvicorn alongside it — either:
  a) a thread:   threading.Thread(target=lambda: uvicorn.run(app, port=8090), daemon=True).start()
  b) a sibling process in the same Railway service (recommended)

Auth: shared secret header `x-cutroom-secret` (single-user).
"""

import json
import os
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

SHARED_SECRET = os.environ.get("CUTROOM_SHARED_SECRET", "")


# ── contract (§7, fixed interface) ────────────────────────────────────────────

class EditorContext(BaseModel):
    edl: dict[str, Any]
    transcript_excerpt: list[dict[str, Any]] = []
    orientation: str = "9:16"


class EditorAIRequest(BaseModel):
    project_id: str
    mode: Literal["chat", "edit"]
    message: str
    context: EditorContext
    # set by the editor's apply-directly ⟷ suggest-and-approve toggle
    requires_approval: bool = True


class EditorAIResponse(BaseModel):
    reply: str
    edl_patch: Optional[dict[str, Any]] = None
    requires_approval: bool = True


# ── system prompt ─────────────────────────────────────────────────────────────

EDIT_SYSTEM = """You are the edit brain inside cutroom, Kyndall's personal UGC editor.

You receive the current EDL (edit decision list) and a transcript excerpt with
word-level timestamps, and return a PATCH against the EDL — never a full rewrite.

TIME CONVENTION (do not violate):
- clips.in / clips.out are SOURCE time (raw upload timestamps)
- overlays, sfx, music are TIMELINE time (post-cut)
- transitions anchor to clip ids: {"after_clip": "c1", "type": "crossfade", "duration": 0.3}
- captions are config only; never emit caption word arrays

PATCH FORMAT — respond with ONLY this JSON, no prose, no markdown fences:
{
  "reply": "one-line summary of what you did, lowercase, her voice",
  "edl_patch": {
    "clips": [ ...full replacement clips array if cuts changed, else omit... ],
    "add_overlays": [ ... ],
    "remove_ids": ["o2", "s1"],
    "modify": [ {"id": "o1", "set": {"end": 5.0}} ],
    "add_sfx": [ ... ],
    "transitions": [ ...full replacement if changed, else omit... ]
  }
}

For "cut the filler / ums / dead air": find filler words and long silences in the
transcript, rebuild the clips array without those ranges, small padding (0.05s).
"""


@router.post("/editor/ai", response_model=EditorAIResponse)
async def editor_ai(
    req: EditorAIRequest,
    x_cutroom_secret: str = Header(default=""),
) -> EditorAIResponse:
    if not SHARED_SECRET or x_cutroom_secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="bad secret")

    # TODO(wire): reuse Hermes's existing pieces —
    #   client  = hermes.claude_client          (existing Anthropic client + budget)
    #   memory  = hermes.memory.retrieve(...)   (voice_v3 / taste rules / brand context)
    #   history = load ai_messages for req.project_id from Supabase (per §9: stored per project)
    #
    # if req.mode == "chat":
    #     reply = client.complete(system=memory + chat_prompt, message=req.message, context=req.context)
    #     return EditorAIResponse(reply=reply, requires_approval=req.requires_approval)
    #
    # if req.mode == "edit":
    #     raw = client.complete(system=memory + EDIT_SYSTEM,
    #                           message=json.dumps({"instruction": req.message,
    #                                               "edl": req.context.edl,
    #                                               "transcript": req.context.transcript_excerpt}))
    #     parsed = json.loads(raw)
    #     return EditorAIResponse(reply=parsed["reply"],
    #                             edl_patch=parsed["edl_patch"],
    #                             requires_approval=req.requires_approval)

    raise HTTPException(status_code=501, detail="phase 3 not wired yet — see TODO(wire)")

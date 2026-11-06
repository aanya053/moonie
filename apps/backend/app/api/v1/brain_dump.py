from fastapi import APIRouter

from app.schemas.brain_dump import BrainDumpRequest, BrainDumpResponse
from app.services.brain_dump_service import extract_proposals

router = APIRouter(prefix="/brain-dump", tags=["Brain Dump"])


@router.post("/parse", response_model=BrainDumpResponse)
async def parse_brain_dump(data: BrainDumpRequest):
    proposals = await extract_proposals(data.text, data.now, data.timezone)
    return BrainDumpResponse(provider="openai_compatible", proposals=proposals)

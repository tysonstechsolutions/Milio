from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import tempfile

router = APIRouter(prefix="/stt", tags=["stt"])

# Lazy-load whisper once (so it doesn't reload every request)
_model = None

def get_model():
    global _model
    if _model is None:
        import whisper
        # "base" is a good MVP balance. "small" is better but slower.
        _model = whisper.load_model(os.getenv("WHISPER_MODEL", "base"))
    return _model

@router.post("")
async def transcribe(audio: UploadFile = File(...)):
    if not audio:
        raise HTTPException(status_code=400, detail="Missing audio file")

    # Save upload to a temp file
    suffix = os.path.splitext(audio.filename or "")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        content = await audio.read()
        tmp.write(content)

    try:
        model = get_model()
        # whisper can read m4a/wav/mp3 if ffmpeg is available
        result = model.transcribe(tmp_path)
        text = (result.get("text") or "").strip()
        return {"text": text}
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

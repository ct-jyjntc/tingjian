"""Project-owned loopback HTTP wrapper; these routes are not MLX-Audio APIs."""
import asyncio, hashlib, json, os, secrets, threading, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

MODEL_ID = os.getenv('TTS_MODEL_ID', 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit')
TOKEN = os.getenv('TTS_SERVICE_TOKEN', '')
CACHE = Path(__file__).parent / 'cache'
CACHE.mkdir(exist_ok=True)
pool = ThreadPoolExecutor(max_workers=1)
model = None
state = 'loading'
pending = {}

def load():
    global model, state
    try:
        from mlx_audio.tts.utils import load_model
        model = load_model(MODEL_ID)
        state = 'ready'
    except Exception:
        state = 'error'

@asynccontextmanager
async def lifespan(app):
    asyncio.get_running_loop().run_in_executor(pool, load)
    yield
    pool.shutdown(wait=False, cancel_futures=True)

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

def authorize(value):
    if TOKEN and not secrets.compare_digest(value or '', f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Invalid service token')

@app.get('/health')
def health(authorization: str | None = Header(default=None)):
    authorize(authorization)
    return {'state': state, 'label': {'loading':'模型加载中','ready':'本地模型可用','error':'模型加载失败，请检查依赖和下载'}[state], 'model': MODEL_ID,
            'voices': ['Vivian','Serena','Ryan','Aiden','Uncle_Fu','Dylan','Eric']}

class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    voice: str = 'Vivian'
    speed: float = Field(default=1, ge=.5, le=1.5)
    language: str = 'Auto'
    pronunciation: str = Field(default='', max_length=1000)

def generate(data, path):
    import numpy as np
    import soundfile as sf
    import librosa
    results = list(model.generate_custom_voice(text=data.pronunciation or data.text, speaker=data.voice, language=data.language))
    if not results:
        raise RuntimeError('No audio')
    audio = np.concatenate([np.asarray(r.audio).reshape(-1) for r in results])
    sr = results[0].sample_rate
    if data.speed != 1:
        audio = librosa.effects.time_stretch(audio, rate=data.speed)
    tmp = path.with_suffix('.tmp.wav')
    sf.write(tmp, audio, sr)
    tmp.replace(path)
    # Local audio retention: at most 256 files and seven days.
    files = sorted(CACHE.glob('*.wav'), key=lambda p:p.stat().st_mtime, reverse=True)
    for i, f in enumerate(files):
        if f != path and (i >= 256 or time.time()-f.stat().st_mtime > 7*86400):
            f.unlink(missing_ok=True)

@app.post('/synthesize')
async def synthesize(data: Speech, request: Request, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if state != 'ready':
        raise HTTPException(503, 'Model is loading or unavailable')
    if data.voice not in ['Vivian','Serena','Ryan','Aiden','Uncle_Fu','Dylan','Eric'] or data.language not in ['Auto','Chinese','English']:
        raise HTTPException(400, 'Unsupported voice or language')
    key = hashlib.sha256(json.dumps({'model':MODEL_ID,**data.model_dump()},sort_keys=True).encode()).hexdigest()
    path = CACHE / f'{key}.wav'
    if not path.exists():
        if key not in pending:
            if len(pending) >= 4:
                raise HTTPException(429, 'Generation queue full')
            future=asyncio.get_running_loop().run_in_executor(pool, generate, data, path)
            pending[key]=future
            future.add_done_callback(lambda _: pending.pop(key, None))
        try:
            await asyncio.wait_for(asyncio.shield(pending[key]), timeout=175)
        except asyncio.TimeoutError:
            raise HTTPException(504, 'Generation timed out')
        except Exception:
            raise HTTPException(503, 'Audio generation failed')
    if await request.is_disconnected():
        raise HTTPException(499, 'Client disconnected')
    return FileResponse(path, media_type='audio/wav', headers={'Cache-Control':'private, no-store'})

"""Generate Edge online speech. No credentials, files, or transcripts are logged."""
import asyncio
import json
import sys
import edge_tts

async def main():
    data = json.loads(sys.stdin.buffer.read(20000))
    if data.get('check'):
        print(json.dumps({'available': True}))
        return
    speech = edge_tts.Communicate(data['text'], data['voice'])
    async for chunk in speech.stream():
        if chunk['type'] == 'audio':
            sys.stdout.buffer.write(chunk['data'])
    sys.stdout.buffer.flush()

if __name__ == '__main__':
    try:
        asyncio.run(asyncio.wait_for(main(), timeout=40))
    except Exception:
        # Avoid library exceptions logging user text or transport internals.
        sys.stderr.write('Edge speech unavailable\n')
        sys.exit(1)

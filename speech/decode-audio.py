import sys
from pathlib import Path
import av

resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
with av.open(sys.argv[1]) as audio, open(sys.argv[2], 'wb') as output:
    for frame in audio.decode(audio=0):
        for converted in resampler.resample(frame):
            output.write(converted.to_ndarray().tobytes())
    for converted in resampler.resample(None):
        output.write(converted.to_ndarray().tobytes())
